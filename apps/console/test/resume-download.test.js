import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBrandResumePayload,
  getResumeSource,
  openBrandedResume,
} from "../src/features/candidate-review/brandResume.js";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const branderHtml = fs.readFileSync(path.join(consoleRoot, "resume-brander.html"), "utf8");
const exporterSource = fs.readFileSync(path.join(consoleRoot, "src/resume-brander-export.js"), "utf8");
const resumeSectionSource = fs.readFileSync(
  path.join(consoleRoot, "src/features/candidate-review/ResumeSection.jsx"),
  "utf8",
);
const viteSource = fs.readFileSync(path.join(consoleRoot, "vite.config.js"), "utf8");

test("resume brander prints the edited paper instead of rebuilding a separate PDF layout", () => {
  assert.match(viteSource, /resumeBrander:/);
  assert.match(branderHtml, /src="\/src\/resume-brander-export\.js"/);
  assert.match(branderHtml, /await window\.printBrandedResume\(\{ title: getPdfTitle\(\) \}\)/);
  assert.match(exporterSource, /window\.print\(\)/);
  assert.doesNotMatch(exporterSource, /pdfMake|buildDocument|pageSize/);
  assert.doesNotMatch(branderHtml, /pdfMake|downloadBrandedResumePdf/);
  assert.match(branderHtml, /@page\s*\{[\s\S]*?size:\s*Letter;/);
});

test("download uses the candidate name in document.title so print names the PDF", () => {
  assert.match(branderHtml, /const filename = `\$\{getPdfTitle\(\)\}\.pdf`/);
  assert.match(branderHtml, /document\.title = title;/);
  assert.match(branderHtml, /function getPdfTitle\(\)[\s\S]*?Top Tier Talent Group/);
});

test("source resume stays available in the editor and is excluded from print", () => {
  assert.match(branderHtml, /id="sourcePanel"/);
  assert.match(branderHtml, /id="sourceText"/);
  assert.match(branderHtml, /@media print \{[\s\S]*?\.source-panel/);
  assert.match(branderHtml, /sourceTextEl\.textContent = sourceText/);
});

test("print is labeled honestly and blocked until structured content exists", () => {
  assert.match(branderHtml, />\s*Print \/ Save PDF\s*</);
  assert.doesNotMatch(branderHtml, /Download PDF/);
  assert.match(branderHtml, /id="incompleteNotice"/);
  assert.match(branderHtml, /!paperHasStructuredContent\(\)/);
  assert.match(branderHtml, /Boolean\(candNameEl\.textContent\.trim\(\)\)/);
  assert.match(branderHtml, /Add the candidate name and source-backed resume content before printing/);
  assert.match(branderHtml, /@media print \{[\s\S]*?\.incomplete-notice/);
});

test("display fallbacks never become candidate resume facts", () => {
  const payload = buildBrandResumePayload({
    name: "Unnamed candidate",
    title: "Title not recorded",
    fullResumeText: "Original source text",
  });
  assert.equal(payload.name, "");
  assert.equal(payload.headline, "");
  assert.equal(payload.sourceText, "Original source text");
});

test("mapped profile with resume text keeps the source out of printable experience", () => {
  const source = getResumeSource({
    name: "Candidate Name",
    title: "Maintenance Manager",
    profileSummary: "Summary from the source profile.",
    fullResumeText: "Candidate Name\nMaintained conveyors at Example Manufacturing.",
    workHistory: [],
  });

  assert.equal(source.payload.sourceText, "Candidate Name\nMaintained conveyors at Example Manufacturing.");
  assert.deepEqual(source.payload.experience, []);
  assert.deepEqual(source.payload.sections, []);
});

test("resume source preserves the source resume verbatim", () => {
  const text = "Candidate Name\nRaised output by 18%\n  Kept source spacing.";
  const source = getResumeSource({ name: "Candidate Name", fullResumeText: text });

  assert.equal(source.kind, "resume");
  assert.equal(source.text, text);
  assert.deepEqual(source.usedSources, ["fullResumeText"]);
});

test("unstructured resume text stays out of printable sections", () => {
  const source = getResumeSource({ name: "Candidate Name", fullResumeText: "Raw line one\nRaw line two" });
  assert.equal(source.payload.sourceText, "Raw line one\nRaw line two");
  assert.deepEqual(source.payload.sections, []);
});

test("resume source builds a profile only from available source fields", () => {
  const source = getResumeSource({
    name: "Candidate Name",
    title: "Maintenance Manager",
    skills: ["Preventive maintenance", "Team leadership"],
    callNotes: "Prefers a day shift.",
  });

  assert.equal(source.kind, "profile");
  assert.match(source.text, /Candidate Name/);
  assert.match(source.text, /Maintenance Manager/);
  assert.match(source.text, /Preventive maintenance, Team leadership/);
  assert.match(source.text, /Prefers a day shift\./);
  assert.deepEqual(source.usedSources, ["name", "title", "skills", "callNotes"]);
  assert.doesNotMatch(source.text, /not provided|not in source/i);
  assert.deepEqual(source.payload.sections, [
    { heading: "Call Notes", items: ["Prefers a day shift."] },
  ]);
});

test("resume source reports none when profile evidence is insufficient", () => {
  assert.deepEqual(getResumeSource({ name: "Candidate Name" }), {
    kind: "none",
    text: "",
    payload: null,
    usedSources: [],
  });
  assert.throws(
    () => buildBrandResumePayload({ name: "Candidate Name" }),
    /Not enough data to build a resume/,
  );
});

test("profile payload preserves supplied experience and transcript without invention", () => {
  const source = getResumeSource({
    name: "Candidate Name",
    workHistory: [{
      title: "Millwright",
      company: "Example Manufacturing",
      startDate: "2021",
      endDate: "2024",
      bullets: ["Maintained conveyors and presses."],
    }],
    transcriptText: "Worked rotating shifts.",
  });

  assert.deepEqual(source.payload.experience, [{
    title: "Millwright",
    dates: "2021 to 2024",
    company: "Example Manufacturing",
    location: "",
    bullets: ["Maintained conveyors and presses."],
  }]);
  assert.deepEqual(source.payload.sections, [
    { heading: "Transcript", items: ["Worked rotating shifts."] },
  ]);
  assert.doesNotMatch(JSON.stringify(source.payload), /unknown|not provided|source profile/i);
});

test("branded resume returns a friendly error only when no source exists", () => {
  const result = openBrandedResume({ name: "Candidate Name" });
  assert.deepEqual(result, { ok: false, error: "Not enough data to build a resume" });
});

test("profile provenance appears only in the internal resume section", () => {
  assert.match(resumeSectionSource, /Built from profile, no resume on file/);
  assert.match(resumeSectionSource, /Sources used:/);
  assert.doesNotMatch(branderHtml, /Built from profile, no resume on file|Sources used:/);
  assert.doesNotMatch(exporterSource, /Built from profile, no resume on file|Sources used:/);
});

test("branded resume paper uses the real TTTG logo asset", () => {
  assert.match(branderHtml, /src="\/assets\/tttg_logo\.png"/);
  assert.match(branderHtml, /alt="Top Tier Talent Group"/);
  assert.ok(fs.existsSync(path.join(consoleRoot, "public/assets/tttg_logo.png")));
});
