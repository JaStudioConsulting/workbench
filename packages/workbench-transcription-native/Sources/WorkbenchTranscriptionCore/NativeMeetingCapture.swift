import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

public struct WorkbenchCaptureResult: Sendable {
    public let audioURL: URL
    public let usedSystemAudio: Bool
    public let warning: String?
}

public final class WorkbenchAudioMixer: @unchecked Sendable {
    private let lock = NSLock()
    private var microphone: [Int16] = []
    private var system: [Int16] = []
    private var handle: FileHandle?
    private var byteCount = 0
    public let outputURL: URL

    public init(outputURL: URL) throws {
        self.outputURL = outputURL
        _ = FileManager.default.createFile(atPath: outputURL.path, contents: WorkbenchWavWriter.header(dataSize: 0))
        handle = try FileHandle(forWritingTo: outputURL)
        try handle?.seekToEnd()
    }

    public func appendMicrophone(_ samples: [Int16]) { append(samples, microphoneSource: true) }
    public func appendSystem(_ samples: [Int16]) { append(samples, microphoneSource: false) }

    public func finish() throws {
        lock.lock()
        defer { lock.unlock() }
        writeAvailable(flushAll: true)
        try handle?.seek(toOffset: 0)
        try handle?.write(contentsOf: WorkbenchWavWriter.header(dataSize: UInt32(clamping: byteCount)))
        try handle?.close()
        handle = nil
    }

    public static func mix(microphone: [Int16], system: [Int16]) -> [Int16] {
        let count = max(microphone.count, system.count)
        return (0..<count).map { index in
            let hasMicrophone = index < microphone.count
            let hasSystem = index < system.count
            let contributors = (hasMicrophone ? 1 : 0) + (hasSystem ? 1 : 0)
            let sum = (hasMicrophone ? Int(microphone[index]) : 0) + (hasSystem ? Int(system[index]) : 0)
            return Int16(clamping: contributors == 0 ? 0 : sum / contributors)
        }
    }

    private func append(_ samples: [Int16], microphoneSource: Bool) {
        guard !samples.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        if microphoneSource { microphone.append(contentsOf: samples) } else { system.append(contentsOf: samples) }
        writeAvailable(flushAll: false)
    }

    private func writeAvailable(flushAll: Bool) {
        let count = flushAll ? max(microphone.count, system.count) : min(microphone.count, system.count)
        guard count > 0 else { return }
        let samples = Self.mix(
            microphone: Array(microphone.prefix(count)),
            system: Array(system.prefix(count))
        )
        microphone.removeFirst(min(count, microphone.count))
        system.removeFirst(min(count, system.count))
        let data = samples.withUnsafeBufferPointer { Data(buffer: $0) }
        try? handle?.write(contentsOf: data)
        byteCount += data.count
    }
}

final class WorkbenchMicrophoneCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let onSamples: @Sendable ([Int16]) -> Void

    init(onSamples: @escaping @Sendable ([Int16]) -> Void) {
        self.onSamples = onSamples
    }

    func start() throws {
        let input = engine.inputNode
        guard let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false) else {
            throw WorkbenchCaptureError.microphoneUnavailable
        }
        input.installTap(onBus: 0, bufferSize: 4096, format: target) { [onSamples] buffer, _ in
            guard let channel = buffer.floatChannelData?[0] else { return }
            let samples = (0..<Int(buffer.frameLength)).map { index in
                Int16(max(-1, min(1, channel[index])) * 32767)
            }
            onSamples(samples)
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

final class WorkbenchSystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let onSamples: @Sendable ([Int16]) -> Void
    private var stream: SCStream?

    init(onSamples: @escaping @Sendable ([Int16]) -> Void) {
        self.onSamples = onSamples
    }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else { throw WorkbenchCaptureError.displayUnavailable }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.showsCursor = false
        configuration.capturesAudio = true
        configuration.sampleRate = 16_000
        configuration.channelCount = 1
        configuration.excludesCurrentProcessAudio = true
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "workbench.system-audio"))
        try await stream.startCapture()
        self.stream = stream
    }

    func stop() async {
        try? await stream?.stopCapture()
        stream = nil
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio,
              let format = CMSampleBufferGetFormatDescription(sampleBuffer),
              let description = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee,
              let block = CMSampleBufferGetDataBuffer(sampleBuffer)
        else { return }
        let length = CMBlockBufferGetDataLength(block)
        guard length > 0 else { return }
        var pointer: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: nil, dataPointerOut: &pointer) == kCMBlockBufferNoErr,
              let pointer
        else { return }

        let channels = max(1, Int(description.mChannelsPerFrame))
        if description.mFormatFlags & kAudioFormatFlagIsFloat != 0 {
            let count = length / MemoryLayout<Float>.size
            let values = UnsafeRawPointer(pointer).bindMemory(to: Float.self, capacity: count)
            let frames = count / channels
            onSamples((0..<frames).map { frame in
                let sum = (0..<channels).reduce(Float(0)) { $0 + values[(frame * channels) + $1] }
                return Int16(max(-1, min(1, sum / Float(channels))) * 32767)
            })
        } else if description.mFormatID == kAudioFormatLinearPCM && description.mBitsPerChannel == 16 {
            let data = Data(bytes: pointer, count: length)
            let values = data.withUnsafeBytes { Array($0.bindMemory(to: Int16.self)) }
            let frames = values.count / channels
            onSamples((0..<frames).map { frame in
                let sum = (0..<channels).reduce(0) { $0 + Int(values[(frame * channels) + $1]) }
                return Int16(clamping: sum / channels)
            })
        }
    }
}

public actor WorkbenchNativeMeetingCapture {
    private var microphone: WorkbenchMicrophoneCapture?
    private var system: WorkbenchSystemAudioCapture?
    private var mixer: WorkbenchAudioMixer?
    private var warning: String?
    private var usingSystemAudio = false

    public init() {}

    public func start(outputURL: URL, includeSystemAudio: Bool) async throws {
        let mixer = try WorkbenchAudioMixer(outputURL: outputURL)
        let microphone = WorkbenchMicrophoneCapture(onSamples: { samples in mixer.appendMicrophone(samples) })
        try microphone.start()
        self.mixer = mixer
        self.microphone = microphone
        guard includeSystemAudio else { return }

        let system = WorkbenchSystemAudioCapture(onSamples: { samples in mixer.appendSystem(samples) })
        do {
            try await system.start()
            self.system = system
            usingSystemAudio = true
        } catch {
            warning = "System audio was unavailable. Microphone recording continued."
            usingSystemAudio = false
        }
    }

    public func stop() async throws -> WorkbenchCaptureResult {
        microphone?.stop()
        await system?.stop()
        try mixer?.finish()
        guard let outputURL = mixer?.outputURL else { throw WorkbenchCaptureError.notRecording }
        let result = WorkbenchCaptureResult(audioURL: outputURL, usedSystemAudio: usingSystemAudio, warning: warning)
        microphone = nil
        system = nil
        mixer = nil
        warning = nil
        usingSystemAudio = false
        return result
    }
}

public enum WorkbenchCaptureError: Error, LocalizedError {
    case displayUnavailable
    case microphoneUnavailable
    case notRecording

    public var errorDescription: String? {
        switch self {
        case .displayUnavailable: return "No display is available for system audio capture."
        case .microphoneUnavailable: return "Microphone capture is unavailable."
        case .notRecording: return "No native meeting recording is active."
        }
    }
}
