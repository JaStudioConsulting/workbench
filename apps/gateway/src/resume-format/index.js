import { BRAND } from "./brand.js";
import { renderResumeDocx } from "./docx.js";
import { buildResumeModel, ResumeFormatError } from "./model.js";
import { renderResumePdf } from "./pdf.js";

export { ResumeFormatError, buildResumeModel, modelWords, NO_TEXT_MESSAGE, MAX_RESUME_CHARS } from "./model.js";
export { layoutResume, renderResumePdf, expectedPdfWords, isCapsBlock, assertDrawable } from "./pdf.js";
export { renderResumeDocx } from "./docx.js";
export { BRAND, FIXED_ELEMENTS, upperForDisplay } from "./brand.js";

export const FORMATS = Object.freeze({
  pdf: Object.freeze({ extension: "pdf", mimeType: "application/pdf" }),
  docx: Object.freeze({ extension: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
});

// "Candidate Name - Top Tier Talent Group.pdf", with only letters, digits, space . _ - kept.
export function resumeFileName(candidateName, format) {
  const safe = String(candidateName ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[\s.-]+/u, "")
    .slice(0, 80)
    .trim() || "Candidate";
  return `${safe} - ${BRAND.firmName}.${FORMATS[format].extension}`;
}

// The one entry point: saved resume text in, a branded file out. Formatting only.
export async function formatResume({ text, format, candidateName = "" }) {
  if (!Object.hasOwn(FORMATS, format)) throw new ResumeFormatError("INVALID_FORMAT", "Choose PDF or Word.");
  const model = buildResumeModel(text);
  const title = String(candidateName ?? "").replace(/\s+/gu, " ").trim().slice(0, 120);
  const bytes = format === "pdf" ? await renderResumePdf(model, { title }) : await renderResumeDocx(model, { title });
  return {
    bytes: Buffer.from(bytes),
    mimeType: FORMATS[format].mimeType,
    fileName: resumeFileName(candidateName, format),
  };
}
