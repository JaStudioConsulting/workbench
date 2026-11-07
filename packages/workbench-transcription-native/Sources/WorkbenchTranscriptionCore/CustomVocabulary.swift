import Foundation

public struct WorkbenchCustomWord: Codable, Equatable, Sendable {
    public let word: String
    public let replacement: String?
    public let matchingThreshold: Double

    public init(word: String, replacement: String? = nil, matchingThreshold: Double = 0.82) {
        self.word = word
        self.replacement = replacement
        self.matchingThreshold = matchingThreshold
    }

    enum CodingKeys: String, CodingKey {
        case word
        case replacement
        case matchingThreshold = "matching_threshold"
    }
}

/// Portable JSON codec adapted from the pinned MIT-licensed Muesli dictionary
/// codec. It accepts either an array or a config object with `custom_words`.
public enum WorkbenchCustomVocabularyCodec {
    public struct MergeResult: Equatable, Sendable {
        public let words: [WorkbenchCustomWord]
        public let addedCount: Int
        public let updatedCount: Int
        public let skippedCount: Int
    }

    public enum CodecError: Error, LocalizedError {
        case invalidFormat

        public var errorDescription: String? {
            "The file is not a valid Workbench vocabulary dictionary."
        }
    }

    private struct ConfigShape: Decodable {
        let customWords: [WorkbenchCustomWord]

        enum CodingKeys: String, CodingKey {
            case customWords = "custom_words"
        }
    }

    public static func decode(_ data: Data) throws -> [WorkbenchCustomWord] {
        let decoder = JSONDecoder()
        if let words = try? decoder.decode([WorkbenchCustomWord].self, from: data) { return words }
        if let config = try? decoder.decode(ConfigShape.self, from: data) { return config.customWords }
        throw CodecError.invalidFormat
    }

    public static func encode(_ words: [WorkbenchCustomWord]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        var data = try encoder.encode(words)
        data.append(Data("\n".utf8))
        return data
    }

    public static func merge(_ imported: [WorkbenchCustomWord], into existing: [WorkbenchCustomWord]) -> MergeResult {
        var words = existing
        var indexes = Dictionary(uniqueKeysWithValues: existing.enumerated().map { (normalized($0.element.word), $0.offset) })
        var added = 0
        var updated = 0
        var skipped = 0

        for item in imported {
            let cleanWord = item.word.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleanWord.isEmpty else { skipped += 1; continue }
            let clean = WorkbenchCustomWord(
                word: cleanWord,
                replacement: item.replacement?.trimmingCharacters(in: .whitespacesAndNewlines),
                matchingThreshold: min(1, max(0, item.matchingThreshold))
            )
            let key = normalized(clean.word)
            if let index = indexes[key] {
                if words[index] == clean { skipped += 1 } else { words[index] = clean; updated += 1 }
            } else {
                indexes[key] = words.count
                words.append(clean)
                added += 1
            }
        }
        return MergeResult(words: words, addedCount: added, updatedCount: updated, skippedCount: skipped)
    }

    public static func applying(_ words: [WorkbenchCustomWord], to transcript: String) -> String {
        words.reduce(transcript) { current, item in
            let source = item.word.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !source.isEmpty else { return current }
            let replacement = item.replacement?.isEmpty == false ? item.replacement! : source
            let escaped = NSRegularExpression.escapedPattern(for: source)
            guard let expression = try? NSRegularExpression(pattern: "(?i)(?<![\\p{L}\\p{N}])\(escaped)(?![\\p{L}\\p{N}])") else {
                return current
            }
            return expression.stringByReplacingMatches(
                in: current,
                range: NSRange(current.startIndex..., in: current),
                withTemplate: NSRegularExpression.escapedTemplate(for: replacement)
            )
        }
    }

    private static func normalized(_ value: String) -> String {
        value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").lowercased()
    }
}

