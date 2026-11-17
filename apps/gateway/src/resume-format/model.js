// Resume text -> structured model. Formatting only.
//
// This file is the single formatting core shared by the PDF and Word outputs.
// It never rewrites, adds, reorders, corrects or drops words. The only characters
// it removes are formatting marks (see RULES below), and it throws instead of
// guessing when the text cannot be handled safely.
//
// Structure rules (the complete list; anything not matched is plain body text):
//   R1  Line breaks: CRLF/CR become LF. Whitespace inside a line collapses to one space.
//       A blank line ends the current paragraph. Several blank lines count as one.
//   R2  A single line break inside a paragraph is kept as a line break.
//   R3  "# ", "## ", "### " (1-6 hashes, then a space) starts a heading. One hash is
//       level 1, two is level 2, three to six is level 3. A closing run of hashes
//       preceded by a space is removed with the marks. If the very first block of the
//       text is a level-1 heading it becomes the Title.
//   R4  A line of only "-", "*", "_" or "=" (three or more, spaces allowed) is a rule.
//   R5  A line starting with one of - * + or a bullet character (see BULLET_CHARS)
//       followed by a space and more text is a bullet item. The marker is removed.
//   R6  Numbered item (list rather than prose). A line is a numbered item only when ALL
//       hold: it starts with 1 or 2 digits, then "." or ")", then a space; the text after
//       it starts with a letter or an opening quote, bracket or parenthesis (so
//       "1. 5 years in sales" is prose); and another numbered line sits in the same
//       list area (a lone "2. Moved to Toronto" is prose). The list area runs across
//       blank lines, bullet lines and indented lines, and stops at any other line.
//       Anything else (for example "2019. Moved to Toronto") is body text with its
//       number kept. The typed number and its delimiter are CONTENT: they are shown
//       exactly as typed ("1.", "1)", "4." after "2.") and are never renumbered.
//   R7  List nesting: marker indent of 0-1 spaces is level 0, 2-5 is level 1, 6+ is
//       level 2 (a tab counts as 4 spaces).
//   R8  A non-list line indented at least 2 spaces directly under a list item
//       continues that item (as a new line inside the same item).
//   R9  Code fences (a line of 3+ backticks or tildes, with an optional language word)
//       are removed with the marks; the lines between them stay plain body lines.
//   R10 Inline marks: **bold** and __bold__, *italic* and _italic_, ***both***,
//       `code` (shown as plain text), and [text](http(s) or mailto link). Marks are
//       removed and the formatting is applied. A link keeps its address as a real
//       link; only the link text is printed. Marks that are not closed, or that sit
//       inside a word (for example snake_case or 5*3), are left as written.
//   R11 Title: the first block of the text, when it is a single short line (at most
//       6 words and 50 characters) made only of letters, spaces and . , ' - and
//       followed by more text, is the Title.
//   R12 Section heading: a single line, at most 8 words and 60 characters, with no
//       lowercase letters and at least 2 letters, that does not end in . , or ;, that
//       comes after a blank line or the start of the text and is followed by more
//       text, is a level-2 heading.
//   R13 Label heading: a single line, at most 6 words and 50 characters, ending in
//       a colon (the colon stays), with no other colon, after a blank line or the
//       start of the text and followed by more text, is a level-3 heading.
//   R14 Everything else is body text.

export class ResumeFormatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ResumeFormatError";
    this.code = code;
  }
}

export const MAX_RESUME_CHARS = 200_000;

export const NO_TEXT_MESSAGE = "There is no resume text to format. Add or paste the resume text first, then try again.";

const BULLET_CHARS = "•·▪▫◦●○■□►‣⁃∙";
const BULLET_RE = new RegExp(`^([ \\t]*)([-*+${BULLET_CHARS}])[ \\t\\u00A0]+(\\S.*)$`, "u");
const NUMBER_RE = /^([ \t]*)(\d{1,2}[.)])[ \t\u00A0]+(\S.*)$/u;
const ITEM_TEXT_START_RE = /^[\p{L}"'“‘(\[]/u;
const MD_HEADING_RE = /^ {0,3}(#{1,6})[ \t\u00A0]+(.*)$/u;
const RULE_RE = /^[ \t]*([-*_=])(?:[ \t]*\1){2,}[ \t]*$/u;
const FENCE_RE = /^[ \t]*(?:`{3,}|~{3,})[^`]*$/u;
const WS_RUN_RE = /[ \t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/gu;
// C0/C1 controls other than tab and newline cannot be stored in Word files or drawn.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

function indentWidth(raw) {
  let width = 0;
  for (const ch of raw) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4;
    else break;
  }
  return width;
}

function levelForIndent(width) {
  if (width >= 6) return 2;
  if (width >= 2) return 1;
  return 0;
}

const isWhitespace = (ch) => ch === undefined || /\s/u.test(ch);
const isPunctuation = (ch) => ch !== undefined && /[\p{P}\p{S}]/u.test(ch);
const isAlphanumeric = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function normalizeHref(href) {
  try { return new URL(href).href; } catch { return null; }
}

function pushRun(runs, text, style) {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && last.bold === style.bold && last.italic === style.italic && last.href === style.href) {
    last.text += text;
    return;
  }
  runs.push({ text, bold: style.bold, italic: style.italic, href: style.href });
}

function findCloser(src, from, char, count) {
  for (let j = from; j < src.length; j += 1) {
    if (src[j] !== char) continue;
    let end = j;
    while (src[end] === char) end += 1;
    const runLength = end - j;
    if (runLength === count) {
      const prev = src[j - 1];
      const next = src[end];
      const left = next !== undefined && !isWhitespace(next) && (!isPunctuation(next) || isWhitespace(prev) || isPunctuation(prev));
      const right = prev !== undefined && !isWhitespace(prev) && (!isPunctuation(prev) || isWhitespace(next) || isPunctuation(next));
      const canClose = char === "*" ? right : right && (!left || isPunctuation(next));
      if (canClose && j > from) return j;
    }
    j = end - 1;
  }
  return -1;
}

// Inline marks -> runs. Text outside recognised marks is copied unchanged.
export function parseInline(src, style = { bold: false, italic: false, href: null }, runs = []) {
  let buffer = "";
  const flush = () => { pushRun(runs, buffer, style); buffer = ""; };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "`") {
      const close = src.indexOf("`", i + 1);
      if (close > i + 1) {
        flush();
        pushRun(runs, src.slice(i + 1, close), style);
        i = close + 1;
        continue;
      }
    } else if (ch === "[") {
      const closeBracket = src.indexOf("]", i + 1);
      if (closeBracket > i + 1 && src[closeBracket + 1] === "(" && !src.slice(i + 1, closeBracket).includes("[")) {
        const closeParen = src.indexOf(")", closeBracket + 2);
        const href = closeParen > 0 ? src.slice(closeBracket + 2, closeParen) : "";
        const safeHref = /^(?:https?:\/\/|mailto:)\S+$/iu.test(href) ? normalizeHref(href) : null;
        if (safeHref) {
          flush();
          parseInline(src.slice(i + 1, closeBracket), { ...style, href: safeHref }, runs);
          i = closeParen + 1;
          continue;
        }
      }
    } else if (ch === "*" || ch === "_") {
      let end = i;
      while (src[end] === ch) end += 1;
      const count = end - i;
      if (count <= 3) {
        const prev = src[i - 1];
        const next = src[end];
        const left = next !== undefined && !isWhitespace(next) && (!isPunctuation(next) || isWhitespace(prev) || isPunctuation(prev));
        const right = prev !== undefined && !isWhitespace(prev) && (!isPunctuation(prev) || isWhitespace(next) || isPunctuation(next));
        const canOpen = ch === "*" ? left : left && (!right || isPunctuation(prev));
        if (canOpen) {
          const close = findCloser(src, end, ch, count);
          if (close > end && src.slice(end, close).trim()) {
            flush();
            parseInline(src.slice(end, close), {
              ...style,
              bold: style.bold || count >= 2,
              italic: style.italic || count === 1 || count === 3,
            }, runs);
            i = close + count;
            continue;
          }
        }
      }
      buffer += src.slice(i, end);
      i = end;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return runs;
}

export const runsText = (runs) => runs.map((run) => run.text).join("");
export const lineText = (line) => runsText(line);

function plainRuns(text) {
  return text ? [{ text, bold: false, italic: false, href: null }] : [];
}

function classify(rawLine, insideFence) {
  if (insideFence) {
    if (FENCE_RE.test(rawLine)) return { kind: "fence" };
    const text = rawLine.replace(WS_RUN_RE, " ").trim();
    return text ? { kind: "code", text } : { kind: "blank" };
  }
  if (!rawLine.trim()) return { kind: "blank" };
  if (FENCE_RE.test(rawLine)) return { kind: "fence" };
  if (RULE_RE.test(rawLine)) return { kind: "rule" };
  const heading = MD_HEADING_RE.exec(rawLine);
  if (heading) {
    const text = heading[2].replace(/(?:^|[ \t]+)#+[ \t]*$/u, "").replace(WS_RUN_RE, " ").trim();
    if (text) return { kind: "heading", level: Math.min(heading[1].length, 3), text };
  }
  const bullet = BULLET_RE.exec(rawLine);
  if (bullet) return { kind: "bullet", indent: indentWidth(bullet[1]), text: bullet[3].replace(WS_RUN_RE, " ").trim() };
  const numbered = NUMBER_RE.exec(rawLine);
  if (numbered) {
    const text = numbered[3].replace(WS_RUN_RE, " ").trim();
    // Only a candidate until the list-area check below confirms it.
    if (ITEM_TEXT_START_RE.test(text)) return { kind: "number", indent: indentWidth(numbered[1]), marker: numbered[2], text, raw: rawLine };
  }
  return { kind: "text", indent: indentWidth(rawLine), text: rawLine.replace(WS_RUN_RE, " ").trim() };
}

// A numbered candidate is a list item only when another candidate is in the same list
// area. Otherwise it is prose and keeps its number as typed.
function confirmNumberedItems(infos) {
  const skippable = (info) => info.kind === "blank" || info.kind === "bullet"
    || (info.kind === "text" && info.indent >= 2);
  const hasNeighbour = (from, step) => {
    for (let k = from + step; k >= 0 && k < infos.length; k += step) {
      if (infos[k].kind === "number") return true;
      if (!skippable(infos[k])) return false;
    }
    return false;
  };
  return infos.map((info, index) => {
    if (info.kind !== "number") return info;
    if (hasNeighbour(index, 1) || hasNeighbour(index, -1)) return info;
    return { kind: "text", indent: info.indent, text: info.raw.replace(WS_RUN_RE, " ").trim() };
  });
}

const wordsOf = (text) => text.split(/\s+/u).filter(Boolean);

function isTitleLine(text) {
  if (text.length > 50 || wordsOf(text).length > 6) return false;
  return /^[\p{L}\p{M}][\p{L}\p{M} .,'’-]*$/u.test(text) && !/:$/u.test(text);
}

function isSectionHeadingLine(text) {
  if (text.length > 60 || wordsOf(text).length > 8 || /[.,;]$/u.test(text)) return false;
  let letters = 0;
  for (const ch of text) {
    if (ch.toLowerCase() !== ch.toUpperCase()) {
      letters += 1;
      if (ch !== ch.toUpperCase()) return false;
    }
  }
  return letters >= 2;
}

function isLabelHeadingLine(text) {
  return text.length <= 50 && wordsOf(text).length <= 6 && /:$/u.test(text)
    && !text.slice(0, -1).includes(":") && /\p{L}/u.test(text);
}

export function buildResumeModel(input) {
  if (typeof input !== "string" || !input.replace(/^\uFEFF/u, "").trim()) {
    throw new ResumeFormatError("NO_RESUME_TEXT", NO_TEXT_MESSAGE);
  }
  if (input.length > MAX_RESUME_CHARS) {
    throw new ResumeFormatError("RESUME_TOO_LONG", "This resume text is too long to format as one file. Shorten it or split it, then try again.");
  }
  const text = input.replace(/^\uFEFF/u, "").replace(/\r\n?|\u2028|\u2029|\u0085/gu, "\n");
  const control = CONTROL_RE.exec(text);
  if (control) {
    const code = control[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
    throw new ResumeFormatError("UNSUPPORTED_CHARACTER", `The resume text contains a hidden control character (U+${code}) that cannot be placed in a file. Remove it from the resume text, then try again.`);
  }

  const lines = text.split("\n").map((raw, index, all) => ({ raw, index, total: all.length }));
  const blocks = [];
  let insideFence = false;
  let previousKind = "start"; // start | blank | text | list | heading | rule
  let lastItem = null;
  let lastParagraph = null;

  const nextNonBlankExists = (from) => {
    for (let k = from + 1; k < lines.length; k += 1) if (lines[k].raw.trim()) return true;
    return false;
  };
  const breakFlow = (kind) => { previousKind = kind; lastItem = null; lastParagraph = null; };

  // Classify every line first (fence state is sequential), then confirm numbered items.
  const classified = [];
  let fenceOpen = false;
  for (const entry of lines) {
    const info = classify(entry.raw, fenceOpen);
    if (info.kind === "fence") fenceOpen = !fenceOpen;
    classified.push(info);
  }
  const infos = confirmNumberedItems(classified);

  for (const entry of lines) {
    const info = infos[entry.index];
    if (info.kind === "fence") {
      insideFence = !insideFence;
      breakFlow("blank");
      continue;
    }
    if (info.kind === "blank") {
      breakFlow("blank");
      continue;
    }
    if (info.kind === "code") {
      if (lastParagraph && previousKind === "text") lastParagraph.lines.push(plainRuns(info.text));
      else {
        lastParagraph = { type: "paragraph", lines: [plainRuns(info.text)] };
        blocks.push(lastParagraph);
      }
      previousKind = "text";
      lastItem = null;
      continue;
    }
    if (info.kind === "rule") {
      blocks.push({ type: "rule" });
      breakFlow("rule");
      continue;
    }
    if (info.kind === "heading") {
      const runs = parseInline(info.text);
      const first = blocks.length === 0;
      if (first && info.level === 1) blocks.push({ type: "title", lines: [runs], keepWithNext: true });
      else blocks.push({ type: "heading", level: info.level, lines: [runs], keepWithNext: true });
      breakFlow("heading");
      continue;
    }
    if (info.kind === "bullet" || info.kind === "number") {
      const level = levelForIndent(info.indent);
      const ordered = info.kind === "number";
      const item = {
        type: "listItem",
        ordered,
        level,
        marker: ordered ? info.marker : null, // the author's own number and delimiter
        indent: info.indent,
        lines: [parseInline(info.text)],
      };
      blocks.push(item);
      lastItem = item;
      lastParagraph = null;
      previousKind = "list";
      continue;
    }

    // Plain text line.
    if (lastItem && previousKind === "list" && info.indent >= lastItem.indent + 2) {
      lastItem.lines.push(parseInline(info.text));
      continue;
    }
    const runs = parseInline(info.text);
    const display = runsText(runs);
    const atBlockStart = previousKind === "start" || previousKind === "blank";
    const hasMore = nextNonBlankExists(entry.index);
    if (atBlockStart && hasMore && display) {
      if (blocks.length === 0 && isTitleLine(display)) {
        blocks.push({ type: "title", lines: [runs], keepWithNext: true });
        breakFlow("heading");
        continue;
      }
      if (isSectionHeadingLine(display)) {
        blocks.push({ type: "heading", level: 2, lines: [runs], keepWithNext: true });
        breakFlow("heading");
        continue;
      }
      if (isLabelHeadingLine(display)) {
        blocks.push({ type: "heading", level: 3, lines: [runs], keepWithNext: true });
        breakFlow("heading");
        continue;
      }
    }
    if (lastParagraph && previousKind === "text") lastParagraph.lines.push(runs);
    else {
      lastParagraph = { type: "paragraph", lines: [runs] };
      blocks.push(lastParagraph);
    }
    previousKind = "text";
    lastItem = null;
  }

  // The last item of a list gets paragraph spacing so the next block does not touch it.
  let rootOrdered = null;
  blocks.forEach((block, index) => {
    if (block.type !== "listItem") return;
    if (block.level === 0) rootOrdered = block.ordered;
    const next = blocks[index + 1];
    block.endsList = !next || next.type !== "listItem" || (next.level === 0 && next.ordered !== rootOrdered);
  });

  const model = { blocks };
  if (!modelWords(model).length) throw new ResumeFormatError("NO_RESUME_TEXT", NO_TEXT_MESSAGE);
  return model;
}

export function blockLines(block) {
  return block.lines || [];
}

// The words of the body, in order. This is what the word-for-word guarantee compares.
export function modelWords(model) {
  const words = [];
  for (const block of model.blocks) {
    if (block.type === "listItem" && block.ordered) words.push(block.marker); // the author's own number
    for (const line of blockLines(block)) words.push(...wordsOf(runsText(line)));
  }
  return words;
}

export function wordsOfText(text) {
  return wordsOf(String(text));
}
