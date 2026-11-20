import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { BRAND, FIXED_ELEMENTS, NO_TEXT_MESSAGE, ResumeFormatError, assertDrawable, buildResumeModel, expectedPdfWords, formatResume, isCapsBlock, layoutResume, modelWords, renderResumePdf, resumeFileName, upperForDisplay } from "../src/resume-format/index.js";
import { FIXTURES } from "./fixtures/resume-format-fixtures.js";
import { docxBodyWords, pdfExtract } from "./helpers/resume-extract.js";
import { brandedResumeSourceText } from "../../console/src/features/operator-cases/brandedResumeSource.js";

const words = (text) => text.split(/[ \t\r\n]+/u).filter(Boolean);

// PDF text must equal the typed wording, with only level 1-2 headings upper-cased.
function assertPdfWords(model, actual, expected, label) {
  assert.deepEqual(actual, expectedPdfWords(model), `${label}: strict PDF text`);
  assert.deepEqual(modelWords(model), expected, `${label}: typed fixture wording`);
}
const kinds = (text) => buildResumeModel(text).blocks.map((block) => block.type);

// ---------------------------------------------------------------- structure rules

test("blank line ends a paragraph and a single line break is kept inside it", () => {
  const model = buildResumeModel("A first line that is far too long to be a name, in a paragraph.\nsecond line\n\n\n\nnext paragraph");
  assert.deepEqual(model.blocks.map((block) => block.type), ["paragraph", "paragraph"]);
  assert.equal(model.blocks[0].lines.length, 2);
});

test("markdown headings map to title and heading levels and drop only the marks", () => {
  const model = buildResumeModel("# Name Here\n\n## Section\n\n### Sub\n\n#### Deep ##\n\ntext");
  assert.deepEqual(model.blocks.map((block) => [block.type, block.level]), [["title", undefined], ["heading", 2], ["heading", 3], ["heading", 3], ["paragraph", undefined]]);
  assert.deepEqual(modelWords(model), ["Name", "Here", "Section", "Sub", "Deep", "text"]);
  assert.deepEqual(kinds("A first line that is far too long to be a name, in a paragraph.\n\n# Later Heading\n\nbody"), ["paragraph", "heading", "paragraph"]);
});

test("a hash without a following space is not a heading", () => {
  assert.deepEqual(kinds("A first line that is far too long to be a name, in a paragraph.\n\n#hashtag and #1 ranked"), ["paragraph", "paragraph"]);
});

test("plain-text title, section and label heading rules", () => {
  assert.deepEqual(kinds("Alex Rivera\n\nSUMMARY\nbody text\n\nSkills:\nPython"), ["title", "heading", "paragraph", "heading", "paragraph"]);
  const model = buildResumeModel("Alex Rivera\n\nSUMMARY\nbody\n\nSkills:\nPython");
  assert.deepEqual(model.blocks.filter((block) => block.type === "heading").map((block) => block.level), [2, 3]);
});

test("lines that cannot be classified stay body text", () => {
  // Not first line, lowercase letters, sentence punctuation, too long, no text after it.
  assert.deepEqual(kinds("first line is a long sentence that is not a name at all, really not.\n\nExperience\nbody"), ["paragraph", "paragraph"]);
  assert.deepEqual(kinds("Name\n\nTHIS IS A SENTENCE IN CAPITAL LETTERS THAT KEEPS GOING WAY PAST THE LIMIT OF EIGHT WORDS\nbody"), ["title", "paragraph"]);
  assert.deepEqual(kinds("Name\n\nUSED IN 2019.\nbody"), ["title", "paragraph"]);
  assert.deepEqual(kinds("Name\n\nLAST LINE"), ["title", "paragraph"]);
  assert.deepEqual(kinds("Name\nbody\nMID PARAGRAPH CAPS\nmore"), ["title", "paragraph"]);
  assert.deepEqual(kinds("Name\n\nPhone: 555 and more words on the line\nbody"), ["title", "paragraph"]);
  assert.deepEqual(kinds("Contact 555-0100\n\nbody"), ["paragraph", "paragraph"]);
});

test("a heading is kept with the next block", () => {
  for (const block of buildResumeModel("Name\n\nSECTION\ntext").blocks.filter((item) => item.type !== "paragraph")) {
    assert.equal(block.keepWithNext, true);
  }
});

test("bullets, numbers, nesting and continuation lines", () => {
  const model = buildResumeModel("Duties\n\n- a\n  - b\n      - c\n        wrapped c\n1. x\n2) y\n   * z\n\nback to body");
  const items = model.blocks.filter((block) => block.type === "listItem");
  assert.deepEqual(items.map((item) => [item.ordered, item.level, item.marker, item.lines.length]), [
    [false, 0, null, 1], [false, 1, null, 1], [false, 2, null, 2], [true, 0, "1.", 1], [true, 0, "2)", 1], [false, 1, null, 1],
  ]);
  assert.deepEqual(modelWords(model), ["Duties", "a", "b", "c", "wrapped", "c", "1.", "x", "2)", "y", "z", "back", "to", "body"]);
  assert.equal(model.blocks.at(-1).type, "paragraph");
});

test("typed numbers and delimiters are kept exactly: skipped, repeated, bracketed", () => {
  const model = buildResumeModel("3. three\n4. four\n\n7) seven\n7) again\n1. one\n01. zero one");
  const items = model.blocks.filter((block) => block.type === "listItem");
  assert.deepEqual(items.map((item) => item.marker), ["3.", "4.", "7)", "7)", "1.", "01."]);
});

test("list or prose: the number is kept either way, and doubtful lines are prose", () => {
  const prose = (text) => buildResumeModel(`Lead line that is far too long to be a name, in a paragraph.\n\n${text}`).blocks.slice(1);
  // 4 digits, text starting with a digit or symbol, and a lone numbered line are all prose.
  for (const text of ["2019. Moved to Toronto\n2020. Left", "1. 5 years in sales\n2. 10 years in ops", "1. $5 budget\n2. 100% uptime", "2. Moved to Toronto"]) {
    const blocks = prose(text);
    assert.ok(blocks.every((block) => block.type === "paragraph"), text);
    assert.deepEqual(modelWords({ blocks }), words(text), text);
  }
  // Two numbered lines in one list area are a list, even around bullets and indented lines.
  const list = prose("1. one\n  - sub\n    wrapped\n2. two");
  assert.deepEqual(list.map((block) => block.type), ["listItem", "listItem", "listItem"]);
  assert.deepEqual(list.filter((block) => block.ordered).map((block) => block.marker), ["1.", "2."]);
  // Prose between two numbered lines splits them: each is then alone.
  assert.ok(prose("1. one\nSome prose here\n2. two").every((block) => block.type === "paragraph"));
});

test("capitals apply to section headings only", () => {
  const model = buildResumeModel("# Sam Rowan\n\n# Sections\n\n## Summary\n\n### Sub heading\n\nBody Text Stays\n- Bullet Stays");
  assert.deepEqual(model.blocks.map((block) => [block.type, block.level ?? null, isCapsBlock(block)]), [
    ["title", null, false], ["heading", 1, true], ["heading", 2, true], ["heading", 3, false], ["paragraph", null, false], ["listItem", 0, false],
  ]);
  assert.equal(upperForDisplay("Straße und Größe é"), "STRAßE UND GRÖßE É"); // sharp s has no single-letter capital, kept
});

test("rules, fences and inline marks", () => {
  assert.deepEqual(kinds("A first line that is far too long to be a name, in a paragraph.\n\n---\n\nb\n* * *\n=====\nc"), ["paragraph", "rule", "paragraph", "rule", "rule", "paragraph"]);
  const model = buildResumeModel("```js\nlet x = 1\n```\n**bold** _it_ `code` [link](https://example.com/x) and [no](notalink)");
  assert.deepEqual(modelWords(model), ["let", "x", "=", "1", "bold", "it", "code", "link", "and", "[no](notalink)"]);
  const runs = model.blocks[1].lines[0];
  assert.deepEqual(runs.filter((run) => run.bold || run.italic || run.href).map((run) => [run.text, run.bold, run.italic, run.href]), [
    ["bold", true, false, null], ["it", false, true, null], ["link", false, false, "https://example.com/x"],
  ]);
});

test("inline marks obey boundaries and preserve punctuation, paths and addresses", () => {
  const cases = [
    ["5*3 and 2*4", "5*3 and 2*4"],
    ["2*2 grid, 3*3 grid", "2*2 grid, 3*3 grid"],
    ["2**3 and 4**5", "2**3 and 4**5"],
    ["https://x.com/_profile_", "https://x.com/_profile_"],
    ["snake_case", "snake_case"], ["a_b_c", "a_b_c"], ["C++", "C++"], ["*.pdf", "*.pdf"],
    ["rate: 5*", "rate: 5*"], ["2 * 3 * 4", "2 * 3 * 4"],
    ["**bold** text", "bold text"], ["_italic_ text", "italic text"], ["(**bold**)", "(bold)"],
  ];
  for (const [input, expected] of cases) assert.equal(modelWords(buildResumeModel(input)).join(" "), expected, input);
});

test("only matched fence lines disappear and their contents use normal rules", () => {
  assert.equal(modelWords(buildResumeModel("~~~ Experience ~~~\n**bold**\n- item\n# head")).join(" "), "~~~ Experience ~~~ bold item # head");
  assert.equal(modelWords(buildResumeModel("~~~js\n**bold**\n- item\n# head")).join(" "), "~~~js bold item # head");
  assert.equal(modelWords(buildResumeModel("~~~js\n**bold**\n- item\n~~~\ntext after closing **bold**")).join(" "), "bold item text after closing bold");
});

test("headings, rules, plus bullets, balanced links and invisible characters", () => {
  assert.equal(buildResumeModel("# of projects: 5").blocks[0].type, "paragraph");
  assert.deepEqual(buildResumeModel("### 2024 Results\nbody").blocks[0], { type: "heading", level: 3, lines: [[{ text: "2024 Results", bold: false, italic: false, href: null }]], keepWithNext: true });
  for (const text of ["+ 44 20 7946 0000", "+1 416 555 0100"]) assert.equal(modelWords(buildResumeModel(text)).join(" "), text);
  const link = buildResumeModel("[Wiki](https://en.wikipedia.org/wiki/Foo_(bar))").blocks[0].lines[0][0];
  assert.equal(link.text, "Wiki");
  assert.equal(link.href, "https://en.wikipedia.org/wiki/Foo_(bar)");
  assert.equal(buildResumeModel("___\ntext").blocks[0].type, "paragraph");
  assert.equal(modelWords(buildResumeModel("A\u200BB\u200CC\u200DD\u2060E\uFEFFF")).join(" "), "ABCDEF");
  assert.equal(modelWords(buildResumeModel("a\u00A0b")).join(" "), "a\u00A0b");
  assert.equal(modelWords(buildResumeModel("\u00A0edge\u00A0")).join(" "), "\u00A0edge\u00A0");
});

test("empty list items are omitted and oversized single lines parse linearly", () => {
  assert.equal(modelWords(buildResumeModel("- \n1. \n- visible")).join(" "), "visible");
  const start = performance.now();
  buildResumeModel("*a ".repeat(66_666) + "*a");
  assert.ok(performance.now() - start < 2000, `parser took ${performance.now() - start}ms`);
});

test("empty list items are absent from both generated formats", async () => {
  const text = "- \n1. \n- visible";
  const docx = await docxBodyWords((await formatResume({ text, format: "docx" })).bytes);
  const pdf = await pdfExtract((await formatResume({ text, format: "pdf" })).bytes);
  assert.deepEqual(docx.words, ["visible"]);
  assert.deepEqual(pdf.words, ["visible"]);
});

test("PDFs over 150 pages fail with the plain length message", async () => {
  const text = "x\n".repeat(99_998);
  await assert.rejects(formatResume({ text, format: "pdf" }), (error) => {
    assert.equal(error.message, "This resume is too long to format (over 150 pages). Shorten the saved text, then try again.");
    return true;
  });
});

test("approval desk adapter prints stored values and suppresses app labels", () => {
  const source = brandedResumeSourceText({ sections: {
    name: { value: "Alex Example" }, title: { value: "Maintenance Planner" },
    summary: [{ text: "Summary value exactly" }], skills: [{ text: "Skill one" }, { text: "Skill two" }],
    experience: [{ title: { value: "Planner" }, dates: { value: "2020–2024" }, company: { value: "Example Co" }, location: { value: "Toronto" }, bullets: [{ text: "Bullet value exactly" }] }],
    education: [{ text: "Diploma value" }], certifications: [{ text: "Certificate value" }], additionalInformation: [{ text: "Additional value" }],
  } });
  const model = buildResumeModel(source);
  assert.deepEqual(modelWords(model), ["Alex", "Example", "Maintenance", "Planner", "Professional", "Summary", "Summary", "value", "exactly", "Core", "Competencies", "&", "Skills", "Skill", "one", "Skill", "two", "Professional", "Experience", "Planner", "2020–2024", "Example", "Co", "Toronto", "Bullet", "value", "exactly", "Education", "Diploma", "value", "Certifications", "Certificate", "value", "Additional", "Information", "Additional", "value"]);
  assert.ok(!source.includes("Name\n") && !source.includes("Title\n"));
  const fallback = brandedResumeSourceText({ text: "Name\nAlex Example\n\nTitle\nMaintenance Planner\n\nProfessional Summary\nA value\n\nUnexpected label\nRetained value" });
  assert.deepEqual(modelWords(buildResumeModel(fallback)), ["Alex", "Example", "Maintenance", "Planner", "Professional", "Summary", "A", "value", "Unexpected", "label", "Retained", "value"]);
});

test("fontkit subset workaround is pinned to the exact tested version", async () => {
  const { readFile } = await import("node:fs/promises");
  const packageJson = JSON.parse(await readFile(new URL("../node_modules/@pdf-lib/fontkit/package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.version, "1.1.1");
});

test("PDF glyph validation covers bullet markers and typed number characters", () => {
  const model = buildResumeModel("- visible\n1. first\n2. second");
  const glyphs = { hasGlyphForCodePoint: (codePoint) => !["•".codePointAt(0), "1".codePointAt(0), "2".codePointAt(0)].includes(codePoint) };
  assert.throws(() => assertDrawable(model, Object.fromEntries(["regular", "bold", "italic", "boldItalic"].map((key) => [key, glyphs]))), /U\+2022/u);
  const numberOnly = { ...model, blocks: model.blocks.filter((block) => block.type === "listItem" && block.ordered) };
  assert.throws(() => assertDrawable(numberOnly, Object.fromEntries(["regular", "bold", "italic", "boldItalic"].map((key) => [key, glyphs]))), /U\+0031/u);
});

test("marks that are unclosed or inside a word stay as typed", () => {
  const input = "5*3 and snake_case_name and C++ and 50%+ and a * b and **unclosed and under_ and *";
  assert.deepEqual(modelWords(buildResumeModel(input)), words(input));
});

// ---------------------------------------------------------------- word for word

for (const fixture of FIXTURES) {
  test(`word for word, Word file: ${fixture.name}`, async () => {
    const file = await formatResume({ text: fixture.input, format: "docx", candidateName: "Test Person" });
    assert.deepEqual(words(fixture.expected), modelWords(buildResumeModel(fixture.input)));
    const extracted = await docxBodyWords(file.bytes);
    assert.deepEqual(extracted.words, words(fixture.expected));
    if (fixture.name.includes("non-breaking spaces")) assert.ok(extracted.xml.includes("\u00A0"), "Word XML preserves the typed NBSP");
  });

  test(`word for word, PDF: ${fixture.name}`, async () => {
    const file = await formatResume({ text: fixture.input, format: "pdf", candidateName: "Test Person" });
    const extracted = await pdfExtract(file.bytes);
    const model = buildResumeModel(fixture.input);
    if (fixture.overlongToken) {
      // PDF.js canonicalises NBSP to a normal space during extraction. Layout keeps it
      // inside one unbreakable word; Word XML preserves the actual character.
      assert.equal(extracted.words.join(""), expectedPdfWords(model).join("").replaceAll("\u00A0", ""));
    } else {
      assertPdfWords(model, extracted.words, words(fixture.expected), fixture.name);
    }
    if (fixture.expectMarkers) assert.deepEqual(model.blocks.filter((block) => block.type === "listItem" && block.ordered).map((block) => block.marker), fixture.expectMarkers);
    if (fixture.minPages) assert.ok(extracted.pageCount >= fixture.minPages, `expected at least ${fixture.minPages} pages, got ${extracted.pageCount}`);
    assert.deepEqual(extracted.pageNumbers.filter(Boolean), [], "nothing is drawn in the bottom margin: no page numbers");
  });
}

test("the layout the PDF is drawn from has the same words as the model", async () => {
  for (const fixture of FIXTURES) {
    const model = buildResumeModel(fixture.input);
    const measure = (_key, text, size) => text.length * size * 0.5;
    const layout = layoutResume(model, { measure, logoHeightPt: 46 });
    assert.deepEqual(layout.words, expectedPdfWords(model), fixture.name);
  }
});

test("no markdown marks are printed", async () => {
  const fixture = FIXTURES.find((item) => item.markdownFixture);
  const docx = (await docxBodyWords((await formatResume({ text: fixture.input, format: "docx" })).bytes)).words.join(" ");
  const pdf = (await pdfExtract((await formatResume({ text: fixture.input, format: "pdf" })).bytes)).words.join(" ");
  for (const text of [docx, pdf]) {
    for (const mark of ["# ", "##", "***", "`", "](", "---", "https://", "```"]) assert.ok(!text.includes(mark), `output contains ${mark}`);
    assert.ok(!/(^| )[-*+] /u.test(text.replace("**star", "")), "a bullet mark was printed");
  }
});

// ---------------------------------------------------------------- Word styles

test("the Word file uses real styles, bullet numbering, typed numbers, capitals as a style and no footer", async () => {
  const fixture = FIXTURES.find((item) => item.markdownFixture);
  const file = await formatResume({ text: fixture.input, format: "docx", candidateName: "Sam Rowan" });
  const { xml, zip } = await docxBodyWords(file.bytes);
  const styles = await zip.file("word/styles.xml").async("string");
  const numbering = await zip.file("word/numbering.xml").async("string");
  for (const id of ["Title", "Heading1", "Heading2", "Heading3", "ListParagraph", "Hyperlink"]) assert.match(styles, new RegExp(`w:styleId="${id}"`), id);
  for (const id of ["Title", "Heading2", "Heading3"]) assert.match(xml, new RegExp(`<w:pStyle w:val="${id}"/>`), id);
  assert.match(xml, /<w:numPr>/u);
  assert.match(numbering, /w:numFmt w:val="bullet"/u);
  assert.doesNotMatch(numbering, /w:numFmt w:val="decimal"/u, "numbers are the author's typed numbers, not automatic numbering");
  assert.match(xml, /<w:t xml:space="preserve">1\.<\/w:t><w:tab\/>/u, "typed number then a tab, with a hanging indent");
  assert.match(xml, /<w:ind w:left="\d+" w:hanging="\d+"\/>/u);
  const styleBlock = (id) => styles.slice(styles.indexOf(`w:styleId="${id}"`), styles.indexOf("</w:style>", styles.indexOf(`w:styleId="${id}"`)));
  assert.match(styleBlock("Heading1"), /<w:caps\/>/u);
  assert.match(styleBlock("Heading2"), /<w:caps\/>/u);
  assert.match(styleBlock("Heading2"), /<w:spacing w:val="6"\/>/u, "0.4px letter-spacing from the old template");
  for (const id of ["Title", "Heading3", "ListParagraph", "Normal"]) assert.doesNotMatch(styleBlock(id), /<w:caps\/>/u, `${id} is not capitalised`);
  assert.match(xml, /<w:b\/>/u);
  assert.match(xml, /<w:i\/>/u);
  assert.match(xml, /<w:hyperlink /u);
  assert.match(xml, /<w:pBdr><w:bottom /u); // the --- rule is a real paragraph border
  assert.match(xml, /w:w="12240" w:h="15840"/u); // US Letter
  assert.match(styles, /w:rFonts w:ascii="Arial"/u);
  assert.match(styles, /<w:keepNext\/>/u);
  assert.ok(!Object.keys(zip.files).some((name) => /footer|header/u.test(name)), "no header or footer parts");
  assert.ok(!/PAGE|footerReference|headerReference/u.test(xml), "no page number field");
  assert.ok(!/•/u.test(xml), "bullets must come from list numbering, not typed characters");
  const names = Object.keys(zip.files);
  assert.ok(names.every((name) => !name.endsWith("/")), "no folder entries in the zip");
});

// ---------------------------------------------------------------- PDF layout checks

test("PDF layout stays inside the margins, never strands a heading and never overlaps lines", async () => {
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  const { readFile } = await import("node:fs/promises");
  const regular = fontkit.create(await readFile(BRAND.pdfFonts.regular));
  const measure = (_key, text, size) => regular.layout(text).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * size / regular.unitsPerEm;
  for (const fixture of FIXTURES) {
    const layout = layoutResume(buildResumeModel(fixture.input), { measure, logoHeightPt: 46 });
    const limitRight = BRAND.page.widthPt - BRAND.marginsPt.right + 1;
    const limitBottom = BRAND.page.heightPt - BRAND.marginsPt.bottom;
    for (const page of layout.pages) {
      const text = page.items.filter((item) => item.type === "text");
      assert.ok(text.length > 0 || page === layout.pages[0], `${fixture.name}: empty page`);
      for (const item of text) {
        assert.ok(item.x >= BRAND.marginsPt.left - 1, `${fixture.name}: text left of margin`);
        if (!fixture.overlongToken) assert.ok(item.x + item.width <= limitRight, `${fixture.name}: text past right margin`);
        assert.ok(item.baseline <= limitBottom, `${fixture.name}: text below the bottom margin`);
      }
      const bodyLines = [...new Set(text.filter((item) => item.role === "body").map((item) => item.baseline))].sort((a, b) => a - b);
      for (let index = 1; index < bodyLines.length; index += 1) assert.ok(bodyLines[index] - bodyLines[index - 1] >= 10.4, `${fixture.name}: lines overlap`);
      const last = [...text].filter((item) => item.role === "body").at(-1);
      if (last && page !== layout.pages.at(-1)) assert.ok(!["heading", "title"].includes(last.kind), `${fixture.name}: heading left at the bottom of a page`);
    }
  }
});

test("a heading near the bottom of a page moves to the next page with its first lines", async () => {
  const filler = Array.from({ length: 52 }, (_, index) => `Filler line ${index + 1}`).join("\n");
  for (let extra = 0; extra < 6; extra += 1) {
    const text = `${filler}\n${Array.from({ length: extra }, (_, index) => `More ${index}`).join("\n")}\n\nNEXT SECTION\nFirst body line one\nFirst body line two\nFirst body line three`;
    const pdf = await pdfExtract((await formatResume({ text, format: "pdf" })).bytes);
    const flat = pdf.lines;
    const headingIndex = flat.indexOf("NEXT SECTION");
    assert.ok(headingIndex >= 0 && flat[headingIndex + 1] === "First body line one", `extra ${extra}`);
  }
});

// ---------------------------------------------------------------- fixed elements

test("the only thing added around the words is the logo: no page numbers, no footer", async () => {
  const text = "Plain Name\n\n## Section Head\n- one\n1. two\n3. three\n\n### Label Head\nBody Stays As Typed";
  const pdf = await pdfExtract((await formatResume({ text, format: "pdf" })).bytes);
  assert.deepEqual(pdf.words, ["Plain", "Name", "SECTION", "HEAD", "one", "1.", "two", "3.", "three", "Label", "Head", "Body", "Stays", "As", "Typed"]);
  assert.deepEqual(pdf.pageNumbers.filter(Boolean), []);
  assert.deepEqual(pdf.markers, ["•"]);
  assert.deepEqual(FIXED_ELEMENTS.map((item) => item.element), ["Logo image"]);
  const docx = await docxBodyWords((await formatResume({ text, format: "docx" })).bytes);
  assert.deepEqual(docx.words, ["Plain", "Name", "Section", "Head", "one", "1.", "two", "3.", "three", "Label", "Head", "Body", "Stays", "As", "Typed"], "Word stores the text as typed");
});

// ---------------------------------------------------------------- deterministic

test("the same text gives the same file, whatever the clock says", async () => {
  const fixture = FIXTURES.find((item) => item.markdownFixture);
  const first = {};
  for (const format of ["pdf", "docx"]) first[format] = (await formatResume({ text: fixture.input, format, candidateName: "Sam Rowan" })).bytes;
  mock.timers.enable({ apis: ["Date"], now: new Date("2031-05-17T09:30:00Z") });
  try {
    for (const format of ["pdf", "docx"]) {
      const again = (await formatResume({ text: fixture.input, format, candidateName: "Sam Rowan" })).bytes;
      assert.ok(again.equals(first[format]), `${format} changed between runs`);
    }
  } finally {
    mock.timers.reset();
  }
});

// ---------------------------------------------------------------- nothing silent

test("empty, missing or marks-only text makes no file and says so in one sentence", async () => {
  for (const text of ["", "   \n\t\n", undefined, null, 42, "---\n***", "﻿  "]) {
    for (const format of ["pdf", "docx"]) {
      await assert.rejects(formatResume({ text, format }), (error) => {
        assert.ok(error instanceof ResumeFormatError);
        assert.equal(error.code, "NO_RESUME_TEXT");
        assert.equal(error.message, NO_TEXT_MESSAGE);
        return true;
      });
    }
  }
  assert.equal(NO_TEXT_MESSAGE, "There is no resume text to format. Add or paste the resume text first, then try again.");
});

test("a character the PDF font cannot draw stops the PDF with a plain message, and Word still works", async () => {
  const text = "Name Here\n\nLoves 🚀 rockets and 漢字";
  await assert.rejects(formatResume({ text, format: "pdf" }), (error) => {
    assert.equal(error.code, "UNSUPPORTED_CHARACTER");
    assert.match(error.message, /PDF cannot draw these characters/u);
    assert.match(error.message, /🚀/u);
    assert.match(error.message, /U\+1F680/u);
    assert.match(error.message, /Word file instead/u);
    return true;
  });
  const docx = await docxBodyWords((await formatResume({ text, format: "docx" })).bytes);
  assert.deepEqual(docx.words, words(text));
});

test("hidden control characters and oversized text are refused with plain messages", async () => {
  await assert.rejects(formatResume({ text: `Name\u0007 Here`, format: "docx" }), (error) => error.code === "UNSUPPORTED_CHARACTER" && /control character \(U\+0007\)/u.test(error.message));
  await assert.rejects(formatResume({ text: "word ".repeat(50_000), format: "docx" }), (error) => error.code === "RESUME_TOO_LONG");
  await assert.rejects(formatResume({ text: "Name", format: "rtf" }), (error) => error.code === "INVALID_FORMAT");
});

test("file names come from the candidate name and are safe", () => {
  assert.equal(resumeFileName("Alex Rivera", "pdf"), "Alex Rivera - Top Tier Talent Group.pdf");
  assert.equal(resumeFileName("  ../../etc/passwd\"; rm -rf  ", "docx"), "etc passwd rm -rf - Top Tier Talent Group.docx");
  assert.equal(resumeFileName("José Müller-Łukasz", "pdf"), "José Müller-Łukasz - Top Tier Talent Group.pdf");
  assert.equal(resumeFileName("", "pdf"), "Candidate - Top Tier Talent Group.pdf");
  assert.equal(resumeFileName(undefined, "docx"), "Candidate - Top Tier Talent Group.docx");
});

test("a saved PDF keeps its font subset small and glyphs complete", async () => {
  const model = buildResumeModel("Name Here\n\nManufacturing engineer ALEX RIVERA");
  const bytes = await renderResumePdf(model, { title: "Name Here" });
  assert.ok(bytes.length < 200_000, `PDF is ${bytes.length} bytes`);
  const extracted = await pdfExtract(Buffer.from(bytes));
  assert.deepEqual(extracted.words, ["Name", "Here", "Manufacturing", "engineer", "ALEX", "RIVERA"]);
});
