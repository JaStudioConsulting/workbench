import CryptoKit
import Darwin
import Foundation

public enum WorkbenchCaptureSource: String, Codable, CaseIterable, Sendable {
    case microphone
    case system
}

public struct WorkbenchCaptureContext: Codable, Equatable, Sendable {
    public let sessionID: String
    public let jobID: String
    public let candidateID: String
    public let helperPID: Int32
    public let helperStartedAt: Date
    public let controlID: String

    public init(sessionID: String, jobID: String, candidateID: String, helperPID: Int32 = ProcessInfo.processInfo.processIdentifier, helperStartedAt: Date = Date(), controlID: String) {
        self.sessionID = sessionID
        self.jobID = jobID
        self.candidateID = candidateID
        self.helperPID = helperPID
        self.helperStartedAt = helperStartedAt
        self.controlID = controlID
    }
}

public struct WorkbenchCaptureChunkMetadata: Codable, Equatable, Sendable {
    public let source: WorkbenchCaptureSource
    public let sequence: Int
    public let epoch: Int
    public let hostTimeNanoseconds: UInt64
    public let sampleRate: Int
    public let channelCount: Int
    public let frameCount: Int
    public let byteCount: Int
    public let sha256: String
    public let pcmFile: String
}

public struct WorkbenchCaptureJournalSnapshot: Codable, Equatable, Sendable {
    public let context: WorkbenchCaptureContext
    public let state: String
    public let microphoneChunks: Int
    public let systemChunks: Int
    public let microphoneBytes: Int
    public let systemBytes: Int
    public let createdAt: Date
    public let updatedAt: Date
    public let heartbeatAt: Date?
    public let leaseExpiresAt: Date?
    public let error: String?
}

public struct WorkbenchCaptureJournalResult: Sendable {
    public let snapshot: WorkbenchCaptureJournalSnapshot
    public let microphoneWAV: URL?
    public let systemWAV: URL?
    public let mixedWAV: URL?
    public let warning: String?
}

private struct WorkbenchQueuedCaptureBlock: Sendable {
    let source: WorkbenchCaptureSource
    let epoch: Int
    let hostTimeNanoseconds: UInt64
    let sampleRate: Int
    let channelCount: Int
    let frameCount: Int
    let data: Data
}

private struct WorkbenchCaptureAccumulator {
    let source: WorkbenchCaptureSource
    let epoch: Int
    let hostTimeNanoseconds: UInt64
    let sampleRate: Int
    let channelCount: Int
    var frameCount: Int
    var data: Data
}

/// Source-separated capture journal. Real-time callbacks only copy/enqueue a
/// bounded block; a serial utility queue owns every filesystem operation.
public final class WorkbenchCaptureJournal: @unchecked Sendable {
    private let stateLock = NSLock()
    private let writerQueue = DispatchQueue(label: "workbench.capture-journal", qos: .utility)
    private let directory: URL
    private let context: WorkbenchCaptureContext
    private let createdAt: Date
    private let maxPendingBlocks: Int
    private var state = "preparing"
    private var error: String?
    private var pendingBlocks = 0
    private var heartbeatAt: Date?
    private var leaseExpiresAt: Date?
    private var nextSequence: [WorkbenchCaptureSource: Int] = [.microphone: 0, .system: 0]
    private var chunkCounts: [WorkbenchCaptureSource: Int] = [.microphone: 0, .system: 0]
    private var byteCounts: [WorkbenchCaptureSource: Int] = [.microphone: 0, .system: 0]
    private var accumulators: [WorkbenchCaptureSource: WorkbenchCaptureAccumulator] = [:]

    public init(directory: URL, context: WorkbenchCaptureContext, maxPendingBlocks: Int = 128) throws {
        self.directory = directory.standardizedFileURL
        self.context = context
        self.createdAt = Date()
        self.maxPendingBlocks = max(8, maxPendingBlocks)
        for source in WorkbenchCaptureSource.allCases {
            try FileManager.default.createDirectory(at: chunksDirectory(for: source), withIntermediateDirectories: true)
        }
        try persistSnapshot()
    }

    public var healthError: String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return error
    }

    @discardableResult
    public func enqueue(
        _ samples: [Int16],
        source: WorkbenchCaptureSource,
        hostTimeNanoseconds: UInt64,
        sampleRate: Int = 16_000,
        channelCount: Int = 1,
        epoch: Int = 0
    ) -> Bool {
        guard !samples.isEmpty else { return true }
        let data = samples.withUnsafeBufferPointer { Data(buffer: $0) }

        stateLock.lock()
        guard error == nil, ["preparing", "recording"].contains(state), pendingBlocks < maxPendingBlocks else {
            if error == nil { error = "Capture storage could not keep up with live audio." }
            stateLock.unlock()
            return false
        }
        pendingBlocks += 1
        stateLock.unlock()

        let block = WorkbenchQueuedCaptureBlock(
            source: source,
            epoch: epoch,
            hostTimeNanoseconds: hostTimeNanoseconds,
            sampleRate: sampleRate,
            channelCount: channelCount,
            frameCount: samples.count / max(1, channelCount),
            data: data
        )
        writerQueue.async { [weak self] in self?.consume(block) }
        return true
    }

    public func markReady() throws {
        try writerQueue.sync {
            try flushAllAccumulators()
            stateLock.lock()
            guard state == "preparing", error == nil else {
                stateLock.unlock()
                throw WorkbenchCaptureJournalError.invalidTransition
            }
            state = "recording"
            stateLock.unlock()
            try persistSnapshot()
        }
    }

    public func markFailed(_ message: String) {
        writerQueue.sync {
            stateLock.lock()
            state = "recoverable"
            error = message
            stateLock.unlock()
            try? persistSnapshot()
        }
    }

    public func heartbeat(controlID: String, leaseExpiresAt: Date) throws {
        guard controlID == context.controlID else { throw WorkbenchCaptureJournalError.invalidControl }
        try writerQueue.sync {
            stateLock.lock()
            heartbeatAt = Date()
            self.leaseExpiresAt = leaseExpiresAt
            stateLock.unlock()
            try persistSnapshot()
        }
    }

    public func finish() throws -> WorkbenchCaptureJournalResult {
        try writerQueue.sync {
            try flushAllAccumulators()
            stateLock.lock()
            let storedError = error
            state = "finalizing"
            stateLock.unlock()
            try persistSnapshot()

            let materialized = try materializeVerifiedTracks()
            stateLock.lock()
            state = storedError == nil ? "complete" : "partial"
            stateLock.unlock()
            try persistSnapshot()
            return WorkbenchCaptureJournalResult(
                snapshot: currentSnapshot(),
                microphoneWAV: materialized.microphone,
                systemWAV: materialized.system,
                mixedWAV: materialized.mixed,
                warning: ([storedError, materialized.warning].compactMap { $0 }.isEmpty
                    ? nil
                    : [storedError, materialized.warning].compactMap { $0 }.joined(separator: " "))
            )
        }
    }

    public static func readSnapshot(directory: URL) throws -> WorkbenchCaptureJournalSnapshot {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(WorkbenchCaptureJournalSnapshot.self, from: Data(contentsOf: directory.appendingPathComponent("session.json")))
    }

    public static func recover(directory: URL) throws -> WorkbenchCaptureJournalResult {
        let previous = try readSnapshot(directory: directory)
        let leaseIsCurrent = (previous.leaseExpiresAt ?? .distantPast) > Date()
        if ["preparing", "recording", "finalizing"].contains(previous.state), leaseIsCurrent, processIsAlive(previous.context.helperPID) {
            throw WorkbenchCaptureJournalError.captureStillRunning
        }
        let journal = try WorkbenchCaptureJournal(recovering: directory, snapshot: previous)
        return try journal.finish()
    }

    private init(recovering directory: URL, snapshot: WorkbenchCaptureJournalSnapshot) throws {
        self.directory = directory.standardizedFileURL
        self.context = snapshot.context
        self.createdAt = snapshot.createdAt
        self.maxPendingBlocks = 128
        self.state = "recoverable"
        self.error = snapshot.error ?? "Capture was interrupted and recovered from durable chunks."
        self.chunkCounts = [.microphone: snapshot.microphoneChunks, .system: snapshot.systemChunks]
        self.byteCounts = [.microphone: snapshot.microphoneBytes, .system: snapshot.systemBytes]
        self.nextSequence = self.chunkCounts
        self.heartbeatAt = snapshot.heartbeatAt
        self.leaseExpiresAt = snapshot.leaseExpiresAt
    }

    private static func processIsAlive(_ pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        if Darwin.kill(pid, 0) == 0 { return true }
        return errno == EPERM
    }

    private func chunksDirectory(for source: WorkbenchCaptureSource) -> URL {
        directory.appendingPathComponent("chunks", isDirectory: true).appendingPathComponent(source.rawValue, isDirectory: true)
    }

    private func consume(_ block: WorkbenchQueuedCaptureBlock) {
        defer {
            stateLock.lock()
            pendingBlocks = max(0, pendingBlocks - 1)
            stateLock.unlock()
        }
        do {
            if var accumulator = accumulators[block.source] {
                let expectedNanoseconds = accumulator.hostTimeNanoseconds
                    + UInt64((Double(accumulator.frameCount) / Double(accumulator.sampleRate)) * 1_000_000_000)
                let timingDelta = block.hostTimeNanoseconds > expectedNanoseconds
                    ? block.hostTimeNanoseconds - expectedNanoseconds
                    : expectedNanoseconds - block.hostTimeNanoseconds
                let compatible = accumulator.epoch == block.epoch
                    && accumulator.sampleRate == block.sampleRate
                    && accumulator.channelCount == block.channelCount
                    && timingDelta <= 2_000_000
                if compatible {
                    accumulator.data.append(block.data)
                    accumulator.frameCount += block.frameCount
                    accumulators[block.source] = accumulator
                } else {
                    try flushAccumulator(source: block.source)
                    accumulators[block.source] = WorkbenchCaptureAccumulator(
                        source: block.source, epoch: block.epoch, hostTimeNanoseconds: block.hostTimeNanoseconds,
                        sampleRate: block.sampleRate, channelCount: block.channelCount,
                        frameCount: block.frameCount, data: block.data
                    )
                }
            } else {
                accumulators[block.source] = WorkbenchCaptureAccumulator(
                    source: block.source, epoch: block.epoch, hostTimeNanoseconds: block.hostTimeNanoseconds,
                    sampleRate: block.sampleRate, channelCount: block.channelCount,
                    frameCount: block.frameCount, data: block.data
                )
            }
            if (accumulators[block.source]?.frameCount ?? 0) >= block.sampleRate * 2 {
                try flushAccumulator(source: block.source)
            }
        } catch {
            recordWriteFailure(error)
        }
    }

    private func flushAllAccumulators() throws {
        for source in WorkbenchCaptureSource.allCases { try flushAccumulator(source: source) }
    }

    private func flushAccumulator(source: WorkbenchCaptureSource) throws {
        guard let accumulator = accumulators.removeValue(forKey: source) else { return }
        do {
            stateLock.lock()
            let sequence = (nextSequence[source] ?? 0) + 1
            nextSequence[source] = sequence
            stateLock.unlock()
            let stem = String(format: "%08d", sequence)
            let pcmURL = chunksDirectory(for: accumulator.source).appendingPathComponent("\(stem).pcm")
            let metadataURL = chunksDirectory(for: accumulator.source).appendingPathComponent("\(stem).json")
            let digest = SHA256.hash(data: accumulator.data).map { String(format: "%02x", $0) }.joined()
            let metadata = WorkbenchCaptureChunkMetadata(
                source: accumulator.source,
                sequence: sequence,
                epoch: accumulator.epoch,
                hostTimeNanoseconds: accumulator.hostTimeNanoseconds,
                sampleRate: accumulator.sampleRate,
                channelCount: accumulator.channelCount,
                frameCount: accumulator.frameCount,
                byteCount: accumulator.data.count,
                sha256: digest,
                pcmFile: pcmURL.lastPathComponent
            )
            try accumulator.data.write(to: pcmURL, options: [.atomic])
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            try encoder.encode(metadata).write(to: metadataURL, options: [.atomic])
            stateLock.lock()
            chunkCounts[accumulator.source, default: 0] += 1
            byteCounts[accumulator.source, default: 0] += accumulator.data.count
            stateLock.unlock()
            try persistSnapshot()
        } catch { recordWriteFailure(error); throw error }
    }

    private func recordWriteFailure(_ failure: Error) {
        stateLock.lock()
        self.error = "Durable audio write failed: \(failure.localizedDescription)"
        state = "recoverable"
        stateLock.unlock()
        try? persistSnapshot()
    }

    private func verifiedChunks() throws -> ([WorkbenchCaptureChunkMetadata], String?) {
        var chunks: [WorkbenchCaptureChunkMetadata] = []
        var warnings: [String] = []
        let decoder = JSONDecoder()
        for source in WorkbenchCaptureSource.allCases {
            let sourceDirectory = chunksDirectory(for: source)
            let metadataFiles = (try? FileManager.default.contentsOfDirectory(at: sourceDirectory, includingPropertiesForKeys: nil))?
                .filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent } ?? []
            var expected = 1
            for metadataFile in metadataFiles {
                let metadata = try decoder.decode(WorkbenchCaptureChunkMetadata.self, from: Data(contentsOf: metadataFile))
                guard metadata.source == source else {
                    warnings.append("A chunk with the wrong source identity was excluded.")
                    continue
                }
                if metadata.sequence != expected {
                    warnings.append("A \(source.rawValue) sequence gap was preserved as a partial recording.")
                }
                let pcmURL = sourceDirectory.appendingPathComponent(metadata.pcmFile)
                let data = try Data(contentsOf: pcmURL)
                let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                guard data.count == metadata.byteCount, digest == metadata.sha256 else {
                    warnings.append("A damaged \(source.rawValue) chunk was excluded.")
                    expected = metadata.sequence + 1
                    continue
                }
                guard metadata.sampleRate == 16_000, metadata.channelCount == 1, metadata.frameCount * 2 == metadata.byteCount else {
                    warnings.append("An incompatible \(source.rawValue) chunk was excluded.")
                    expected = metadata.sequence + 1
                    continue
                }
                chunks.append(metadata)
                expected = metadata.sequence + 1
            }
            let pcmFiles = (try? FileManager.default.contentsOfDirectory(at: sourceDirectory, includingPropertiesForKeys: nil))?
                .filter { $0.pathExtension == "pcm" }.count ?? 0
            if pcmFiles != metadataFiles.count { warnings.append("An uncommitted \(source.rawValue) chunk was excluded.") }
        }
        return (chunks, warnings.isEmpty ? nil : warnings.joined(separator: " "))
    }

    private func materializeVerifiedTracks() throws -> (microphone: URL?, system: URL?, mixed: URL?, warning: String?) {
        let (chunks, warning) = try verifiedChunks()
        guard let origin = chunks.map(\.hostTimeNanoseconds).min() else {
            throw WorkbenchCaptureJournalError.noReadableAudio
        }
        let microphone = try materialize(source: .microphone, chunks: chunks, origin: origin)
        let system = try materialize(source: .system, chunks: chunks, origin: origin)
        let mixed = try mixAligned(microphone: microphone.url, system: system.url)
        let warnings = [warning, microphone.warning, system.warning].compactMap { $0 }
        return (microphone.url, system.url, mixed, warnings.isEmpty ? nil : warnings.joined(separator: " "))
    }

    private func materialize(source: WorkbenchCaptureSource, chunks: [WorkbenchCaptureChunkMetadata], origin: UInt64) throws -> (url: URL?, warning: String?) {
        let selected = chunks.filter { $0.source == source }.sorted {
            $0.hostTimeNanoseconds == $1.hostTimeNanoseconds ? $0.sequence < $1.sequence : $0.hostTimeNanoseconds < $1.hostTimeNanoseconds
        }
        guard !selected.isEmpty else { return (nil, nil) }
        let output = directory.appendingPathComponent("\(source.rawValue).wav")
        _ = FileManager.default.createFile(atPath: output.path, contents: WorkbenchWavWriter.header(dataSize: 0))
        let handle = try FileHandle(forWritingTo: output)
        defer { try? handle.close() }
        var endFrame = 0
        var trimmedOverlaps = 0
        for metadata in selected {
            let clockFrame = Int(((metadata.hostTimeNanoseconds - origin) * UInt64(metadata.sampleRate)) / 1_000_000_000)
            let overlapFrames = max(0, endFrame - clockFrame)
            if overlapFrames >= metadata.frameCount {
                trimmedOverlaps += 1
                continue
            }
            let startFrame = clockFrame + overlapFrames
            try handle.seek(toOffset: UInt64(44 + (startFrame * 2)))
            let pcmURL = chunksDirectory(for: source).appendingPathComponent(metadata.pcmFile)
            let pcm = try Data(contentsOf: pcmURL).dropFirst(overlapFrames * 2)
            try handle.write(contentsOf: pcm)
            endFrame = max(endFrame, clockFrame + metadata.frameCount)
        }
        try handle.seek(toOffset: 0)
        try handle.write(contentsOf: WorkbenchWavWriter.header(dataSize: UInt32(clamping: endFrame * 2)))
        try handle.synchronize()
        return (output, trimmedOverlaps == 0 ? nil : "Overlapping \(source.rawValue) callback frames were trimmed without shifting their timeline.")
    }

    private func mixAligned(microphone: URL?, system: URL?) throws -> URL? {
        guard microphone != nil || system != nil else { return nil }
        let output = directory.appendingPathComponent("mixed.wav")
        _ = FileManager.default.createFile(atPath: output.path, contents: WorkbenchWavWriter.header(dataSize: 0))
        let micHandle = try microphone.map { try FileHandle(forReadingFrom: $0) }
        let systemHandle = try system.map { try FileHandle(forReadingFrom: $0) }
        let outputHandle = try FileHandle(forWritingTo: output)
        defer {
            try? micHandle?.close()
            try? systemHandle?.close()
            try? outputHandle.close()
        }
        try micHandle?.seek(toOffset: 44)
        try systemHandle?.seek(toOffset: 44)
        try outputHandle.seekToEnd()
        let blockBytes = 32_768
        var written = 0
        while true {
            let micData = try micHandle?.read(upToCount: blockBytes) ?? Data()
            let systemData = try systemHandle?.read(upToCount: blockBytes) ?? Data()
            if micData.isEmpty && systemData.isEmpty { break }
            let frameCount = max(micData.count, systemData.count) / 2
            var mixed = Data(capacity: frameCount * 2)
            for frame in 0..<frameCount {
                func sample(_ data: Data) -> Int? {
                    let offset = frame * 2
                    guard offset + 1 < data.count else { return nil }
                    return Int(Int16(bitPattern: UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)))
                }
                let mic = sample(micData)
                let remote = sample(systemData)
                let contributors = (mic == nil ? 0 : 1) + (remote == nil ? 0 : 1)
                var value = Int16(clamping: contributors == 0 ? 0 : ((mic ?? 0) + (remote ?? 0)) / contributors).littleEndian
                withUnsafeBytes(of: &value) { mixed.append(contentsOf: $0) }
            }
            try outputHandle.write(contentsOf: mixed)
            written += mixed.count
        }
        try outputHandle.seek(toOffset: 0)
        try outputHandle.write(contentsOf: WorkbenchWavWriter.header(dataSize: UInt32(clamping: written)))
        try outputHandle.synchronize()
        return output
    }

    private func currentSnapshot() -> WorkbenchCaptureJournalSnapshot {
        stateLock.lock()
        defer { stateLock.unlock() }
        return WorkbenchCaptureJournalSnapshot(
            context: context,
            state: state,
            microphoneChunks: chunkCounts[.microphone] ?? 0,
            systemChunks: chunkCounts[.system] ?? 0,
            microphoneBytes: byteCounts[.microphone] ?? 0,
            systemBytes: byteCounts[.system] ?? 0,
            createdAt: createdAt,
            updatedAt: Date(),
            heartbeatAt: heartbeatAt,
            leaseExpiresAt: leaseExpiresAt,
            error: error
        )
    }

    private func persistSnapshot() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(currentSnapshot()).write(to: directory.appendingPathComponent("session.json"), options: [.atomic])
    }
}

public enum WorkbenchCaptureJournalError: Error, LocalizedError, Equatable {
    case invalidTransition
    case captureStillRunning
    case noReadableAudio
    case invalidControl

    public var errorDescription: String? {
        switch self {
        case .invalidTransition: return "Capture journal state transition is invalid."
        case .captureStillRunning: return "A live capture cannot be recovered."
        case .noReadableAudio: return "No verified audio chunks were available to recover."
        case .invalidControl: return "Capture control token is invalid."
        }
    }
}
