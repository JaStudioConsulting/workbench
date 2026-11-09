import { parseCandidateSourceKey, SupabaseUserIdSchema } from "@ja/shared-types";
import { supabase } from "../../supabase-client.js";

export function meetingIdFromOriginKey(originKey) {
  if (typeof originKey !== "string" || !originKey.startsWith("meeting_draft:")) return null;
  const parsed = SupabaseUserIdSchema.safeParse(originKey.slice("meeting_draft:".length));
  return parsed.success ? parsed.data.toLowerCase() : null;
}

// The meeting is read afresh under the recruiter's Supabase session and RLS.
// No transcript text is written to Notes or kept in a durable browser cache.
export async function loadMeetingTranscriptPreview({ originKey, candidateId, client = supabase }) {
  const meetingId = meetingIdFromOriginKey(originKey);
  const candidate = parseCandidateSourceKey(candidateId);
  if (!meetingId || !candidate) return { status: "unavailable", transcript: null };

  const { data: authData, error: authError } = await client.auth.getSession();
  const ownerId = authData?.session?.user?.id?.toLowerCase();
  if (authError || !ownerId) return { status: "unavailable", transcript: null };

  const { data: row, error } = await client
    .from("meeting_drafts")
    .select("id,owner_id,candidate_source,candidate_source_id,transcript")
    .eq("id", meetingId)
    .maybeSingle();
  if (error || !row || String(row.id).toLowerCase() !== meetingId || String(row.owner_id).toLowerCase() !== ownerId) {
    return { status: "unavailable", transcript: null };
  }
  const linkedKey = parseCandidateSourceKey(`${row.candidate_source}:${row.candidate_source_id}`)?.id;
  if (linkedKey !== candidate.id || typeof row.transcript !== "string" || !row.transcript.trim()) {
    return { status: "unavailable", transcript: null };
  }
  return { status: "available", transcript: row.transcript };
}
