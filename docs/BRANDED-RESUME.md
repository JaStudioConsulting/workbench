# Branded resume formatter

The formatter creates branded PDF and Word files from saved resume text. It is deterministic and makes no AI or network calls. The content rule is exact: same words, order, characters and capitalization, except for the explicit formatting marks and exceptions below. It does not infer, correct or supplement candidate information.

## Complete formatting rules

- CRLF and CR line endings become LF. Tabs and ordinary spacing runs inside a line become one ordinary space; U+00A0 remains unchanged and is nonbreaking in both outputs. U+200B, U+200C, U+200D, U+2060 and U+FEFF are removed wherever they occur. Other unsupported control characters are rejected.
- Blank lines end paragraphs. A single line break within a paragraph remains a line break.
- `# ` through `###### ` at the start of a line form heading levels 1–3 (four to six hashes map to level 3), and a closing hash run preceded by a space is removed. A heading marker is recognised only when its text starts with an uppercase letter or digit. The first level-1 heading is the name/title block.
- A first short plain-text line may be the title. An all-capital short line at a block start may be a level-2 section heading. A short label ending in a colon at a block start may be a level-3 heading.
- Lines containing three or more `-`, `*` or `=` characters, with optional spaces, become rules. Underscore runs stay as typed text.
- `-`, `*`, `+` or a supported bullet glyph followed by a space and text forms a bullet. Plus is a bullet only when its text starts with a letter. Empty list items are dropped. Nested list indent is 0–1 spaces (level 0), 2–5 (level 1) or 6+ (level 2); a tab counts as four spaces. An indented non-list line can continue a list item.
- A numbered list item has one or two digits, `.` or `)`, a space and text starting with a letter or opening quote/bracket. It is a list only when another numbered item occurs in the same list area. Typed numbers and delimiters are retained as text and never renumbered. Empty list items are dropped.
- Only a matched pair of lines containing three or more backticks or tildes, optionally followed by one language word (letters, digits, `-` or `+`), is removed. Unmatched fence-like lines remain ordinary text. Content between a matched pair follows normal formatting rules.
- `**bold**`, `__bold__`, `*italic*`, `_italic_`, `***bold italic***` and backtick code marks are removed and represented as formatting. A mark run opens only at line start, after whitespace or after `(`, `[`, `{`, `"`, `'`, `“` or `‘`, and only before a non-space. It closes only after a non-space and before whitespace, line end or `)`, `]`, `}`, `"`, `'`, `”`, `’`, `.`, `,`, `;`, `:`, `!` or `?`. Marks inside URL, email and path-like tokens (tokens containing `://`, `@` or `/`) stay literal. Unclosed marks stay literal.
- `[text](https://example.com)` and `[text](mailto:name@example.invalid)` display only the text and retain the address as a clickable link. Nested parentheses in the address are balanced.
- The first short name-like line may be treated as the document title. All other unmatched text remains body text.

## Approved exceptions and fixed elements

- Section headings at levels 1 and 2 display in capitals as the old template did. Word stores the typed heading and applies the `allCaps` style property; PDF draws only these headings upper-cased. The PDF comparison is exact after this locale-independent, single-character uppercase transform; characters without a one-character uppercase form remain typed.
- No page numbers are added. Typed numbered list markers and their delimiters remain visible as text.
- The approved Top Tier Talent Group logo is the only added visible element. There is no firm-name line, header, footer, label, caption, confidentiality line, date or contact detail added by the formatter. Word files contain no header/footer part.
- The PDF.js test extractor normalizes U+00A0 to U+0020 when extracting text. The formatter model and PDF layout preserve NBSP as a single unbreakable word; Word XML preserves U+00A0. This extractor behavior is not a formatter whitespace substitution.
- Input is limited to 200,000 characters and 1 MB at the request boundary. A PDF requiring more than 150 pages fails with: `This resume is too long to format (over 150 pages). Shorten the saved text, then try again.`

## Approval desk source mapping

Structured `branded_resume` artifacts are formatted from `sections`, not the app-rendered `content.text`. The `name.value` is the first line and becomes the document title; `title.value` is the line beneath it, as in the old template. Each section becomes a heading: `Professional Summary`, `Core Competencies & Skills`, `Professional Experience`, `Education`, `Certifications`, and `Additional Information`. Claim `.text` values are emitted in stored order. Experience values are emitted in stored order from `title`, `dates`, `company`, `location`, then `bullets`; skill and experience bullet values use formatting markers that are removed by the formatter. The generated labels `Name` and `Title` are never printed.

When only `content.text` exists, the adapter recognises only these exact app labels: `Name`, `Title`, `Professional Summary`, `Core Competencies & Skills`, `Professional Experience`, `Education`, `Certifications`, and `Additional Information`. It treats all unrecognised blocks as body text in their original order. Existing `• ` prefixes in known section values become bullet formatting.
