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
    notes: row.notes || "",
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
    createdAt: draft.createdAt,
    persistence: "session_only",
  };
  const { data, error } = await supabase.from("meeting_drafts").insert({
    job_id: Number(job.id),
    candidate_source: identity.source,
    candidate_source_id: identity.sourceId,
    event_title: draft.event?.title || null,
    template_id: templateId || null,
    transcript: draft.transcript,
    notes: draft.notes,
  }).select("*").single();
  if (error) {
    sessionMeetings.unshift(local);
    return { ok: true, draft: local, persistence: "session_only", warning: "Meeting saved for this session only." };
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

