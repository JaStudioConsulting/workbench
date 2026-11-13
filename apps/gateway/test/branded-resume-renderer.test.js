import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { renderBrandedResume } from "../src/branded-resume-renderer.js";

const field = (value) => ({ value, evidence: [] });
const claim = (text) => ({ text, evidence: [] });

test("branded renderer produces a valid synthetic multi-page review PDF", async () => {
  const resume = {
    name: field("Synthetic Candidate"),
    title: field("Operations Manager"),
    summary: [claim("Experienced operations leader with a focus on safe, reliable delivery.")],
    skills: [claim("Operations planning"), claim("Team leadership")],
    experience: Array.from({ length: 18 }, (_, index) => ({
      title: field(`Operations Manager ${index + 1}`),
      dates: field("Jan-2020 - Present"),
      company: field(`Synthetic Employer ${index + 1}`),
      location: field("Toronto, Ontario"),
      bullets: Array.from({ length: 6 }, () => claim("Coordinated daily work across production, maintenance, and quality teams to maintain safe and reliable operations.")),
    })),
    education: [claim("Operations Management Diploma")],
    certifications: [],
    additionalInformation: [],
  };
  const result = await renderBrandedResume(resume);
  const bytes = Buffer.from(result.base64, "base64");
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(result.sizeBytes, bytes.length);
  assert.ok(bytes.length < 8 * 1024 * 1024);
  assert.equal(result.reviewLabel, "Draft for recruiter review");

  const directory = await mkdtemp(path.join(tmpdir(), "workbench-resume-qa-"));
  const pdfPath = path.join(directory, "resume.pdf");
  try {
    await writeFile(pdfPath, bytes, { mode: 0o600 });
    const pages = Number(execFileSync("python3", ["-c", "from pypdf import PdfReader; import sys; print(len(PdfReader(sys.argv[1]).pages))", pdfPath], { encoding: "utf8" }).trim());
    assert.ok(pages > 1, `expected multiple pages, got ${pages}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
