import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { BRAND, FIXED_ELEMENTS, NO_TEXT_MESSAGE, ResumeFormatError, buildResumeModel, formatResume, layoutResume, modelWords, renderResumePdf, resumeFileName } from "../src/resume-format/index.js";
import { FIXTURES } from "./fixtures/resume-format-fixtures.js";
import { docxBodyWords, pdfExtract } from "./helpers/resume-extract.js";

const words = (text) => text.split(/\s+/u).filter(Boolean);
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
  assert.deepEqual(items.map((item) => [item.ordered, item.level, item.number, item.lines.length]), [
    [false, 0, null, 1], [false, 1, null, 1], [false, 2, null, 2], [true, 0, 1, 1], [true, 0, 2, 1], [false, 1, null, 1],
  ]);
  assert.deepEqual(modelWords(model), ["Duties", "a", "b", "c", "wrapped", "c", "x", "y", "z", "back", "to", "body"]);
  assert.equal(model.blocks.at(-1).type, "paragraph");
});

test("a numbered list starts at its first number and continues across a blank line", () => {
  const model = buildResumeModel("3. three\n4. four\n\n5. five");
  const items = model.blocks.filter((block) => block.type === "listItem");
  assert.deepEqual(items.map((item) => item.number), [3, 4, 5]);
  assert.equal(items[0].start, 3);
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
  });

  test(`word for word, PDF: ${fixture.name}`, async () => {
    const file = await formatResume({ text: fixture.input, format: "pdf", candidateName: "Test Person" });
    const extracted = await pdfExtract(file.bytes);
    if (fixture.overlongToken) {
      // An address wider than the page has to break inside the word. Compare the letters.
      assert.equal(extracted.words.join(""), words(fixture.expected).join(""));
    } else {
      assert.deepEqual(extracted.words, words(fixture.expected));
    }
    if (fixture.minPages) assert.ok(extracted.pageCount >= fixture.minPages, `expected at least ${fixture.minPages} pages, got ${extracted.pageCount}`);
    assert.deepEqual(extracted.pageNumbers.filter(Boolean), Array.from({ length: extracted.pageCount }, (_, index) => String(index + 1)));
  });
}

test("the layout the PDF is drawn from has the same words as the model", async () => {
  for (const fixture of FIXTURES) {
    const model = buildResumeModel(fixture.input);
    const measure = (_key, text, size) => text.length * size * 0.5;
    const layout = layoutResume(model, { measure, logoHeightPt: 46 });
    assert.deepEqual(layout.words, modelWords(model), fixture.name);
  }
});

test("no markdown marks are printed", async () => {
  const fixture = FIXTURES.find((item) => item.markdownFixture);
  const docx = (await docxBodyWords((await formatResume({ text: fixture.input, format: "docx" })).bytes)).words.join(" ");
  const pdf = (await pdfExtract((await formatResume({ text: fixture.input, format: "pdf" })).bytes)).words.join(" ");
  for (const text of [docx, pdf]) {
    for (const mark of ["# ", "##", "***", "`", "](", "---", "https://", "```"]) assert.ok(!text.includes(mark), `output contains ${mark}`);
    assert.ok(!/(^| )[-*+] /u.test(text.replace("**star", "")), "a bullet mark was printed");
    assert.ok(!/(^| )\d+[.)] [A-Z]/u.test(text), "a list number was printed as text");
  }
});

// ---------------------------------------------------------------- Word styles

test("the Word file uses real styles, list numbering, links and a page-number field", async () => {
  const fixture = FIXTURES.find((item) => item.markdownFixture);
  const file = await formatResume({ text: fixture.input, format: "docx", candidateName: "Sam Rowan" });
  const { xml, zip } = await docxBodyWords(file.bytes);
  const styles = await zip.file("word/styles.xml").async("string");
  const numbering = await zip.file("word/numbering.xml").async("string");
  const footer = await zip.file("word/footer1.xml").async("string");
  for (const id of ["Title", "Heading1", "Heading2", "Heading3", "ListParagraph", "Hyperlink"]) assert.match(styles, new RegExp(`w:styleId="${id}"`), id);
  for (const id of ["Title", "Heading2", "Heading3"]) assert.match(xml, new RegExp(`<w:pStyle w:val="${id}"/>`), id);
  assert.match(xml, /<w:numPr>/u);
  assert.match(numbering, /w:numFmt w:val="bullet"/u);
  assert.match(numbering, /w:numFmt w:val="decimal"/u);
  assert.match(xml, /<w:b\/>/u);
  assert.match(xml, /<w:i\/>/u);
  assert.match(xml, /<w:hyperlink /u);
  assert.match(xml, /<w:pBdr><w:bottom /u); // the --- rule is a real paragraph border
  assert.match(xml, /w:w="12240" w:h="15840"/u); // US Letter
  assert.match(styles, /w:rFonts w:ascii="Arial"/u);
  assert.match(styles, /<w:keepNext\/>/u);
  assert.match(footer, /PAGE/u);
  assert.ok(!/<w:t[ >]/u.test(footer), "the footer must not hold typed text");
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

test("the only things added around the words are the logo and page numbers", async () => {
  const text = "Plain Name\n\nSECTION\n- one\n1. two";
  const pdf = await pdfExtract((await formatResume({ text, format: "pdf" })).bytes);
  assert.deepEqual(pdf.words, ["Plain", "Name", "SECTION", "one", "two"]);
  assert.deepEqual(pdf.pageNumbers.filter(Boolean), ["1"]);
  assert.deepEqual(pdf.markers, ["•", "1."]);
  assert.deepEqual(FIXED_ELEMENTS.map((item) => item.element), ["Logo image", "Page number"]);
  const docx = await docxBodyWords((await formatResume({ text, format: "docx" })).bytes);
  assert.deepEqual(docx.words, ["Plain", "Name", "SECTION", "one", "two"]);
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
