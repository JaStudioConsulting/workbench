import Foundation

public struct WorkbenchSpeechSegment: Codable, Equatable, Sendable {
    public let start: TimeInterval
    public let end: TimeInterval
    public let text: String
    public let speaker: String?
    public let source: String

    public init(start: TimeInterval, end: TimeInterval, text: String, speaker: String? = nil, source: String) {
        self.start = start
        self.end = end
        self.text = text
        self.speaker = speaker
        self.source = source
    }
}

public struct WorkbenchSpeakerWindow: Equatable, Sendable {
    public let speakerID: String
    public let start: TimeInterval
    public let end: TimeInterval

    public init(speakerID: String, start: TimeInterval, end: TimeInterval) {
        self.speakerID = speakerID
        self.start = start
        self.end = end
    }
}

/// Source-preserving reconciliation adapted from the pinned Muesli meeting
/// pipeline. Remote/system speech wins only for clear overlapping duplicates.
public enum WorkbenchTranscriptReconciler {
    public static func reconcile(
        microphone: [WorkbenchSpeechSegment],
        system: [WorkbenchSpeechSegment]
    ) -> [WorkbenchSpeechSegment] {
        let uniqueSystem = deduplicate(system)
        let keptMicrophone = microphone.filter { mic in
            !uniqueSystem.contains { remote in
                overlap(mic, remote) >= 0.5 && equivalent(mic.text, remote.text)
            }
        }
        return (keptMicrophone + uniqueSystem).filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .sorted { $0.start == $1.start ? $0.end < $1.end : $0.start < $1.start }
    }

    private static func deduplicate(_ segments: [WorkbenchSpeechSegment]) -> [WorkbenchSpeechSegment] {
        var seen = Set<String>()
        return segments.sorted { $0.start < $1.start }.filter { segment in
            let key = normalized(segment.text)
            guard !key.isEmpty, !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
    }

    private static func overlap(_ left: WorkbenchSpeechSegment, _ right: WorkbenchSpeechSegment) -> Double {
        let shared = max(0, min(left.end, right.end) - max(left.start, right.start))
        return shared / max(0.1, left.end - left.start)
    }

    private static func equivalent(_ left: String, _ right: String) -> Bool {
        let a = normalized(left)
        let b = normalized(right)
        if a == b { return true }
        let aTokens = Set(a.split(separator: " "))
        let bTokens = Set(b.split(separator: " "))
        guard !aTokens.isEmpty else { return false }
        return Double(aTokens.intersection(bTokens).count) / Double(aTokens.count) >= 0.8
    }

    private static func normalized(_ text: String) -> String {
        text.lowercased().replacingOccurrences(of: "[^a-z0-9 ]", with: "", options: .regularExpression)
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }
}

public enum WorkbenchSpeakerAttribution {
    public static func attributedSegments(words: [WorkbenchSpeechSegment], windows: [WorkbenchSpeakerWindow]) -> [WorkbenchSpeechSegment] {
        let labels = labelMap(for: windows)
        var result: [WorkbenchSpeechSegment] = []
        for word in words.sorted(by: { $0.start < $1.start }) {
            let speakerID = speaker(for: word, windows: windows)
            let label = speakerID.flatMap { labels[$0] } ?? "Others"
            if let previous = result.last, previous.speaker == label, word.start - previous.end < 1.25 {
                result[result.count - 1] = WorkbenchSpeechSegment(
                    start: previous.start, end: word.end,
                    text: "\(previous.text) \(word.text)", speaker: label, source: word.source
                )
            } else {
                result.append(WorkbenchSpeechSegment(
                    start: word.start, end: word.end, text: word.text,
                    speaker: label, source: word.source
                ))
            }
        }
        return result
    }

    public static func speaker(for segment: WorkbenchSpeechSegment, windows: [WorkbenchSpeakerWindow]) -> String? {
        let midpoint = segment.start + ((segment.end - segment.start) / 2)
        if let containing = windows.first(where: { $0.start <= midpoint && $0.end >= midpoint }) {
            return containing.speakerID
        }
        return windows.min { distance(midpoint, $0) < distance(midpoint, $1) }?.speakerID
    }

    public static func labelMap(for windows: [WorkbenchSpeakerWindow]) -> [String: String] {
        var labels: [String: String] = [:]
        for window in windows.sorted(by: { $0.start < $1.start }) where labels[window.speakerID] == nil {
            labels[window.speakerID] = "Speaker \(labels.count + 1)"
        }
        return labels
    }

    private static func distance(_ point: TimeInterval, _ window: WorkbenchSpeakerWindow) -> TimeInterval {
        if point < window.start { return window.start - point }
        if point > window.end { return point - window.end }
        return 0
    }
}

public enum WorkbenchTranscriptFormatter {
    public static func labelled(_ segments: [WorkbenchSpeechSegment]) -> String {
        var lines: [(speaker: String, text: String)] = []
        for segment in segments.sorted(by: { $0.start < $1.start }) {
            let clean = segment.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clean.isEmpty else { continue }
            let speaker = segment.speaker ?? (segment.source == "microphone" ? "You" : "Others")
            if lines.last?.speaker == speaker {
                lines[lines.count - 1].text += " \(clean)"
            } else {
                lines.append((speaker, clean))
            }
        }
        return lines.map { "\($0.speaker): \($0.text)" }.joined(separator: "\n")
    }
}
