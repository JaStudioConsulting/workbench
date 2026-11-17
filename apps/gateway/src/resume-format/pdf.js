// PDF output. Pure JavaScript (pdf-lib), no network, no clock.
// The page is drawn from a layout model (layoutResume) that tests can inspect.

import { readFile } from "node:fs/promises";
import { PDFDocument, PDFString, rgb, setCharacterSpacing } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { BRAND, headingStyle, upperForDisplay } from "./brand.js";
import { ResumeFormatError, runsText } from "./model.js";

const ASCENT = 0.905; // Arimo hhea ascent / descent per em
const DESCENT = 0.212;
const EPSILON = 0.01;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function fontKeyFor(run, forceBold = false) {
  const bold = forceBold || run.bold;
  if (bold && run.italic) return "boldItalic";
  if (bold) return "bold";
  if (run.italic) return "italic";
  return "regular";
}

function toWords(line, forceBold, measure, size, caps = false) {
  const words = [];
  let current = null;
  const finish = () => {
    if (current) {
      current.width = current.frags.reduce((sum, frag) => sum + measure(frag.key, frag.text, size), 0);
      words.push(current);
      current = null;
    }
  };
  for (const run of line) {
    run.text.split(" ").forEach((part, index) => {
      if (index > 0) finish();
      if (part) {
        current ||= { frags: [], cont: false };
        current.frags.push({ text: caps ? upperForDisplay(part) : part, key: fontKeyFor(run, forceBold), href: run.href });
      }
    });
  }
  finish();
  return words;
}

function splitWord(word, maxWidth, measure, size) {
  const pieces = [];
  let piece = { frags: [], width: 0, cont: false };
  for (const frag of word.frags) {
    for (const { segment } of segmenter.segment(frag.text)) {
      const width = measure(frag.key, segment, size);
      if (piece.frags.length && piece.width + width > maxWidth) {
        pieces.push(piece);
        piece = { frags: [], width: 0, cont: true };
      }
      const last = piece.frags[piece.frags.length - 1];
      if (last && last.key === frag.key && last.href === frag.href) last.text += segment;
      else piece.frags.push({ text: segment, key: frag.key, href: frag.href });
      piece.width += width;
    }
  }
  if (piece.frags.length) pieces.push(piece);
  return pieces;
}

export function wrapLine(line, maxWidth, size, measure, forceBold = false, caps = false) {
  const words = toWords(line, forceBold, measure, size, caps);
  const space = measure("regular", " ", size);
  const lines = [];
  let current = { words: [], width: 0 };
  for (const word of words) {
    const pieces = word.width > maxWidth ? splitWord(word, maxWidth, measure, size) : [word];
    if (pieces.length > 1 && current.words.length) {
      lines.push(current);
      current = { words: [], width: 0 };
    }
    for (const piece of pieces) {
      const add = current.words.length ? space + piece.width : piece.width;
      if (current.words.length && current.width + add > maxWidth + EPSILON) {
        lines.push(current);
        current = { words: [piece], width: piece.width };
      } else {
        current.words.push(piece);
        current.width += add;
      }
    }
  }
  if (current.words.length) lines.push(current);
  return lines;
}

// Merge a wrapped line into draw segments (same font and link drawn as one string).
function segmentsOf(layoutLine, size, measure) {
  const space = measure("regular", " ", size);
  const segments = [];
  let pendingSpace = false;
  for (const word of layoutLine.words) {
    word.frags.forEach((frag, fragIndex) => {
      const last = segments[segments.length - 1];
      const spaceBefore = fragIndex === 0 && pendingSpace;
      if (last && last.key === frag.key && last.href === frag.href) {
        last.text += (spaceBefore ? " " : "") + frag.text;
      } else {
        segments.push({ text: frag.text, key: frag.key, href: frag.href, gap: spaceBefore ? space : 0 });
      }
    });
    pendingSpace = true;
  }
  return segments;
}

function planBlock(block, baseMeasure, contentWidth) {
  const { list } = BRAND;
  if (block.type === "rule") {
    const rule = BRAND.styles.ruleLine;
    return { kind: "rule", lines: [], lh: 0, before: rule.beforePt, after: rule.afterPt, extra: rule.heightPt, rule };
  }
  let style;
  let forceBold = false;
  let indent = 0;
  let marker = null;
  let wordRule = false;
  let measure = baseMeasure;
  let caps = false;
  let charSpacing = 0;
  if (block.type === "title") { style = BRAND.styles.title; forceBold = true; }
  else if (block.type === "heading") {
    style = headingStyle(block.level);
    forceBold = true;
    wordRule = Boolean(style.rule);
    // Section headings (levels 1 and 2) were the only capitals in the previous template.
    caps = Boolean(style.caps);
    charSpacing = style.letterSpacingPt || 0;
    if (charSpacing) measure = (key, text, size) => baseMeasure(key, text, size) + charSpacing * [...text].length;
  }
  else if (block.type === "listItem") {
    style = BRAND.styles.listItem;
    const textX = list.textIndentPt + list.levelStepPt * block.level;
    indent = textX;
    marker = { text: block.ordered ? block.marker : list.bulletChar, textX, hang: block.ordered ? list.numberHangingPt : list.hangingPt };
  } else style = BRAND.styles.body;

  const lines = [];
  for (const line of block.lines) lines.push(...wrapLine(line, contentWidth - indent, style.sizePt, measure, forceBold, caps));
  const extra = wordRule ? BRAND.headingRule.paddingPt + BRAND.headingRule.thicknessPt : 0;
  return {
    kind: block.type,
    style,
    lines,
    lh: style.leadingPt,
    before: style.beforePt,
    after: block.type === "listItem" && block.endsList ? BRAND.styles.body.afterPt : style.afterPt,
    extra,
    indent,
    marker,
    measure,
    caps,
    charSpacing,
    keepWithNext: Boolean(block.keepWithNext),
    wordRule,
  };
}

function baselineOffset(style) {
  return (style.leadingPt - (ASCENT + DESCENT) * style.sizePt) / 2 + ASCENT * style.sizePt;
}

export function layoutResume(model, { measure, logoHeightPt = 0 }) {
  const { page, marginsPt: m } = BRAND;
  const contentWidth = page.widthPt - m.left - m.right;
  const bottomLimit = page.heightPt - m.bottom;
  const plans = model.blocks.map((block) => planBlock(block, measure, contentWidth));
  const pages = [];
  const wordPieces = [];
  let current;
  let y;
  let pageTop;
  const startPage = () => {
    current = { items: [] };
    pages.push(current);
    y = m.top;
    pageTop = true;
  };
  startPage();

  if (logoHeightPt > 0) {
    const width = BRAND.logoWidthPt;
    current.items.push({ type: "image", x: m.left + (contentWidth - width) / 2, y: m.top, width, height: logoHeightPt });
    y += logoHeightPt + BRAND.logoSpaceAfterPt;
    pageTop = false;
  }

  const linesHeight = (plan, count) => count * plan.lh;
  const chainHeight = (index, gapFirst) => {
    let total = gapFirst;
    let prev = null;
    for (let j = index; j < plans.length; j += 1) {
      const plan = plans[j];
      if (j > index) total += prev.after + plan.before;
      if (plan.keepWithNext) {
        total += linesHeight(plan, plan.lines.length) + plan.extra;
        prev = plan;
        continue;
      }
      total += linesHeight(plan, Math.min(2, plan.lines.length)) + (plan.kind === "rule" ? plan.extra : 0);
      break;
    }
    return total;
  };

  const emit = (plan, from, count) => {
    for (let i = 0; i < count; i += 1) {
      const lineTop = y + i * plan.lh;
      const layoutLine = plan.lines[from + i];
      const baseline = lineTop + baselineOffset(plan.style);
      const x0 = m.left + plan.indent;
      if (from + i === 0 && plan.marker) {
        if (plan.marker.text !== BRAND.list.bulletChar) wordPieces.push(plan.marker.text);
        const markerWidth = measure("regular", plan.marker.text, plan.style.sizePt);
        const natural = m.left + plan.marker.textX - plan.marker.hang;
        const markerX = Math.min(natural, m.left + plan.marker.textX - markerWidth - 3);
        current.items.push({ type: "text", role: "marker", kind: plan.kind, x: markerX, baseline, text: plan.marker.text, key: "regular", size: plan.style.sizePt, width: markerWidth });
      }
      let x = x0;
      for (const segment of segmentsOf(layoutLine, plan.style.sizePt, plan.measure)) {
        x += segment.gap;
        const width = plan.measure(segment.key, segment.text, plan.style.sizePt);
        current.items.push({ type: "text", role: "body", kind: plan.kind, x, baseline, text: segment.text, key: segment.key, size: plan.style.sizePt, width, href: segment.href, charSpacing: plan.charSpacing });
        x += width;
      }
      for (const word of layoutLine.words) {
        const text = word.frags.map((frag) => frag.text).join("");
        if (word.cont && wordPieces.length) wordPieces[wordPieces.length - 1] += text;
        else wordPieces.push(text);
      }
    }
    if (plan.wordRule && from + count === plan.lines.length) {
      const ruleY = y + (count - 1) * plan.lh + plan.lh + BRAND.headingRule.paddingPt + BRAND.headingRule.thicknessPt / 2;
      current.items.push({ type: "line", x1: m.left, x2: m.left + contentWidth, y: ruleY, thickness: BRAND.headingRule.thicknessPt });
    }
  };

  let previousAfter = 0;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const gap = () => (pageTop ? 0 : previousAfter + plan.before);

    if (plan.kind === "rule") {
      const needed = gap() + plan.extra;
      if (!pageTop && y + needed > bottomLimit + EPSILON) startPage();
      y += gap();
      current.items.push({ type: "line", x1: m.left, x2: m.left + contentWidth, y: y + plan.extra / 2, thickness: plan.rule.thicknessPt });
      y += plan.extra;
      pageTop = false;
      previousAfter = plan.after;
      continue;
    }

    if (plan.keepWithNext && !pageTop && y + chainHeight(index, gap()) > bottomLimit + EPSILON) startPage();

    let from = 0;
    const total = plan.lines.length;
    while (from < total) {
      const remaining = total - from;
      const available = bottomLimit - y - gap();
      const wholeHeight = linesHeight(plan, remaining) + plan.extra;
      if (wholeHeight <= available + EPSILON) {
        y += gap();
        emit(plan, from, remaining);
        y += wholeHeight;
        pageTop = false;
        from = total;
        break;
      }
      let fit = Math.floor((available + EPSILON) / plan.lh);
      if (remaining <= 3 || plan.kind === "heading" || plan.kind === "title") {
        if (pageTop) {
          fit = Math.max(1, fit);
          y += gap();
          emit(plan, from, Math.min(fit, remaining));
          y += linesHeight(plan, Math.min(fit, remaining));
          from += Math.min(fit, remaining);
          if (from < total) startPage();
          continue;
        }
        startPage();
        continue;
      }
      fit = Math.min(fit, remaining - 2);
      if (fit < 2) {
        if (pageTop) fit = Math.max(1, fit);
        else { startPage(); continue; }
      }
      y += gap();
      emit(plan, from, fit);
      y += linesHeight(plan, fit);
      from += fit;
      startPage();
    }
    previousAfter = plan.after;
  }

  return { pages, words: wordPieces };
}

// @pdf-lib/fontkit 1.1.1 writes subset glyph data without padding. Fonts whose glyphs
// have odd byte lengths (Arimo) then get a corrupt short "loca" table and many letters
// draw as blanks. Padding each glyph to a 4-byte boundary, as real fonts do, fixes it.
function ensurePaddedSubsets(font) {
  const proto = Object.getPrototypeOf(font.createSubset());
  if (proto.__resumePaddedGlyphs) return;
  const addGlyph = proto._addGlyph;
  proto._addGlyph = function paddedAddGlyph(gid) {
    const index = addGlyph.call(this, gid);
    const last = this.glyf[this.glyf.length - 1];
    if (last && last.length % 4) {
      const padded = new last.constructor(last.length + 4 - (last.length % 4)); // same buffer class fontkit uses
      padded.fill(0);
      padded.set(last);
      this.glyf[this.glyf.length - 1] = padded;
      this.offset += padded.length - last.length;
    }
    return index;
  };
  proto.__resumePaddedGlyphs = true;
}

let fontBytesCache = null;
async function loadAssets() {
  if (!fontBytesCache) {
    const entries = await Promise.all(Object.entries(BRAND.pdfFonts).map(async ([key, file]) => [key, await readFile(file)]));
    fontBytesCache = { fonts: Object.fromEntries(entries), logo: await readFile(BRAND.logoFile) };
  }
  return fontBytesCache;
}

function describeChar(ch) {
  const code = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
  return `“${ch}” (U+${code})`;
}

export const isCapsBlock = (block) => block.type === "heading" && Boolean(headingStyle(block.level).caps);

// The words the PDF must show: the author's words, with section headings in capitals.
export function expectedPdfWords(model) {
  const words = [];
  for (const block of model.blocks) {
    if (block.type === "listItem" && block.ordered) words.push(block.marker);
    for (const line of block.lines || []) {
      const text = isCapsBlock(block) ? upperForDisplay(runsText(line)) : runsText(line);
      words.push(...text.split(/\s+/u).filter(Boolean));
    }
  }
  return words;
}

function assertDrawable(model, fontkitFonts) {
  const missing = new Map();
  for (const block of model.blocks) {
    for (const line of block.lines || []) {
      for (const run of line) {
        const key = fontKeyFor(run, block.type === "title" || block.type === "heading");
        const font = fontkitFonts[key];
        const shown = isCapsBlock(block) ? upperForDisplay(runsText([run])) : runsText([run]);
        for (const ch of shown) {
          if (ch === " ") continue;
          if (!font.hasGlyphForCodePoint(ch.codePointAt(0)) && !missing.has(ch)) missing.set(ch, true);
        }
      }
    }
  }
  if (missing.size) {
    const names = [...missing.keys()].slice(0, 3).map(describeChar).join(", ");
    throw new ResumeFormatError(
      "UNSUPPORTED_CHARACTER",
      `The PDF cannot draw ${missing.size === 1 ? "this character" : "these characters"} from the resume text: ${names}. Change ${missing.size === 1 ? "it" : "them"} in the resume text, or download the Word file instead.`,
    );
  }
}

export async function renderResumePdf(model, { title } = {}) {
  const assets = await loadAssets();
  const fontkitFonts = Object.fromEntries(Object.entries(assets.fonts).map(([key, bytes]) => [key, fontkit.create(bytes)]));
  assertDrawable(model, fontkitFonts);
  ensurePaddedSubsets(fontkitFonts.regular);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const fixed = new Date(Date.UTC(2000, 0, 1));
  pdf.setProducer("Recruiting Workbench");
  pdf.setCreator("Recruiting Workbench");
  pdf.setCreationDate(fixed);
  pdf.setModificationDate(fixed);
  if (title) pdf.setTitle(title);

  const fonts = {};
  for (const [key, bytes] of Object.entries(assets.fonts)) {
    fonts[key] = await pdf.embedFont(bytes, { subset: true, customName: `Arimo-${key}`, features: { liga: false, clig: false, calt: false } });
  }
  const logo = await pdf.embedPng(assets.logo);
  const logoHeightPt = (BRAND.logoWidthPt * logo.height) / logo.width;
  const measure = (key, text, size) => fonts[key].widthOfTextAtSize(text, size);

  const layout = layoutResume(model, { measure, logoHeightPt });
  const expected = expectedPdfWords(model);
  if (layout.words.length !== expected.length || layout.words.some((word, index) => word !== expected[index])) {
    throw new ResumeFormatError("FORMAT_CHECK_FAILED", "The PDF could not be laid out without changing the resume wording, so no file was made. Try the Word file instead.");
  }

  const { page: pageSize, color } = BRAND;
  const ink = rgb(Number.parseInt(color.slice(0, 2), 16) / 255, Number.parseInt(color.slice(2, 4), 16) / 255, Number.parseInt(color.slice(4, 6), 16) / 255);
  layout.pages.forEach((layoutPage) => {
    const page = pdf.addPage([pageSize.widthPt, pageSize.heightPt]);
    const flip = (top) => pageSize.heightPt - top;
    for (const item of layoutPage.items) {
      if (item.type === "image") {
        page.drawImage(logo, { x: item.x, y: flip(item.y + item.height), width: item.width, height: item.height });
      } else if (item.type === "line") {
        page.drawLine({ start: { x: item.x1, y: flip(item.y) }, end: { x: item.x2, y: flip(item.y) }, thickness: item.thickness, color: ink });
      } else {
        if (item.charSpacing) page.pushOperators(setCharacterSpacing(item.charSpacing));
        page.drawText(item.text, { x: item.x, y: flip(item.baseline), size: item.size, font: fonts[item.key], color: ink });
        if (item.charSpacing) page.pushOperators(setCharacterSpacing(0));
        if (item.href) {
          page.drawLine({ start: { x: item.x, y: flip(item.baseline) - 1.5 }, end: { x: item.x + item.width, y: flip(item.baseline) - 1.5 }, thickness: 0.5, color: ink });
          const annotation = pdf.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [item.x, flip(item.baseline) - 3, item.x + item.width, flip(item.baseline) + item.size],
            Border: [0, 0, 0],
            A: { Type: "Action", S: "URI", URI: PDFString.of(item.href) },
          });
          page.node.addAnnot(pdf.context.register(annotation));
        }
      }
    }
  });
  return pdf.save({ useObjectStreams: false });
}
