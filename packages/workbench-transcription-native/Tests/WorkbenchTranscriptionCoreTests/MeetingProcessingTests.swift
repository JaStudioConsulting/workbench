import Foundation
import Testing
@testable import WorkbenchTranscriptionCore

@Suite struct MeetingProcessingTests {
    @Test func mixerAveragesAlignedSourcesAndPreservesTails() {
        #expect(WorkbenchAudioMixer.mix(microphone: [100, 300], system: [300]) == [200, 300])
    }

    @Test func vocabularyCodecReadsPortableAndConfigShapes() throws {
        let portable = Data(#"[{"word":"plc","replacement":"PLC","matching_threshold":0.9}]"#.utf8)
        let config = Data(#"{"custom_words":[{"word":"cmms","replacement":"CMMS","matching_threshold":0.8}]}"#.utf8)
        #expect(try WorkbenchCustomVocabularyCodec.decode(portable).first?.replacement == "PLC")
        #expect(try WorkbenchCustomVocabularyCodec.decode(config).first?.replacement == "CMMS")
        #expect(WorkbenchCustomVocabularyCodec.applying(try WorkbenchCustomVocabularyCodec.decode(portable), to: "plc work") == "PLC work")
    }

    @Test func reconciliationDropsOnlyOverlappingDuplicates() {
        let mic = [
            WorkbenchSpeechSegment(start: 0, end: 2, text: "same source words", source: "microphone"),
            WorkbenchSpeechSegment(start: 3, end: 4, text: "local reply", source: "microphone"),
        ]
        let system = [WorkbenchSpeechSegment(start: 0.2, end: 2.1, text: "same source words", source: "system")]
        let result = WorkbenchTranscriptReconciler.reconcile(microphone: mic, system: system)
        #expect(result.map(\.text) == ["same source words", "local reply"])
        #expect(result.first?.source == "system")
    }

    @Test func speakerAttributionAndFormattingProduceReadableTurns() {
        let windows = [
            WorkbenchSpeakerWindow(speakerID: "a", start: 0, end: 2),
            WorkbenchSpeakerWindow(speakerID: "b", start: 2, end: 4),
        ]
        let labels = WorkbenchSpeakerAttribution.labelMap(for: windows)
        let first = WorkbenchSpeechSegment(start: 0.2, end: 1, text: "Hello", speaker: labels["a"], source: "mixed")
        let second = WorkbenchSpeechSegment(start: 2.2, end: 3, text: "Hi", speaker: labels["b"], source: "mixed")
        #expect(WorkbenchSpeakerAttribution.speaker(for: first, windows: windows) == "a")
        #expect(WorkbenchTranscriptFormatter.labelled([first, second]) == "Speaker 1: Hello\nSpeaker 2: Hi")
    }

    @Test func threeSpeakerPipelinePreservesEveryDetectedSpeaker() {
        let windows = [
            WorkbenchSpeakerWindow(speakerID: "local", start: 0, end: 1),
            WorkbenchSpeakerWindow(speakerID: "remote-a", start: 1, end: 2),
            WorkbenchSpeakerWindow(speakerID: "remote-b", start: 2, end: 3),
        ]
        let words = [
            WorkbenchSpeechSegment(start: 0.1, end: 0.4, text: "One", source: "mixed"),
            WorkbenchSpeechSegment(start: 1.1, end: 1.4, text: "Two", source: "mixed"),
            WorkbenchSpeechSegment(start: 2.1, end: 2.4, text: "Three", source: "mixed"),
        ]
        let segments = WorkbenchSpeakerAttribution.attributedSegments(words: words, windows: windows)
        #expect(segments.map(\.speaker) == ["Speaker 1", "Speaker 2", "Speaker 3"])
        #expect(WorkbenchTranscriptFormatter.labelled(segments).contains("Speaker 3: Three"))
    }

    @Test func durableJournalAggregatesCallbacksAndKeepsCommonClockAlignment() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let context = WorkbenchCaptureContext(sessionID: "capture-1", jobID: "job-1", candidateID: "sourcing:1", helperPID: 999_999, controlID: "control-1")
        let journal = try WorkbenchCaptureJournal(directory: directory, context: context, maxPendingBlocks: 256)
        try journal.markReady()
        let start: UInt64 = 1_000_000_000
        let block = Array(repeating: Int16(1_000), count: 1_600)
        for index in 0..<100 {
            let timestamp = start + UInt64(index * 100_000_000)
            #expect(journal.enqueue(block, source: .microphone, hostTimeNanoseconds: timestamp))
            if index.isMultiple(of: 10) {
                try journal.heartbeat(controlID: "control-1", leaseExpiresAt: Date().addingTimeInterval(10))
            }
        }
        // System callbacks arrive later but carry the original first-frame clock.
        #expect(journal.enqueue(block, source: .system, hostTimeNanoseconds: start + 500_000_000))
        let result = try journal.finish()
        let metadata = try FileManager.default.contentsOfDirectory(
            at: directory.appendingPathComponent("chunks/microphone"),
            includingPropertiesForKeys: nil
        ).filter { $0.pathExtension == "json" }
        #expect(metadata.count <= 6)
        #expect(result.microphoneWAV != nil)
        #expect(result.systemWAV != nil)
        #expect(result.mixedWAV != nil)
        let systemBytes = try Data(contentsOf: result.systemWAV!)
        #expect(systemBytes.count >= 44 + 16_000)
        #expect(systemBytes[44 + 15_998] == 0)
        #expect(systemBytes[44 + 16_000] != 0)
    }

    @Test func recoveryRefusesAJournalOwnedByALiveHelper() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let context = WorkbenchCaptureContext(sessionID: "capture-live", jobID: "job-1", candidateID: "sourcing:1", controlID: "control-live")
        let journal = try WorkbenchCaptureJournal(directory: directory, context: context)
        try journal.markReady()
        try journal.heartbeat(controlID: "control-live", leaseExpiresAt: Date().addingTimeInterval(10))
        #expect(throws: WorkbenchCaptureJournalError.captureStillRunning) {
            _ = try WorkbenchCaptureJournal.recover(directory: directory)
        }
    }

    @Test func expiredLeaseAllowsVerifiedChunkRecoveryEvenWhenPIDIsReused() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let context = WorkbenchCaptureContext(sessionID: "capture-expired", jobID: "job-1", candidateID: "sourcing:1", controlID: "control-expired")
        let journal = try WorkbenchCaptureJournal(directory: directory, context: context)
        try journal.markReady()
        let block = Array(repeating: Int16(500), count: 1_600)
        for index in 0..<20 {
            #expect(journal.enqueue(block, source: .microphone, hostTimeNanoseconds: 1_000_000_000 + UInt64(index * 100_000_000)))
        }
        try journal.heartbeat(controlID: "control-expired", leaseExpiresAt: Date().addingTimeInterval(-1))
        let recovered = try WorkbenchCaptureJournal.recover(directory: directory)
        #expect(recovered.snapshot.state == "partial")
        #expect(recovered.microphoneWAV != nil)
        #expect(recovered.warning?.contains("recovered") == true)
    }
}
