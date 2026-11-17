import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { BRAND } from "../../src/resume-format/brand.js";

const words = (text) => text.split(/\s+/u).filter(Boolean);

function decodeXml(text) {
  return text
    .replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&apos;/gu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/gu, "&");
}

// Text of word/document.xml: w:t text, with paragraph ends, w:br and w:tab as whitespace.
export async function docxBodyWords(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  const withBreaks = xml
    .replace(/<w:br\s*\/>/gu, " ")
    .replace(/<w:tab\s*\/>/gu, " ")
    .replace(/<\/w:p>/gu, " ");
  const text = [...withBreaks.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|(\s)/gu)]
    .map((match) => (match[2] ? " " : decodeXml(match[1])))
    .join("");
  return { words: words(text), xml, zip };
}

// Text drawn on each PDF page, grouped into lines. Bullet glyphs are separated out (they
// are marks, not words). Anything drawn in the bottom margin is reported in pageNumbers;
// the formatter draws nothing there, so tests expect it empty.
export async function pdfExtract(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items
      .filter((item) => item.str !== "" || item.hasEOL)
      .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, size: Math.abs(item.transform[3]) }));
    pages.push(items);
  }
  await task.destroy();

  const margin = BRAND.marginsPt;
  const bodyWords = [];
  const pageNumbers = [];
  const markers = [];
  const lines = [];
  pages.forEach((items) => {
    const footer = items.filter((item) => item.y < margin.bottom - 4);
    footer.forEach((item) => pageNumbers.push(item.str));
    const rows = new Map();
    for (const item of items.filter((entry) => entry.y >= margin.bottom - 4 && entry.str.trim() !== "")) {
      const key = Math.round(item.y * 2) / 2;
      rows.set(key, [...(rows.get(key) || []), item]);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, row]) => {
      row.sort((a, b) => a.x - b.x);
      let rest = row;
      // A marker (bullet or number) starts between the left margin and the list text.
      const first = row[0];
      const markerMatch = /^(•)(?:\s+|$)/u.exec(first.str); // only bullets are marks; typed numbers are words
      const textStarts = [0, 1, 2].map((level) => margin.left + BRAND.list.textIndentPt + BRAND.list.levelStepPt * level);
      const looksLikeMarker = first.x > margin.left + 0.6 && first.x < textStarts[2] - 1 && !textStarts.some((x) => Math.abs(first.x - x) < 0.6);
      if (markerMatch && looksLikeMarker) {
        markers.push(markerMatch[1]);
        const remainder = first.str.slice(markerMatch[0].length);
        rest = remainder ? [{ ...first, str: remainder, x: margin.left + BRAND.list.textIndentPt }, ...row.slice(1)] : row.slice(1);
      }
      let line = "";
      rest.forEach((item, index) => {
        if (index > 0) {
          const previous = rest[index - 1];
          line += item.x - (previous.x + previous.width) > item.size * 0.15 ? " " : "";
        }
        line += item.str;
      });
      lines.push(line);
      bodyWords.push(...words(line));
    });
  });
  return { words: bodyWords, lines, pageNumbers, markers, pageCount: pages.length };
}
