import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NO_RESUME_TEXT_MESSAGE, requestBrandedResume, saveBlobAsFile } from "../src/features/candidate-review/brandedResumeClient.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.resolve(here, "../src/features", file), "utf8");

const ok = (headers = {}) => ({ ok: true, status: 200, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, async blob() { return new Blob(["x"]); } });
const failure = (code, message, status = 422) => ({ ok: false, status, async json() { return { error: { code, message } }; } });
const base = { baseURL: "https://gateway.example", getAccessToken: async () => "tok" };

test("sends the saved text exactly as stored with the caller's token", async () => {
  let request;
  const text = "  Alex Rivera\n\n**kept as typed**  \n";
  const file = await requestBrandedResume({ text, candidateName: "Alex Rivera", format: "pdf" }, {
    ...base,
    fetchImpl: async (url, options) => { request = { url: String(url), options }; return ok({ "content-disposition": "attachment; filename=\"Alex Rivera - Top Tier Talent Group.pdf\"; filename*=UTF-8''Alex%20Rivera%20-%20Top%20Tier%20Talent%20Group.pdf" }); },
  });
  assert.equal(request.url, "https://gateway.example/api/resume-format");
  assert.equal(request.options.headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(request.options.body), { text, format: "pdf", candidateName: "Alex Rivera" });
  assert.equal(file.fileName, "Alex Rivera - Top Tier Talent Group.pdf");
});

test("empty text makes no request and gives the one-sentence message", async () => {
  let called = false;
  for (const text of ["", "  \n", undefined]) {
    await assert.rejects(requestBrandedResume({ text, format: "docx" }, { ...base, fetchImpl: async () => { called = true; } }), { message: NO_RESUME_TEXT_MESSAGE });
  }
  assert.equal(called, false);
  assert.equal(NO_RESUME_TEXT_MESSAGE, "There is no resume text to format. Add or paste the resume text first, then try again.");
});

test("failures are explained in plain words with a next step", async () => {
  await assert.rejects(requestBrandedResume({ text: "Name", format: "pdf" }, { ...base, fetchImpl: async () => { throw new Error("offline"); } }), /PDF file was not made\. Check the connection and try again\./);
  await assert.rejects(requestBrandedResume({ text: "Name", format: "docx" }, { ...base, fetchImpl: async () => failure("RESUME_FORMAT_FAILED", "x", 500) }), /Word file could not be made\. Try again, or use the other format\./);
  await assert.rejects(requestBrandedResume({ text: "Name", format: "pdf" }, { ...base, fetchImpl: async () => failure("UNSUPPORTED_CHARACTER", "The PDF cannot draw this character from the resume text: “🚀” (U+1F680). Change it in the resume text, or download the Word file instead.") }), /download the Word file instead/);
  await assert.rejects(requestBrandedResume({ text: "Name", format: "pdf" }, { ...base, fetchImpl: async () => failure("UNAUTHORIZED", "x", 401) }), /session ended/);
  await assert.rejects(requestBrandedResume({ text: "Name", format: "pdf" }, { baseURL: base.baseURL, getAccessToken: async () => "", fetchImpl: async () => ok() }), /Reload the page/);
});

test("saving a file clicks a download link with the file name", () => {
  const events = [];
  const link = { click: () => events.push("click"), remove: () => events.push("remove") };
  saveBlobAsFile({ blob: new Blob(["x"]), fileName: "A - Top Tier Talent Group.docx" }, { createElement: () => link, body: { appendChild: () => events.push("append") } }, { createObjectURL: () => "blob:1", revokeObjectURL: () => {} });
  assert.equal(link.download, "A - Top Tier Talent Group.docx");
  assert.deepEqual(events, ["append", "click", "remove"]);
});

test("the Branded resume control is on the candidate card, People list and approval desk", () => {
  for (const file of ["candidate-review/CandidateCard.jsx", "candidate-review/PeopleView.jsx", "operator-cases/OperatorCaseWorkspace.jsx"]) {
    assert.match(read(file), /<BrandedResumeControl /u, file);
  }
  assert.doesNotMatch(read("operator-cases/OperatorCaseWorkspace.jsx"), /Document output is not set up yet/u);
  // The card and People list send only the saved resume text, never the profile fallback.
  assert.match(read("candidate-review/CandidateCard.jsx"), /text=\{candidate\.fullResumeText\}/u);
  assert.match(read("candidate-review/PeopleView.jsx"), /text=\{candidate\.fullResumeText\}/u);
});

test("the control is named, keyboard reachable, uses plain words and no developer terms", () => {
  const source = read("candidate-review/BrandedResumeControl.jsx");
  assert.match(source, /role="group" aria-label="Branded resume"/u);
  assert.match(source, /type="button"/u);
  assert.match(source, /Download branded resume as/u);
  assert.match(source, /role="alert"/u);
  assert.match(source, /Making PDF…/u);
  assert.doesNotMatch(source, /markdown/iu);
});
