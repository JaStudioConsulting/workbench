import { CandidateIdSchema } from "@ja/shared-types";
import { supabase } from "../../supabase-client.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function candidateIdentity(value) {
  if (value == null || value === "") return null;
  const parsed = CandidateIdSchema.safeParse(value);
  if (!parsed.success) throw new Error("Choose a valid candidate record before saving.");
  const [source, rawId] = parsed.data.split(":");
  return {
    id: parsed.data,
    source: ["sourcing", "submission"].includes(source) ? source : null,
    sourceId: ["sourcing", "submission"].includes(source) ? Number(rawId) : null,
  };
}

function jobIdentity(value) {
  if (value == null || value === "") return null;
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error("Choose a valid job record before saving.");
  }
  return Number(value);
}

function displayMeeting(row) {
  const legacyCandidate = row.candidate_source && row.candidate_source_id != null
    ? `${row.candidate_source}:${row.candidate_source_id}` : null;
  const candidate = CandidateIdSchema.safeParse(row.candidate_id || legacyCandidate);
  const transcript = row.transcript || "";
  return {
    id: row.id,
    title: row.event_title || "Meeting draft",
    eventTitle: row.event_title || null,
    jobId: row.job_id == null ? null : String(row.job_id),
    candidateId: candidate.success ? candidate.data : null,
    templateId: row.template_id || null,
    transcript,
    transcriptStatus: transcript.trim() ? "ready" : "awaiting_input",
    transcriptExpiredAt: row.transcript_expired_at || null,
    notes: row.notes || "",
    recordingId: row.recording_id || null,
    captureStatus: row.capture_status || (transcript.trim() ? "transcribed" : "captured"),
    captureWarning: row.capture_warning || null,
    transcriptionStatus: row.transcription_status || (transcript.trim() ? "ready" : "disabled"),
    transcriptionWarning: row.transcription_warning || null,
    transcriptionSource: row.transcription_source || null,
    transcriptionModel: row.transcription_model || null,
    segments: Array.isArray(row.speaker_segments) ? row.speaker_segments : [],
    speakers: Array.isArray(row.speakers) ? row.speakers : [],
    speakerLabels: row.speaker_labels && typeof row.speaker_labels === "object" ? row.speaker_labels : {},
    createdAt: row.created_at,
    persistence: "durable",
  };
}

// Hydrate saved meetings through the signed-in user's RLS-scoped client.
// Source links remain intact even when a job is no longer in the active feed.
export async function loadMeetingDraft(id, { client = supabase } = {}) {
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new Error("Choose a valid saved meeting.");
  const { data: row, error } = await client.from("meeting_drafts").select("*").eq("id", id).single();
  if (error || !row) throw new Error("The saved meeting could not be loaded. Retry before editing it.");
  const meeting = displayMeeting(row);
  const [jobResult, candidateResult] = await Promise.all([
    meeting.jobId ? client.from("tracker_jobs").select("job_id,job_title,company,status").eq("job_id", meeting.jobId).maybeSingle() : null,
    meeting.candidateId ? client.from("candidates_all").select("id,candidate_name,current_title").eq("id", meeting.candidateId).maybeSingle() : null,
  ]);
  if (jobResult?.error || candidateResult?.error) throw new Error("The saved meeting context could not be loaded. Retry before editing it.");
  return {
    ...meeting,
    ownerId: row.owner_id,
    job: meeting.jobId ? { id: meeting.jobId, title: jobResult?.data?.job_title || "Saved job unavailable", company: jobResult?.data?.company || "Company not recorded", status: jobResult?.data?.status || "" } : null,
    candidate: meeting.candidateId ? { id: meeting.candidateId, name: candidateResult?.data?.candidate_name || "Saved candidate unavailable", title: candidateResult?.data?.current_title || "" } : null,
  };
}

export async function saveMeetingDraft({ draft, job, candidate, templateId }, { client = supabase } = {}) {
  if (!draft || typeof draft !== "object") throw new Error("A meeting draft is required.");
  const identity = candidateIdentity(candidate?.id ?? draft.candidate?.id);
  const jobId = jobIdentity(job?.id ?? draft.job?.id);
  const id = draft.existingId || draft.idempotencyKey;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new Error("The meeting draft needs a valid save identifier. Reload the draft before saving.");
  const transcript = String(draft.transcript || "");
  const notes = String(draft.notes || "");
  if (!transcript.trim() && !notes.trim() && !draft.recordingId) {
    throw new Error("Add a recording, transcript, or meeting notes before saving.");
  }
  const payload = {
    id,
    job_id: jobId,
    candidate_id: identity?.id || null,
    candidate_source: identity?.source || null,
    candidate_source_id: identity?.sourceId || null,
    event_title: draft.event?.title || null,
    template_id: templateId || null,
    transcript,
    notes,
    recording_id: draft.recordingId || null,
    capture_status: draft.captureStatus || (transcript.trim() ? "transcribed" : "captured"),
    capture_warning: draft.captureWarning || null,
    transcription_status: draft.transcriptionStatus || (transcript.trim() ? "ready" : "disabled"),
    transcription_warning: draft.transcriptionWarning || null,
    transcription_source: draft.transcriptionSource || null,
    transcription_model: draft.transcriptionModel || null,
    speaker_segments: draft.segments || [],
    speakers: draft.speakers || [],
    speaker_labels: draft.speakerLabels || {},
  };
  // A retry uses the same UUID, including when the first response was lost.
  // Ownership remains enforced by the meeting_drafts row-level policies.
  const { data, error } = await client.from("meeting_drafts").upsert(payload, { onConflict: "id" }).select("*").single();
  if (error || !data) {
    throw new Error(draft.existingId ? "Saved meeting changes could not be persisted." : "Meeting draft could not be persisted.");
  }
  return { ok: true, draft: displayMeeting(data), persistence: "durable" };
}

export async function listRecentMeetings({ limit = 5, client = supabase } = {}) {
  const { data, error } = await client.from("meeting_drafts").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error("Saved meetings could not be loaded.");
  return (data || []).map(displayMeeting);
}

export function _resetMeetingStoreForTesting() {
  // Persistence lives in the database; no session-only success cache remains.
}
