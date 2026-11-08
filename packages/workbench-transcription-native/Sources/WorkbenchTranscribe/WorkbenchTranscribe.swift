import ArgumentParser
import Foundation
import WorkbenchTranscriptionCore

@main
struct WorkbenchTranscribe: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "workbench-transcribe",
        abstract: "Private on-device transcription for Recruiting Workbench.",
        subcommands: [Transcribe.self, Capture.self, CaptureSession.self, RecoverCapture.self]
    )
}

enum OutputFormat: String, CaseIterable, ExpressibleByArgument {
    case text
    case json
}

struct Transcribe: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "transcribe",
        abstract: "Transcribe a local audio file with Workbench native models."
    )

    @Argument(help: "MP3, MP4, M4A, or WAV file to transcribe.")
    var file: String

    @Option(name: .long, help: "Output format: text or json.")
    var format: OutputFormat = .text

    @Option(name: .long, help: "Workbench-owned model and runtime directory.")
    var supportDir: String?

    @Flag(name: .long, help: "Attempt local speaker diarization and label transcript turns.")
    var speakerLabels = false

    @Option(name: .long, help: "Optional Workbench vocabulary dictionary JSON.")
    var vocabulary: String?

    mutating func validate() throws {
        let sourceURL = URL(fileURLWithPath: file).standardizedFileURL
        guard WorkbenchAudioFilePreparer.isSupportedFileURL(sourceURL) else {
            throw ValidationError("Supported file types are MP3, MP4, M4A, and WAV.")
        }
    }

    func run() async throws {
        let sourceURL = URL(fileURLWithPath: file).standardizedFileURL
        guard FileManager.default.fileExists(atPath: sourceURL.path) else {
            throw ValidationError("Audio file does not exist.")
        }

        let supportURL = supportDir.map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
                .appendingPathComponent("RecruitingWorkbench/native/support", isDirectory: true)
        let transcriber = WorkbenchNativeTranscriber(supportDirectory: supportURL)
        let vocabularyWords: [WorkbenchCustomWord]
        if let vocabulary {
            vocabularyWords = try WorkbenchCustomVocabularyCodec.decode(Data(contentsOf: URL(fileURLWithPath: vocabulary)))
        } else {
            vocabularyWords = []
        }
        let result = try await transcriber.transcribe(
            sourceURL: sourceURL,
            speakerLabels: speakerLabels,
            vocabulary: vocabularyWords
        ) { message in
            FileHandle.standardError.write(Data("[workbench] \(message)\n".utf8))
        }

        switch format {
        case .text:
            print(result.transcript)
        case .json:
            let envelope = TranscriptEnvelope(
                source: "workbench_native",
                data: TranscriptPayload(result)
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            FileHandle.standardOutput.write(try encoder.encode(envelope))
            FileHandle.standardOutput.write(Data("\n".utf8))
        }
    }
}

struct Capture: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "capture",
        abstract: "Record microphone audio with optional macOS system audio mixing."
    )

    @Argument(help: "Destination WAV file.")
    var output: String

    @Option(name: .long, help: "Recording duration in seconds.")
    var duration: Double

    @Flag(name: .long, help: "Attempt ScreenCaptureKit system audio capture.")
    var includeSystemAudio = false

    mutating func validate() throws {
        guard duration > 0, duration <= 14_400 else { throw ValidationError("Duration must be between 0 and 14400 seconds.") }
        guard URL(fileURLWithPath: output).pathExtension.lowercased() == "wav" else {
            throw ValidationError("Native meeting capture output must be a WAV file.")
        }
    }

    func run() async throws {
        let outputURL = URL(fileURLWithPath: output).standardizedFileURL
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let capture = WorkbenchNativeMeetingCapture()
        try await capture.start(outputURL: outputURL, includeSystemAudio: includeSystemAudio)
        try await Task.sleep(for: .seconds(duration))
        let result = try await capture.stop()
        let envelope = CaptureEnvelope(
            ok: true,
            audioPath: result.audioURL.path,
            usedSystemAudio: result.usedSystemAudio,
            warning: result.warning
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        FileHandle.standardOutput.write(try encoder.encode(envelope))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

struct CaptureSession: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "capture-session",
        abstract: "Run strict, durable native call capture until an authenticated stop or lease expiry."
    )

    @Argument(help: "Workbench-owned session directory.") var directory: String
    @Option(name: .long, help: "Gateway-created capture ID.") var sessionID: String
    @Option(name: .long, help: "Immutable Tracker job ID.") var jobID: String
    @Option(name: .long, help: "Immutable candidate source ID.") var candidateID: String
    @Option(name: .long, help: "Unpredictable gateway control token.") var controlID: String

    func run() async throws {
        let sessionDirectory = URL(fileURLWithPath: directory, isDirectory: true).standardizedFileURL
        try FileManager.default.createDirectory(at: sessionDirectory, withIntermediateDirectories: true)
        let leaseURL = sessionDirectory.appendingPathComponent("lease.json")
        guard let initialLease = readLease(at: leaseURL, controlID: controlID) else {
            throw ValidationError("A current capture lease is required before native audio starts.")
        }

        let signalFlag = WorkbenchStopSignal()
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)
        let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global(qos: .userInitiated))
        let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global(qos: .userInitiated))
        interrupt.setEventHandler { signalFlag.request("Capture stopped by interrupt signal.") }
        terminate.setEventHandler { signalFlag.request("Capture stopped by termination signal.") }
        interrupt.resume()
        terminate.resume()
        defer { interrupt.cancel(); terminate.cancel() }

        let recoveryDirectory = sessionDirectory.appendingPathComponent("recovery", isDirectory: true)
        let context = WorkbenchCaptureContext(
            sessionID: sessionID,
            jobID: jobID,
            candidateID: candidateID,
            controlID: controlID
        )
        let capture = WorkbenchNativeMeetingCapture()
        try await capture.start(
            outputURL: recoveryDirectory.appendingPathComponent("mixed.wav"),
            includeSystemAudio: true,
            journalDirectory: recoveryDirectory,
            context: context,
            requireSystemAudio: true
        )
        try await capture.heartbeat(controlID: controlID, leaseExpiresAt: initialLease.expiresAt)
        try writeJSON(CaptureSessionEvent(
            event: "ready", sessionID: sessionID, jobID: jobID, candidateID: candidateID,
            helperPID: context.helperPID, state: "recording",
            usedSystemAudio: true, warning: nil
        ))

        var stopReason: String?
        var lastHeartbeat = Date.distantPast
        while stopReason == nil {
            if let health = await capture.healthError() { stopReason = health; break }
            if let reason = signalFlag.reason { stopReason = reason; break }
            if try validStop(at: sessionDirectory.appendingPathComponent("control.json"), controlID: controlID) {
                stopReason = "Stopped by Workbench."
                break
            }
            guard let lease = readLease(at: leaseURL, controlID: controlID) else {
                stopReason = "Capture lease expired; partial audio was finalized."
                break
            }
            if Date().timeIntervalSince(lastHeartbeat) >= 1 {
                try await capture.heartbeat(controlID: controlID, leaseExpiresAt: lease.expiresAt)
                lastHeartbeat = Date()
            }
            try await Task.sleep(for: .milliseconds(250))
        }

        let result = try await capture.stop()
        let partial = stopReason != "Stopped by Workbench." || result.warning != nil
        try writeJSON(CaptureSessionEvent(
            event: "stopped", sessionID: sessionID, jobID: jobID, candidateID: candidateID,
            helperPID: context.helperPID,
            state: partial ? "partial" : "captured", usedSystemAudio: result.usedSystemAudio,
            warning: [stopReason, result.warning].compactMap { $0 }.joined(separator: " ")
        ))
    }
}

struct RecoverCapture: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "recover-capture",
        abstract: "Verify and finalize durable chunks left by an interrupted capture."
    )

    @Argument(help: "Capture recovery directory.") var directory: String
    @Option(name: .long, help: "Gateway control token stored in the capture journal.") var controlID: String

    func run() async throws {
        let recoveryDirectory = URL(fileURLWithPath: directory, isDirectory: true).standardizedFileURL
        let snapshot = try WorkbenchCaptureJournal.readSnapshot(directory: recoveryDirectory)
        guard snapshot.context.controlID == controlID else { throw ValidationError("Capture control token is invalid.") }
        let result = try WorkbenchCaptureJournal.recover(directory: recoveryDirectory)
        try writeJSON(CaptureSessionEvent(
            event: "recovered", sessionID: result.snapshot.context.sessionID,
            jobID: result.snapshot.context.jobID, candidateID: result.snapshot.context.candidateID,
            helperPID: result.snapshot.context.helperPID,
            state: "recovered", usedSystemAudio: result.systemWAV != nil,
            warning: result.warning
        ))
    }
}

private final class WorkbenchStopSignal: @unchecked Sendable {
    private let lock = NSLock()
    private var storedReason: String?
    var reason: String? { lock.lock(); defer { lock.unlock() }; return storedReason }
    func request(_ reason: String) { lock.lock(); storedReason = storedReason ?? reason; lock.unlock() }
}

private struct WorkbenchCaptureLease: Decodable {
    let controlID: String
    let expiresAt: Date
}

private struct WorkbenchCaptureControl: Decodable {
    let controlID: String
    let command: String
}

private func readLease(at url: URL, controlID: String) -> WorkbenchCaptureLease? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    guard let lease = try? decoder.decode(WorkbenchCaptureLease.self, from: data) else { return nil }
    return lease.controlID == controlID && lease.expiresAt > Date() ? lease : nil
}

private func validStop(at url: URL, controlID: String) throws -> Bool {
    guard let data = try? Data(contentsOf: url),
          let control = try? JSONDecoder().decode(WorkbenchCaptureControl.self, from: data)
    else { return false }
    return control.controlID == controlID && control.command == "stop"
}

private func writeJSON<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(value))
    FileHandle.standardOutput.write(Data("\n".utf8))
}

private struct CaptureSessionEvent: Encodable {
    let event: String
    let sessionID: String
    let jobID: String
    let candidateID: String
    let helperPID: Int32
    let state: String
    let usedSystemAudio: Bool
    let warning: String?
}

struct TranscriptEnvelope: Encodable {
    let ok = true
    let source: String
    let data: TranscriptPayload
}

struct TranscriptPayload: Encodable {
    let transcript: String
    let durationSeconds: Double
    let wordCount: Int
    let model: String
    let segments: [WorkbenchSpeechSegment]
    let speakers: [String]
    let warning: String?

    init(_ result: WorkbenchNativeTranscript) {
        transcript = result.transcript
        durationSeconds = result.durationSeconds
        wordCount = result.wordCount
        model = result.model
        segments = result.segments
        speakers = result.speakers
        warning = result.warning
    }
}

struct CaptureEnvelope: Encodable {
    let ok: Bool
    let audioPath: String
    let usedSystemAudio: Bool
    let warning: String?
}
