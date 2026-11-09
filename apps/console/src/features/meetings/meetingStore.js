import { supabase } from "../../supabase-client.js";

const sessionMeetings = [];

function sourceIdentity(candidateId) {
  const [source, rawId] = String(candidateId || "").split(":");
  const sourceId = Number(rawId);
  return ["sourcing", "submission"].includes(source) && Number.isInteger(sourceId) ? { source, sourceId } : null;
}

function displayMeeting(row) {
  return {
    id: row.id,
    title: row.event_title || "Meeting draft",
    jobId: String(row.job_id),
    candidateId: `${row.candidate_source}:${row.candidate_source_id}`,
    templateId: row.template_id || null,
    transcript: row.transcript,
    transcriptExpiredAt: row.transcript_expired_at || null,
    notes: row.notes || "",
    recordingId: row.recording_id || null,
    captureStatus: row.capture_status || "transcribed",
    captureWarning: row.capture_warning || null,
    transcriptionStatus: row.transcription_status || "ready",
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

export async function saveMeetingDraft({ draft, job, candidate, templateId }) {
  const identity = sourceIdentity(candidate?.id);
  if (!identity || !job?.id) throw new Error("Choose a real candidate and job before saving.");
  const local = {
    id: draft.idempotencyKey,
    title: draft.event?.title || `${candidate.name || "Candidate"} meeting`,
    jobId: String(job.id),
    candidateId: candidate.id,
    templateId: templateId || null,
    transcript: draft.transcript,
    notes: draft.notes,
    recordingId: draft.recordingId || null,
    captureStatus: draft.captureStatus || "transcribed",
    captureWarning: draft.captureWarning || null,
    transcriptionStatus: draft.transcriptionStatus || "ready",
    transcriptionWarning: draft.transcriptionWarning || null,
    transcriptionSource: draft.transcriptionSource || null,
    transcriptionModel: draft.transcriptionModel || null,
    segments: draft.segments || [],
    speakers: draft.speakers || [],
    speakerLabels: draft.speakerLabels || {},
    createdAt: draft.createdAt,
    persistence: "session_only",
  };
  const payload = {
    job_id: Number(job.id),
    candidate_source: identity.source,
    candidate_source_id: identity.sourceId,
    event_title: draft.event?.title || null,
    template_id: templateId || null,
    transcript: draft.transcript,
    notes: draft.notes,
    recording_id: draft.recordingId || null,
    capture_status: draft.captureStatus || "transcribed",
    capture_warning: draft.captureWarning || null,
    transcription_status: draft.transcriptionStatus || "ready",
    transcription_warning: draft.transcriptionWarning || null,
    transcription_source: draft.transcriptionSource || null,
    transcription_model: draft.transcriptionModel || null,
    speaker_segments: draft.segments || [],
    speakers: draft.speakers || [],
    speaker_labels: draft.speakerLabels || {},
  };
  const query = draft.existingId
    ? supabase.from("meeting_drafts").update(payload).eq("id", draft.existingId)
    : supabase.from("meeting_drafts").insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) {
    if (draft.existingId) throw new Error("Saved meeting changes could not be persisted.");
    if (["42P01", "PGRST205"].includes(error.code)) {
      sessionMeetings.unshift(local);
      return { ok: true, draft: local, persistence: "session_only", warning: "Meeting saved for this session only." };
    }
    throw new Error("Meeting draft could not be persisted.");
  }
  const saved = displayMeeting(data);
  sessionMeetings.unshift(saved);
  return { ok: true, draft: saved, persistence: "durable" };
}

export async function listRecentMeetings({ limit = 5 } = {}) {
  const { data, error } = await supabase.from("meeting_drafts").select("*").order("created_at", { ascending: false }).limit(limit);
  if (!error) return (data || []).map(displayMeeting);
  return sessionMeetings.slice(0, limit).map((item) => ({ ...item }));
}

export function _resetMeetingStoreForTesting() {
  sessionMeetings.length = 0;
}

