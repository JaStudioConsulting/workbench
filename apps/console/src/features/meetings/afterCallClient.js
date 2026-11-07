import { gatewayBaseURL } from "../../auth-client.js";
import { createCandidateDraft } from "../candidate-review/candidateReviewService.js";

function candidateSourceText(candidate) {
  if (candidate?.fullResumeText?.trim()) return candidate.fullResumeText.trim();
  return [candidate?.title, candidate?.profileSummary, ...(candidate?.workHistory || []).map((role) => [role.title, role.company, ...(role.bullets || [])].filter(Boolean).join(". "))]
    .filter(Boolean).join("\n").trim();
}

function jobSourceText(job) {
  return [job?.title, job?.company, job?.location, job?.compensation, job?.description, job?.jobDescription].filter(Boolean).join("\n").trim();
}

export async function makeCandidateNotes({ job, candidate, transcript, notes = "" }, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
  createDraft = createCandidateDraft,
} = {}) {
  const cleanTranscript = String(transcript || "").trim();
  const resumeText = candidateSourceText(candidate);
  const jobDescription = jobSourceText(job);
  if (!cleanTranscript) throw new Error("Transcript is required to make candidate notes.");
  if (!resumeText) throw new Error("Candidate source details are not available.");
  if (!jobDescription) throw new Error("Job source details are not available.");
  const response = await fetchImpl(new URL("/api/workflows/after-call/prepare", baseURL), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      name: candidate.name || "Candidate name not on file",
      title: candidate.title || "Title not on file",
      resumeText,
      transcriptText: cleanTranscript,
      jobDescription,
      callNotes: String(notes || "").trim() || undefined,
      verifiedFacts: [{ label: "Meeting transcript", value: cleanTranscript, source: "transcript", evidence: cleanTranscript }],
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message || "Candidate notes could not be prepared.");
  const body = ["Candidate notes", ...(result?.loxoDraft?.bullets || [])].join("\n").trim();
  if (!body || body === "Candidate notes") throw new Error("The workflow returned no source-backed notes.");
  const draft = await createDraft({ job, candidate, kind: "write_up", body });
  return { workflow: result, draft };
}
