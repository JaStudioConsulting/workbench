import AVFoundation
import AudioToolbox
import CoreMedia
import Foundation
import ScreenCaptureKit

public struct WorkbenchCaptureResult: Sendable {
    public let audioURL: URL
    public let usedSystemAudio: Bool
    public let warning: String?
    public let journal: WorkbenchCaptureJournalResult?
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
    private let onSamples: @Sendable ([Int16], UInt64) -> Void
    private let onInterruption: @Sendable (String) -> Void
    private var observer: NSObjectProtocol?

    init(onSamples: @escaping @Sendable ([Int16], UInt64) -> Void, onInterruption: @escaping @Sendable (String) -> Void = { _ in }) {
        self.onSamples = onSamples
        self.onInterruption = onInterruption
    }

    func start() throws {
        let input = engine.inputNode
        guard let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false),
              input.outputFormat(forBus: 0).sampleRate > 0,
              input.outputFormat(forBus: 0).channelCount > 0
        else {
            throw WorkbenchCaptureError.microphoneUnavailable
        }
        // AVAudioEngine input taps must use the device's native format. Forcing
        // 16 kHz here aborts the process on common 44.1/48 kHz microphones.
        // Convert inside the callback after AVAudioEngine supplies a valid buffer.
        input.installTap(onBus: 0, bufferSize: 4096, format: nil) { [onSamples] buffer, time in
            guard buffer.frameLength > 0,
                  let converter = AVAudioConverter(from: buffer.format, to: target)
            else { return }
            let ratio = target.sampleRate / max(1, buffer.format.sampleRate)
            let capacity = max(1, AVAudioFrameCount(ceil(Double(buffer.frameLength) * ratio)) + 32)
            guard let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
            var supplied = false
            var conversionError: NSError?
            let status = converter.convert(to: converted, error: &conversionError) { _, packetStatus in
                if supplied {
                    packetStatus.pointee = .endOfStream
                    return nil
                }
                supplied = true
                packetStatus.pointee = .haveData
                return buffer
            }
            guard status != .error, conversionError == nil, let channel = converted.floatChannelData?[0] else { return }
            let samples = (0..<Int(converted.frameLength)).map { index in
                Int16(max(-1, min(1, channel[index])) * 32767)
            }
            let hostTime = time.hostTime > 0 ? AudioConvertHostTimeToNanos(time.hostTime) : DispatchTime.now().uptimeNanoseconds
            onSamples(samples, hostTime)
        }
        engine.prepare()
        try engine.start()
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: nil
        ) { [onInterruption] _ in
            onInterruption("Microphone device configuration changed during capture.")
        }
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
    }
}

final class WorkbenchSystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let onSamples: @Sendable ([Int16], UInt64) -> Void
    private let onInterruption: @Sendable (String) -> Void
    private var stream: SCStream?

    init(onSamples: @escaping @Sendable ([Int16], UInt64) -> Void, onInterruption: @escaping @Sendable (String) -> Void = { _ in }) {
        self.onSamples = onSamples
        self.onInterruption = onInterruption
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
        guard type == .audio, let samples = normalizedSamples(from: sampleBuffer), !samples.isEmpty else { return }
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let scaledTime = CMTimeConvertScale(presentationTime, timescale: 1_000_000_000, method: .default)
        let hostTime = presentationTime.isValid && scaledTime.value >= 0 ? UInt64(scaledTime.value) : DispatchTime.now().uptimeNanoseconds
        onSamples(samples, hostTime)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onInterruption("System audio capture stopped: \(error.localizedDescription)")
    }

    private func normalizedSamples(from sampleBuffer: CMSampleBuffer) -> [Int16]? {
        guard let description = CMSampleBufferGetFormatDescription(sampleBuffer),
              let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)
        else { return nil }
        let inputFormat = AVAudioFormat(cmAudioFormatDescription: description)

        var requiredSize = 0
        let sizingStatus = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &requiredSize,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            blockBufferOut: nil
        )
        guard sizingStatus == noErr, requiredSize >= MemoryLayout<AudioBufferList>.size else { return nil }
        let storage = UnsafeMutableRawPointer.allocate(byteCount: requiredSize, alignment: 16)
        defer { storage.deallocate() }
        let audioBufferList = storage.bindMemory(to: AudioBufferList.self, capacity: 1)
        var retainedBlock: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: audioBufferList,
            bufferListSize: requiredSize,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            blockBufferOut: &retainedBlock
        )
        guard status == noErr,
              let inputBuffer = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: audioBufferList, deallocator: nil)
        else { return nil }
        inputBuffer.frameLength = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
        guard let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else { return nil }
        let ratio = 16_000 / max(1, inputFormat.sampleRate)
        let capacity = max(1, AVAudioFrameCount(ceil(Double(inputBuffer.frameLength) * ratio)) + 32)
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return nil }
        var supplied = false
        var conversionError: NSError?
        let conversionStatus = converter.convert(to: outputBuffer, error: &conversionError) { _, packetStatus in
            if supplied {
                packetStatus.pointee = .endOfStream
                return nil
            }
            supplied = true
            packetStatus.pointee = .haveData
            return inputBuffer
        }
        guard conversionStatus != .error, conversionError == nil, let channel = outputBuffer.floatChannelData?[0] else { return nil }
        return (0..<Int(outputBuffer.frameLength)).map { index in
            Int16(max(-1, min(1, channel[index])) * 32767)
        }
    }
}

public actor WorkbenchNativeMeetingCapture {
    private var microphone: WorkbenchMicrophoneCapture?
    private var system: WorkbenchSystemAudioCapture?
    private var mixer: WorkbenchAudioMixer?
    private var warning: String?
    private var usingSystemAudio = false
    private var journal: WorkbenchCaptureJournal?

    public init() {}

    public func start(
        outputURL: URL,
        includeSystemAudio: Bool,
        journalDirectory: URL? = nil,
        context: WorkbenchCaptureContext? = nil,
        requireSystemAudio: Bool = false
    ) async throws {
        let activeJournal = try journalDirectory.map { directory in
            try WorkbenchCaptureJournal(
                directory: directory,
                context: context ?? WorkbenchCaptureContext(sessionID: UUID().uuidString, jobID: "", candidateID: "", controlID: UUID().uuidString)
            )
        }
        let activeMixer = try activeJournal == nil ? WorkbenchAudioMixer(outputURL: outputURL) : nil
        let microphone = WorkbenchMicrophoneCapture(onSamples: { samples, hostTime in
            if let activeJournal {
                _ = activeJournal.enqueue(samples, source: .microphone, hostTimeNanoseconds: hostTime)
            } else {
                activeMixer?.appendMicrophone(samples)
            }
        }, onInterruption: { message in activeJournal?.markFailed(message) })
        do {
            try microphone.start()
        } catch {
            activeJournal?.markFailed(error.localizedDescription)
            throw error
        }
        self.mixer = activeMixer
        self.microphone = microphone
        self.journal = activeJournal
        guard includeSystemAudio else {
            try activeJournal?.markReady()
            return
        }

        let system = WorkbenchSystemAudioCapture(onSamples: { samples, hostTime in
            if let activeJournal {
                _ = activeJournal.enqueue(samples, source: .system, hostTimeNanoseconds: hostTime)
            } else {
                activeMixer?.appendSystem(samples)
            }
        }, onInterruption: { message in activeJournal?.markFailed(message) })
        do {
            try await system.start()
            self.system = system
            usingSystemAudio = true
            try activeJournal?.markReady()
        } catch {
            if requireSystemAudio {
                microphone.stop()
                try? activeMixer?.finish()
                activeJournal?.markFailed(error.localizedDescription)
                self.microphone = nil
                self.mixer = nil
                self.journal = nil
                throw error
            }
            warning = "System audio was unavailable. Microphone recording continued."
            usingSystemAudio = false
            try activeJournal?.markReady()
        }
    }

    public func healthError() -> String? {
        journal?.healthError
    }

    public func heartbeat(controlID: String, leaseExpiresAt: Date) throws {
        try journal?.heartbeat(controlID: controlID, leaseExpiresAt: leaseExpiresAt)
    }

    public func stop() async throws -> WorkbenchCaptureResult {
        microphone?.stop()
        await system?.stop()
        let journalResult: WorkbenchCaptureJournalResult?
        let outputURL: URL
        if let journal {
            journalResult = try journal.finish()
            guard let recovered = journalResult?.mixedWAV ?? journalResult?.microphoneWAV ?? journalResult?.systemWAV else {
                throw WorkbenchCaptureError.notRecording
            }
            outputURL = recovered
        } else {
            try mixer?.finish()
            guard let mixed = mixer?.outputURL else { throw WorkbenchCaptureError.notRecording }
            outputURL = mixed
            journalResult = nil
        }
        let warnings = [warning, journalResult?.warning].compactMap { $0 }
        let result = WorkbenchCaptureResult(audioURL: outputURL, usedSystemAudio: usingSystemAudio, warning: warnings.isEmpty ? nil : warnings.joined(separator: " "), journal: journalResult)
        microphone = nil
        system = nil
        mixer = nil
        warning = nil
        usingSystemAudio = false
        self.journal = nil
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
