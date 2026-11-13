import { gatewayBaseURL } from "../../auth-client.js";
import { supabase } from "../../supabase-client.js";
import { createCandidateDraft } from "../candidate-review/candidateReviewService.js";
import { operatorCasesEnabled, saveAfterCallCase } from "../operator-cases/operatorCaseService.js";

function candidateSourceText(candidate) {
  if (candidate?.fullResumeText?.trim()) return candidate.fullResumeText.trim();
  return [candidate?.title, candidate?.profileSummary, ...(candidate?.workHistory || []).map((role) => [role.title, role.company, ...(role.bullets || [])].filter(Boolean).join(". "))]
    .filter(Boolean).join("\n").trim();
}

function jobSourceText(job) {
  return [job?.title, job?.company, job?.location, job?.compensation, job?.description, job?.jobDescription].filter(Boolean).join("\n").trim();
}

export async function makeCandidateNotes({ job, candidate, transcript, notes = "", meetingId = "" }, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
  getAccessToken = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data?.session?.access_token || "";
  },
  createDraft = createCandidateDraft,
  saveCase = saveAfterCallCase,
  casesEnabled = operatorCasesEnabled,
} = {}) {
  const cleanTranscript = String(transcript || "").trim();
  const resumeText = candidateSourceText(candidate);
  const jobDescription = jobSourceText(job);
  if (!resumeText) throw new Error("Candidate source details are not available.");
  if (!jobDescription) throw new Error("Job source details are not available.");
  let token;
  try { token = await getAccessToken(); }
  catch { throw new Error("Sign in again before preparing after-call drafts."); }
  if (!token) throw new Error("Sign in again before preparing after-call drafts.");
  let response;
  try {
    response = await fetchImpl(new URL("/api/workflows/after-call/prepare", baseURL), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
      candidateId: candidate.id,
      name: candidate.name || "Candidate name not on file",
      title: candidate.title || "Title not on file",
      resumeText,
      ...(cleanTranscript ? { transcriptText: cleanTranscript } : {}),
      jobDescription,
      callNotes: String(notes || "").trim() || undefined,
      }),
    });
  } catch {
    throw new Error("Workbench couldn’t be reached. Check your connection and try again.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const messages = {
      AI_NOT_CONFIGURED: "After-call drafting is not available right now. Try again later.",
      AI_INVALID_OUTPUT: "The draft could not be checked against the source material. Review the sources and try again.",
      UNAUTHORIZED: "Your sign-in expired. Sign in again, then retry.",
      FORBIDDEN: "This account cannot prepare after-call drafts.",
      INVALID_INPUT: "Check the candidate and job details, then try again.",
    };
    throw new Error(messages[result?.error?.code] || result?.error?.message || "After-call drafts could not be prepared. Check your connection and try again.");
  }
  if (!result?.audit || typeof result?.brandedResume?.content !== "string" || !result?.submission?.fields || !result?.presentationEmail || !Array.isArray(result?.loxoDraft?.bullets)) {
    throw new Error("The after-call service returned an incomplete draft. Nothing was saved.");
  }
  if (casesEnabled) {
    try {
      const approvalCase = await persistAfterCallCase({ job, candidate, meetingId, transcript: cleanTranscript, notes, workflow: result }, { saveCase });
      return { workflow: result, approvalCase, blocked: approvalCase?.record?.status === "blocked" || Boolean(result.audit.finalizationBlocked || result.audit.identityReviewRequired) };
    } catch {
      return { workflow: result, caseSaveError: "The drafts were generated but could not be saved to approval history. Retry the save; the drafts are still available here." };
    }
  }
  try {
    const draft = await persistLegacyAfterCallNote({ job, candidate, workflow: result }, { createDraft });
    return { workflow: result, draft };
  } catch {
    return { workflow: result, draftSaveError: "The drafts were generated but the candidate note could not be saved. Retry the save; the drafts are still available here." };
  }
}

export async function persistAfterCallCase({ job, candidate, transcript, notes = "", meetingId = "", workflow }, { saveCase = saveAfterCallCase } = {}) {
  return saveCase({ job, candidate, meetingId, transcript: String(transcript || "").trim(), notes, workflow });
}

export async function persistLegacyAfterCallNote({ job, candidate, workflow }, { createDraft = createCandidateDraft } = {}) {
  const body = ["Candidate notes", ...(workflow?.loxoDraft?.bullets || []).map((bullet) => bullet?.text || bullet)].join("\n").trim();
  if (!body || body === "Candidate notes") throw new Error("The workflow returned no source-backed notes.");
  return createDraft({ job, candidate, kind: "write_up", body });
}
