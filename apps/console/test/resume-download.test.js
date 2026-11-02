import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
