import ArgumentParser
import Foundation
import WorkbenchTranscriptionCore

@main
struct WorkbenchTranscribe: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "workbench-transcribe",
        abstract: "Private on-device transcription for Recruiting Workbench.",
        subcommands: [Transcribe.self]
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
        let result = try await transcriber.transcribe(sourceURL: sourceURL) { message in
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

    init(_ result: WorkbenchNativeTranscript) {
        transcript = result.transcript
        durationSeconds = result.durationSeconds
        wordCount = result.wordCount
        model = result.model
    }
}
