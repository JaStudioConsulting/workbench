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
}
