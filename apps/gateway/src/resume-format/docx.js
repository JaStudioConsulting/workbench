// Word (.docx) output. Pure JavaScript (docx + jszip), no network, no clock.
// Real Word styles (Title, Heading 1-3, List Paragraph, Hyperlink), real list
// numbering definitions. No header or footer. Page setup is US Letter.

import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
} from "docx";
import { BRAND } from "./brand.js";

const FIXED_DATE = new Date(Date.UTC(2000, 0, 1));
const twips = (pt) => Math.round(pt * 20);
const halfPoints = (pt) => Math.round(pt * 2);
const cmToTwips = (pt) => Math.round(pt * 20);

function indentFor(level) {
  const { list } = BRAND;
  return { left: twips(list.textIndentPt + list.levelStepPt * level), hanging: twips(list.hangingPt) };
}

function levelConfig(level, { bullet, start = 1 }) {
  return {
    level,
    format: bullet ? LevelFormat.BULLET : LevelFormat.DECIMAL,
    text: bullet ? BRAND.list.bulletChar : `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    start: bullet ? undefined : start,
    style: { paragraph: { indent: indentFor(level) } },
  };
}

// Bullets are real list numbering. Numbers are the author's own typed numbers, written as
// text with a hanging indent (see blockParagraph), so they are never renumbered.
function numberingConfig() {
  return [{ reference: "bullets", levels: [0, 1, 2].map((level) => levelConfig(level, { bullet: true })) }];
}

function headingStyleOptions(style, { rule = false } = {}) {
  return {
    run: {
      font: BRAND.wordFontFamily,
      size: halfPoints(style.sizePt),
      bold: true,
      color: BRAND.color,
      // Capitals are a style property: the stored text stays exactly as typed.
      ...(style.caps ? { allCaps: true, characterSpacing: twips(style.letterSpacingPt) } : {}),
    },
    paragraph: {
      spacing: { before: twips(style.beforePt), after: twips(style.afterPt), line: twips(style.leadingPt), lineRule: LineRuleType.EXACT },
      keepNext: true,
      keepLines: true,
      ...(rule ? { border: { bottom: { style: BorderStyle.SINGLE, size: 7, space: 3, color: BRAND.color } } } : {}),
    },
  };
}

function lineChildren(lines) {
  const children = [];
  lines.forEach((line, index) => {
    if (index > 0) children.push(new TextRun({ break: 1 }));
    for (const run of line) {
      const text = new TextRun({ text: run.text, bold: run.bold || undefined, italics: run.italic || undefined, style: run.href ? "Hyperlink" : undefined });
      children.push(run.href ? new ExternalHyperlink({ link: run.href, children: [text] }) : text);
    }
  });
  return children;
}

function blockParagraph(block) {
  if (block.type === "title") return new Paragraph({ heading: HeadingLevel.TITLE, children: lineChildren(block.lines) });
  if (block.type === "heading") {
    const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][block.level - 1];
    return new Paragraph({ heading, children: lineChildren(block.lines) });
  }
  if (block.type === "listItem" && block.ordered) {
    const left = twips(BRAND.list.textIndentPt + BRAND.list.levelStepPt * block.level);
    const children = lineChildren(block.lines);
    return new Paragraph({
      style: "ListParagraph",
      ...(block.endsList ? { spacing: { after: twips(BRAND.styles.body.afterPt) } } : {}),
      indent: { left, hanging: twips(BRAND.list.numberHangingPt) },
      tabStops: [{ type: TabStopType.LEFT, position: left }],
      children: [new TextRun({ children: [block.marker, new Tab()] }), ...children],
    });
  }
  if (block.type === "listItem") {
    return new Paragraph({
      style: "ListParagraph",
      ...(block.endsList ? { spacing: { after: twips(BRAND.styles.body.afterPt) } } : {}),
      numbering: { reference: "bullets", level: block.level },
      children: lineChildren(block.lines),
    });
  }
  if (block.type === "rule") {
    const rule = BRAND.styles.ruleLine;
    return new Paragraph({
      spacing: { before: twips(rule.beforePt), after: twips(rule.afterPt), line: twips(rule.heightPt), lineRule: LineRuleType.EXACT },
      border: { bottom: { style: BorderStyle.SINGLE, size: 5, space: 1, color: BRAND.color } },
      children: [],
    });
  }
  return new Paragraph({ children: lineChildren(block.lines) });
}

// docx gives each hyperlink a random relationship id. Rename them in order so the
// same text always produces the same file.
function stabilizeLinkIds(documentXml, relsXml) {
  const ids = [...documentXml.matchAll(/<w:hyperlink [^>]*r:id="([^"]+)"/gu)].map((match) => match[1]);
  let nextDocument = documentXml;
  let nextRels = relsXml;
  [...new Set(ids)].forEach((id, index) => {
    const stable = `rIdLink${index + 1}`;
    nextDocument = nextDocument.split(`"${id}"`).join(`"${stable}"`);
    nextRels = nextRels.split(`"${id}"`).join(`"${stable}"`);
  });
  // The image id is a process-wide counter in docx; there is one image, so pin it.
  nextDocument = nextDocument.replace(/<wp:docPr id="\d+"/gu, '<wp:docPr id="1"');
  return { documentXml: nextDocument, relsXml: nextRels };
}

async function normalizeZip(buffer) {
  const source = await JSZip.loadAsync(buffer);
  const target = new JSZip();
  const stable = stabilizeLinkIds(
    await source.file("word/document.xml").async("string"),
    await source.file("word/_rels/document.xml.rels").async("string"),
  );
  for (const name of Object.keys(source.files)) {
    const entry = source.files[name];
    if (entry.dir) continue; // folder entries upset some cloud co-editing services
    let content = await entry.async("nodebuffer");
    if (name === "word/document.xml") content = Buffer.from(stable.documentXml, "utf8");
    if (name === "word/_rels/document.xml.rels") content = Buffer.from(stable.relsXml, "utf8");
    if (name === "docProps/core.xml") {
      content = Buffer.from(content.toString("utf8")
        .replace(/(<dcterms:created[^>]*>)[^<]*(<\/dcterms:created>)/u, "$12000-01-01T00:00:00Z$2")
        .replace(/(<dcterms:modified[^>]*>)[^<]*(<\/dcterms:modified>)/u, "$12000-01-01T00:00:00Z$2"), "utf8");
    }
    target.file(name, content, { date: FIXED_DATE, createFolders: false, compression: "DEFLATE" });
  }
  return target.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

export async function renderResumeDocx(model, { title } = {}) {
  const logoBytes = await readFile(BRAND.logoFile);
  const logoWidthPx = Math.round((BRAND.logoWidthPt * 96) / 72);
  const png = { width: logoBytes.readUInt32BE(16), height: logoBytes.readUInt32BE(20) };
  const logoHeightPx = Math.round((logoWidthPx * png.height) / png.width);
  const { styles, marginsPt: m, page } = BRAND;

  const logo = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: twips(BRAND.logoSpaceAfterPt), line: 240, lineRule: LineRuleType.AUTO },
    children: [new ImageRun({
      type: "png",
      data: logoBytes,
      transformation: { width: logoWidthPx, height: logoHeightPx },
      altText: { name: "Logo", title: BRAND.logoAltText, description: BRAND.logoAltText },
    })],
  });

  const doc = new Document({
    creator: "Recruiting Workbench",
    lastModifiedBy: "Recruiting Workbench",
    title: title || undefined,
    styles: {
      default: {
        document: {
          run: { font: BRAND.wordFontFamily, size: halfPoints(styles.body.sizePt), color: BRAND.color },
          paragraph: { spacing: { before: 0, after: twips(styles.body.afterPt), line: twips(styles.body.leadingPt), lineRule: LineRuleType.EXACT } },
        },
        title: headingStyleOptions(styles.title),
        heading1: headingStyleOptions(styles.heading1, { rule: true }),
        heading2: headingStyleOptions(styles.heading2, { rule: true }),
        heading3: headingStyleOptions(styles.heading3),
        listParagraph: {
          run: { font: BRAND.wordFontFamily, size: halfPoints(styles.listItem.sizePt) },
          paragraph: { spacing: { before: 0, after: twips(styles.listItem.afterPt), line: twips(styles.listItem.leadingPt), lineRule: LineRuleType.EXACT } },
        },
        hyperlink: { run: { color: BRAND.color, underline: {} } },
      },
      // Normal states the font as well as the document defaults, so previewers and
      // converters that ignore the defaults still draw the body in Arial.
      paragraphStyles: [{
        id: "Normal",
        name: "Normal",
        quickFormat: true,
        run: { font: BRAND.wordFontFamily, size: halfPoints(styles.body.sizePt), color: BRAND.color },
        paragraph: { spacing: { before: 0, after: twips(styles.body.afterPt), line: twips(styles.body.leadingPt), lineRule: LineRuleType.EXACT } },
      }],
    },
    numbering: { config: numberingConfig() },
    sections: [{
      properties: {
        page: {
          size: { width: twips(page.widthPt), height: twips(page.heightPt) },
          margin: { top: cmToTwips(m.top), bottom: cmToTwips(m.bottom), left: cmToTwips(m.left), right: cmToTwips(m.right) },
        },
      },
      children: [logo, ...model.blocks.map(blockParagraph)],
    }],
  });

  return normalizeZip(await Packer.toBuffer(doc));
}
