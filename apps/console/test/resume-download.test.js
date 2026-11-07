import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getResumeSource } from "../src/features/candidate-review/brandResume.js";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const branderHtml = fs.readFileSync(path.join(consoleRoot, "resume-brander.html"), "utf8");
const exporterSource = fs.readFileSync(path.join(consoleRoot, "src/resume-brander-export.js"), "utf8");
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
});

test("resume source reports none when profile evidence is insufficient", () => {
  assert.deepEqual(getResumeSource({ name: "Candidate Name" }), {
    kind: "none",
    text: "",
    payload: null,
    usedSources: [],
  });
});
