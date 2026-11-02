import FluidAudio
import Foundation

public struct WorkbenchNativeTranscript: Sendable {
    public let transcript: String
    public let durationSeconds: Double
    public let wordCount: Int
    public let model: String
}

/// Workbench-owned local transcription using FluidAudio's Parakeet Unified
/// runtime. The model is downloaded into Workbench support, never Muesli data.
public actor WorkbenchNativeTranscriber {
    private static let unifiedModelRepository = "FluidInference/parakeet-unified-en-0.6b-coreml"
    private static let unifiedModelRevision = "d32e972dd4315f1dc3f6be28fb2aab0ab3e80358"

    private let supportDirectory: URL
    private let preparer: WorkbenchAudioFilePreparer
    private var manager: UnifiedAsrManager?

    public init(supportDirectory: URL, preparer: WorkbenchAudioFilePreparer = WorkbenchAudioFilePreparer()) {
        self.supportDirectory = supportDirectory
        self.preparer = preparer
    }

    public func transcribe(
        sourceURL: URL,
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
        let text = try await activeManager.transcribe(samples)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            throw WorkbenchTranscriptionError.emptyTranscript
        }
        return WorkbenchNativeTranscript(
            transcript: text,
            durationSeconds: prepared.durationSeconds,
            wordCount: text.split(whereSeparator: { $0.isWhitespace }).count,
            model: "parakeet-unified"
        )
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
