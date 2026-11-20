import { errorEnvelope } from "@ja/shared-types";
import { FORMATS, NO_TEXT_MESSAGE, ResumeFormatError, formatResume } from "./resume-format/index.js";

const STATUS_BY_CODE = {
  NO_RESUME_TEXT: 422,
  RESUME_TOO_LONG: 422,
  UNSUPPORTED_CHARACTER: 422,
  FORMAT_CHECK_FAILED: 422,
  INVALID_FORMAT: 400,
};

function respond(res, code, message, status) {
  res.set("Cache-Control", "private, no-store");
  return res.status(status).json(errorEnvelope(code, message));
}

// POST /api/resume-format { text, format: "pdf" | "docx", candidateName? }
// Turns saved resume text into a branded file. No AI and no network. The text is never logged.
export function registerResumeFormatRoutes(app, { access, formatter = formatResume } = {}) {
  app.post("/api/resume-format", access, async (req, res) => {
    const { text, format, candidateName } = req.body ?? {};
    if (!Object.hasOwn(FORMATS, format)) return respond(res, "INVALID_FORMAT", "Choose PDF or Word.", 400);
    if (typeof text !== "string" || !text.trim()) return respond(res, "NO_RESUME_TEXT", NO_TEXT_MESSAGE, 422);
    try {
      const file = await formatter({ text, format, candidateName: typeof candidateName === "string" ? candidateName : "" });
      res.set({
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.attachment(file.fileName);
      res.set({ "Content-Type": file.mimeType, "Content-Length": String(file.bytes.length) });
      return res.status(200).end(file.bytes);
    } catch (error) {
      if (error instanceof ResumeFormatError) {
        return respond(res, error.code, error.message, STATUS_BY_CODE[error.code] || 422);
      }
      console.error("Resume formatting failed.", { code: error?.code, name: error?.name });
      return respond(res, "RESUME_FORMAT_FAILED", "The file could not be created. Try again, or use the other format.", 500);
    }
  });
}
