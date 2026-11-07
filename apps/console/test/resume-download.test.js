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

test("resume brander is a built Vite page with direct PDF export", () => {
  assert.match(viteSource, /resumeBrander:/);
  assert.match(branderHtml, /src="\/src\/resume-brander-export\.js"/);
  assert.match(branderHtml, /await window\.downloadBrandedResumePdf/);
  assert.match(exporterSource, /pdfMake\.createPdf\(buildDocument\(data\)\)\.download/);
  assert.match(exporterSource, /pageSize: "LETTER"/);
  assert.match(exporterSource, /title: `\$\{data\.name \|\| "Candidate"\} - Top Tier Talent Group`/);
});

test("download uses a candidate-named PDF and print is fallback only", () => {
  assert.match(branderHtml, /const filename = `\$\{getPdfTitle\(\)\}\.pdf`/);
  assert.match(exporterSource, /download\(safeFilename\(filename\)\)/);
  assert.match(branderHtml, /data: extractCandidateJson\(\), filename/);
  assert.match(branderHtml, /catch \(error\)[\s\S]*window\.print\(\)/);
  assert.doesNotMatch(branderHtml, /function downloadNamedPdf\(\) \{\s*syncTitleAndRules\(\);\s*window\.print\(\)/);
});

test("resume source preserves the source resume verbatim", () => {
  const text = "Candidate Name\nRaised output by 18%\n  Kept source spacing.";
  const source = getResumeSource({ name: "Candidate Name", fullResumeText: text });

  assert.equal(source.kind, "resume");
  assert.equal(source.text, text);
  assert.deepEqual(source.usedSources, ["fullResumeText"]);
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
