import AVFoundation
import FluidAudio
import Foundation

public struct PreparedWorkbenchAudio: Sendable {
    public let wavURL: URL
    public let durationSeconds: Double
    public let deleteWhenDone: Bool
}

/// Adapted from the MIT-licensed Muesli file-transcription pipeline pinned in
/// NOTICE.md. It keeps the proven MP3, MP4, M4A, and WAV conversion boundary,
/// but owns Workbench paths and names.
public struct WorkbenchAudioFilePreparer {
    public static let supportedExtensions: Set<String> = ["m4a", "mp4", "wav", "mp3"]

    public init() {}

    public static func isSupportedFileURL(_ url: URL) -> Bool {
        supportedExtensions.contains(url.pathExtension.lowercased())
    }

    public enum PreparationError: Error, LocalizedError {
        case unsupportedFormat
        case conversionFailed(String)
        case noAudioTracks
        case readError(String)

        public var errorDescription: String? {
            switch self {
            case .unsupportedFormat:
                return "This audio file format is not supported."
            case .conversionFailed(let detail):
                return "Could not convert the audio file. \(detail)"
            case .noAudioTracks:
                return "The selected file does not contain any audio tracks."
            case .readError(let detail):
                return "Could not read the audio file. \(detail)"
            }
        }
    }

    public func prepareAudio(sourceURL: URL) async throws -> PreparedWorkbenchAudio {
        guard Self.isSupportedFileURL(sourceURL) else {
            throw PreparationError.unsupportedFormat
        }
        try Task.checkCancellation()

        if let compatible = try compatibleWAVInfo(sourceURL: sourceURL) {
            let outputURL = try temporaryWAVURL()
            try FileManager.default.copyItem(at: sourceURL, to: outputURL)
            return PreparedWorkbenchAudio(
                wavURL: outputURL,
                durationSeconds: compatible.duration,
                deleteWhenDone: true
            )
        }

        let duration = try await audioDuration(sourceURL: sourceURL)
        try Task.checkCancellation()

        let decoded = try await decodeAssetReaderToTemporaryWAV(sourceURL: sourceURL)
        guard decoded.sampleCount > 0 else {
            try? FileManager.default.removeItem(at: decoded.wavURL)
            throw PreparationError.noAudioTracks
        }
        let resolvedDuration = duration ?? Double(decoded.sampleCount) / Double(WorkbenchWavWriter.sampleRate)
        guard resolvedDuration > 0, resolvedDuration.isFinite else {
            try? FileManager.default.removeItem(at: decoded.wavURL)
            throw PreparationError.readError("Invalid audio duration.")
        }
        return PreparedWorkbenchAudio(
            wavURL: decoded.wavURL,
            durationSeconds: resolvedDuration,
            deleteWhenDone: true
        )
    }

    private struct CompatibleWAVInfo {
        let duration: TimeInterval
    }

    private func compatibleWAVInfo(sourceURL: URL) throws -> CompatibleWAVInfo? {
        guard sourceURL.pathExtension.lowercased() == "wav" else { return nil }
        let file = try AVAudioFile(forReading: sourceURL)
        let format = file.fileFormat
        guard format.sampleRate == Double(WorkbenchWavWriter.sampleRate),
              format.channelCount == UInt32(WorkbenchWavWriter.channels),
              format.commonFormat == .pcmFormatInt16 else {
            return nil
        }
        let duration = Double(file.length) / format.sampleRate
        guard duration > 0, duration.isFinite else {
            throw PreparationError.readError("Invalid audio duration.")
        }
        return CompatibleWAVInfo(duration: duration)
    }

    private func temporaryWAVURL() throws -> URL {
        try WorkbenchWavWriter.temporaryWAVURL(directoryName: "workbench-transcription")
    }

    private func audioDuration(sourceURL: URL) async throws -> TimeInterval? {
        let asset = AVURLAsset(url: sourceURL)
        let tracks = try await asset.load(.tracks)
        guard tracks.contains(where: { $0.mediaType == .audio }) else {
            throw PreparationError.noAudioTracks
        }
        let duration = CMTimeGetSeconds(try await asset.load(.duration))
        return duration > 0 && duration.isFinite ? duration : nil
    }

    private func decodeAssetReaderToTemporaryWAV(sourceURL: URL) async throws -> (wavURL: URL, sampleCount: Int) {
        let asset = AVURLAsset(url: sourceURL)
        let tracks = try await asset.load(.tracks)
        guard let audioTrack = tracks.first(where: { $0.mediaType == .audio }) else {
            throw PreparationError.noAudioTracks
        }

        let reader = try AVAssetReader(asset: asset)
        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ]
        let output = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: outputSettings)
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else {
            throw PreparationError.conversionFailed("Could not read audio samples from the selected file.")
        }
        reader.add(output)

        guard reader.startReading() else {
            throw PreparationError.readError(reader.error?.localizedDescription ?? "Unknown read error")
        }

        let converter = AudioConverter()
        let wavURL = try WorkbenchWavWriter.temporaryWAVURL(directoryName: "workbench-transcription")
        do {
            let sampleCount = try WorkbenchWavWriter.writeWAV(to: wavURL) { handle in
                var totalSamples = 0
                while reader.status == .reading {
                    try Task.checkCancellation()
                    guard let sampleBuffer = output.copyNextSampleBuffer() else { break }
                    let chunk = try converter.resampleSampleBuffer(sampleBuffer)
                    totalSamples += try WorkbenchWavWriter.append(samples: chunk, to: handle)
                }
                guard reader.status == .completed else {
                    throw PreparationError.readError(reader.error?.localizedDescription ?? "Read did not complete")
                }
                return totalSamples
            }
            return (wavURL, sampleCount)
        } catch {
            try? FileManager.default.removeItem(at: wavURL)
            throw error
        }
    }
}

enum WorkbenchWavWriter {
    static let sampleRate: UInt32 = 16_000
    static let channels: UInt16 = 1
    static let bitsPerSample: UInt16 = 16

    static func temporaryWAVURL(directoryName: String) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(directoryName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
    }

    @discardableResult
    static func writeWAV(to url: URL, writeSamples: (FileHandle) throws -> Int) throws -> Int {
        _ = FileManager.default.createFile(atPath: url.path, contents: header(dataSize: 0))
        let handle = try FileHandle(forWritingTo: url)
        do {
            try handle.seekToEnd()
            let sampleCount = try writeSamples(handle)
            let dataSize = UInt32(sampleCount * Int(bitsPerSample / 8))
            try handle.seek(toOffset: 0)
            try handle.write(contentsOf: header(dataSize: dataSize))
            try handle.close()
            return sampleCount
        } catch {
            try? handle.close()
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }

    @discardableResult
    static func append(samples: [Float], to handle: FileHandle) throws -> Int {
        guard !samples.isEmpty else { return 0 }
        var data = Data()
        data.reserveCapacity(samples.count * 2)
        for sample in samples {
            var value = Int16(max(-1.0, min(1.0, sample)) * 32767).littleEndian
            withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
        }
        try handle.write(contentsOf: data)
        return samples.count
    }

    static func header(dataSize: UInt32) -> Data {
        let byteRate = sampleRate * UInt32(channels) * UInt32(bitsPerSample / 8)
        let blockAlign = channels * (bitsPerSample / 8)
        var header = Data()
        header.append(contentsOf: "RIFF".utf8)
        header.append(contentsOf: withUnsafeBytes(of: (dataSize + 36).littleEndian) { Array($0) })
        header.append(contentsOf: "WAVE".utf8)
        header.append(contentsOf: "fmt ".utf8)
        header.append(contentsOf: withUnsafeBytes(of: UInt32(16).littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt16(1).littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: channels.littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: sampleRate.littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: byteRate.littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: blockAlign.littleEndian) { Array($0) })
        header.append(contentsOf: withUnsafeBytes(of: bitsPerSample.littleEndian) { Array($0) })
        header.append(contentsOf: "data".utf8)
        header.append(contentsOf: withUnsafeBytes(of: dataSize.littleEndian) { Array($0) })
        return header
    }
}
