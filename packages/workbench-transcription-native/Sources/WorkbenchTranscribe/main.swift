import ArgumentParser
import Foundation
import WorkbenchTranscriptionCore

@main
struct WorkbenchTranscribe: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "workbench-transcribe",
        abstract: "Private on-device transcription for Recruiting Workbench.",
        subcommands: [Transcribe.self, Capture.self]
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
