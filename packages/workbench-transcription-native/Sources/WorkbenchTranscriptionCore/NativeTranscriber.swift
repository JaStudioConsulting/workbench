import FluidAudio
import Foundation

public struct WorkbenchNativeTranscript: Sendable {
    public let transcript: String
    public let durationSeconds: Double
    public let wordCount: Int
    public let model: String
    public let segments: [WorkbenchSpeechSegment]
    public let speakers: [String]
    public let warning: String?
}

/// Workbench-owned local transcription using FluidAudio's Parakeet Unified
/// runtime. The model is downloaded into Workbench support, never Muesli data.
public actor WorkbenchNativeTranscriber {
    private static let unifiedModelRepository = "FluidInference/parakeet-unified-en-0.6b-coreml"
    private static let unifiedModelRevision = "d32e972dd4315f1dc3f6be28fb2aab0ab3e80358"

    private let supportDirectory: URL
    private let preparer: WorkbenchAudioFilePreparer
    private var manager: UnifiedAsrManager?
    private var diarizer: DiarizerManager?

    public init(supportDirectory: URL, preparer: WorkbenchAudioFilePreparer = WorkbenchAudioFilePreparer()) {
        self.supportDirectory = supportDirectory
        self.preparer = preparer
    }

    public func transcribe(
        sourceURL: URL,
        speakerLabels: Bool = false,
        vocabulary: [WorkbenchCustomWord] = [],
        progress: @Sendable (String) -> Void = { _ in }
    ) async throws -> WorkbenchNativeTranscript {
        let prepared = try await preparer.prepareAudio(sourceURL: sourceURL)
        defer {
            if prepared.deleteWhenDone {
                try? FileManager.default.removeItem(at: prepared.wavURL)
            }
        }

        let activeManager = try await loadedManager(progress: progress)
        progress("Transcribing locally")
        let samples = try AudioConverter().resampleAudioFile(prepared.wavURL)
        let timed = try await activeManager.transcribeWithTimings(samples)
        let text = WorkbenchCustomVocabularyCodec.applying(vocabulary, to: timed.text)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            throw WorkbenchTranscriptionError.emptyTranscript
        }
        var segments: [WorkbenchSpeechSegment] = []
        var speakers: [String] = []
        var warning: String?
        var transcript = text
        if speakerLabels {
            do {
                progress("Labelling speakers locally")
                let windows = try await diarizationWindows(samples: samples)
                let labels = WorkbenchSpeakerAttribution.labelMap(for: windows)
                let words = buildWordTimings(from: timed.tokenTimings)
                segments = groupedSegments(words: words, windows: windows, labels: labels)
                speakers = labels.values.sorted()
                let labelled = WorkbenchTranscriptFormatter.labelled(segments)
                if !labelled.isEmpty { transcript = labelled }
            } catch {
                warning = "Speaker labels were unavailable. The unlabelled transcript was preserved."
            }
        }
        return WorkbenchNativeTranscript(
            transcript: transcript,
            durationSeconds: prepared.durationSeconds,
            wordCount: text.split(whereSeparator: { $0.isWhitespace }).count,
            model: "parakeet-unified",
            segments: segments,
            speakers: speakers,
            warning: warning
        )
    }

    private func diarizationWindows(samples: [Float]) async throws -> [WorkbenchSpeakerWindow] {
        let active: DiarizerManager
        if let diarizer {
            active = diarizer
        } else {
            let candidate = DiarizerManager()
            let directory = supportDirectory.appendingPathComponent("models/diarization", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            candidate.initialize(models: try await .downloadIfNeeded(to: directory))
            diarizer = candidate
            active = candidate
        }
        return try active.performCompleteDiarization(samples, sampleRate: 16_000).segments.map {
            WorkbenchSpeakerWindow(
                speakerID: $0.speakerId,
                start: Double($0.startTimeSeconds),
                end: Double($0.endTimeSeconds)
            )
        }
    }

    private func groupedSegments(
        words: [WordTiming],
        windows: [WorkbenchSpeakerWindow],
        labels: [String: String]
    ) -> [WorkbenchSpeechSegment] {
        var result: [WorkbenchSpeechSegment] = []
        for word in words {
            let raw = WorkbenchSpeechSegment(
                start: word.startTime,
                end: word.endTime,
                text: word.word,
                source: "mixed"
            )
            let speakerID = WorkbenchSpeakerAttribution.speaker(for: raw, windows: windows)
            let speaker = speakerID.flatMap { labels[$0] } ?? "Others"
            if let previous = result.last, previous.speaker == speaker, word.startTime - previous.end < 1.25 {
                result[result.count - 1] = WorkbenchSpeechSegment(
                    start: previous.start,
                    end: word.endTime,
                    text: "\(previous.text) \(word.word)",
                    speaker: speaker,
                    source: "mixed"
                )
            } else {
                result.append(WorkbenchSpeechSegment(
                    start: word.startTime,
                    end: word.endTime,
                    text: word.word,
                    speaker: speaker,
                    source: "mixed"
                ))
            }
        }
        return result
    }

    private func loadedManager(progress: @Sendable (String) -> Void) async throws -> UnifiedAsrManager {
        if let manager { return manager }
        progress("Loading local transcription model")
        try FileManager.default.createDirectory(at: supportDirectory, withIntermediateDirectories: true)
        var revisions = ModelRegistry.revisionOverrides
        revisions[Self.unifiedModelRepository] = Self.unifiedModelRevision
        ModelRegistry.revisionOverrides = revisions
        let candidate = UnifiedAsrManager()
        try await candidate.loadModels(to: supportDirectory.appendingPathComponent("models", isDirectory: true))
        manager = candidate
        progress("Local transcription model ready")
        return candidate
    }
}

public enum WorkbenchTranscriptionError: Error, LocalizedError {
    case emptyTranscript

    public var errorDescription: String? {
        switch self {
        case .emptyTranscript:
            return "Local transcription returned no words."
        }
    }
}
