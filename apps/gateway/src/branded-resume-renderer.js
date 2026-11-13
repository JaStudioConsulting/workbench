import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveSkillPath } from "@jastudioconsulting/recruitment-skills";

const execFile = promisify(execFileCallback);
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

function claimText(item) { return item.text; }
function fieldValue(item) { return item.value || ""; }

function toBuilderData(resume) {
  const sections = [];
  if (resume.certifications.length) sections.push({ heading: "Certifications", items: resume.certifications.map(claimText) });
  if (resume.additionalInformation.length) sections.push({ heading: "Additional Information", items: resume.additionalInformation.map(claimText) });
  return {
    name: fieldValue(resume.name),
    headline: fieldValue(resume.title),
    summary: resume.summary.map(claimText).join(" "),
    skills: resume.skills.map(claimText),
    experience: resume.experience.map((role) => ({
      title: fieldValue(role.title),
      dates: fieldValue(role.dates),
      company: fieldValue(role.company),
      location: fieldValue(role.location),
      bullets: role.bullets.map(claimText),
    })),
    education: resume.education.map(claimText),
    sections,
  };
}

export async function renderBrandedResume(resume, {
  runner = execFile,
  tempRoot = tmpdir(),
  pythonExecutable = process.env.WORKBENCH_PDF_PYTHON || "python3",
} = {}) {
  const directory = await mkdtemp(path.join(tempRoot, "workbench-resume-"));
  const inputPath = path.join(directory, "resume.json");
  const outputPath = path.join(directory, "resume.pdf");
  try {
    const scriptPath = await resolveSkillPath("recruiter/modules/brandedresume/scripts/build_resume.py");
    await writeFile(inputPath, JSON.stringify(toBuilderData(resume)), { mode: 0o600 });
    await runner(pythonExecutable, [scriptPath, "--data", inputPath, "--out", outputPath, "--engine", "reportlab"], {
      timeout: TIMEOUT_MS,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    const pdf = await readFile(outputPath);
    if (pdf.length < 100 || pdf.length > MAX_PDF_BYTES || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw Object.assign(new Error("The branded resume PDF did not pass size and format checks"), { code: "RESUME_RENDER_INVALID" });
    }
    const safeName = fieldValue(resume.name).replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, " ").slice(0, 100) || "Candidate";
    return Object.freeze({
      fileName: `${safeName} - Top Tier Talent Group - DRAFT.pdf`,
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      base64: pdf.toString("base64"),
      reviewLabel: "Draft for recruiter review",
    });
  } catch (error) {
    if (error?.code === "RESUME_RENDER_INVALID") throw error;
    throw Object.assign(new Error("The branded resume renderer is unavailable or rejected the draft"), { code: "RESUME_RENDER_FAILED" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const brandedResumeRenderLimits = Object.freeze({ maxPdfBytes: MAX_PDF_BYTES, timeoutMs: TIMEOUT_MS });
