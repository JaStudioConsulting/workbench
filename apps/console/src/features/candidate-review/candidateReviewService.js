// Data layer abstraction for Candidate Review
// Allows sample fixture data to be swapped with Supabase later without modifying UI views

import { SAMPLE_JOBS, SAMPLE_CANDIDATES } from "./sampleReviewData.js";
import { PIPELINE_STAGE_ORDER } from "./constants.js";

// In-memory local stores (in-memory only, no persistent browser storage)
// Keyed strictly by composite key: jobId + "::" + loxoPersonId
const candidateDecisions = new Map(); // compositeKey -> "want" | "pass" | null
const loggedActivities = new Map(); // compositeKey -> Array<Activity>
const activityOutbox = new Map(); // idempotencyKey -> ActivityRecord
const candidateSubmissions = new Map(); // compositeKey -> session-only submission record

export function makeCompositeKey(jobId, personId) {
  if (!jobId || !personId) return "";
  return `${String(jobId).trim()}::${String(personId).trim()}`;
}

export function isSampleData() {
  return true;
}

export function getReviewJobs() {
  return SAMPLE_JOBS;
}

export function getJobById(jobId) {
  if (!jobId) return null;
  // Match ONLY by immutable job ID. Zero title matching. Zero jobs[0] fallback.
  return SAMPLE_JOBS.find((j) => String(j.id) === String(jobId)) || null;
}

export function getCandidatesForJob(jobId) {
  if (!jobId) return [];

  const job = getJobById(jobId);
  if (!job) return []; // Unmatched job yields empty array

  const matches = SAMPLE_CANDIDATES.filter(
    (cand) => String(cand.jobId) === String(jobId)
  );

  const enriched = matches.map((cand) => {
    const key = makeCompositeKey(jobId, cand.id);
    const decision = candidateDecisions.get(key) || null;
    const sessionSubmission = candidateSubmissions.get(key) || null;
    const importedSubmission = cand.submissionHistory?.[0] || null;
    const stageIsSubmitted = (PIPELINE_STAGE_ORDER[cand.stage] ?? -1) >= PIPELINE_STAGE_ORDER.Submitted;
    const additional = loggedActivities.get(key) || [];
    const fullTrail = [...additional, ...cand.activityTrail];

    // Compute other contacts count (activities performed by someone other than Ja)
    const otherContactsCount = fullTrail.filter(
      (ev) => !ev.isJa && ev.actor && !ev.actorUnknown
    ).length;

    return {
      ...cand,
      decision,
      submission: sessionSubmission || importedSubmission,
      isSubmitted: Boolean(sessionSubmission || importedSubmission || stageIsSubmitted),
      activityTrail: fullTrail,
      otherContactsCount,
    };
  });

  // Sort candidates strictly by pipeline stage order
  return enriched.sort((a, b) => {
    const orderA = PIPELINE_STAGE_ORDER[a.stage] ?? 999;
    const orderB = PIPELINE_STAGE_ORDER[b.stage] ?? 999;
    return orderA - orderB;
  });
}

export function getSubmissionHistory() {
  const records = [];

  for (const candidate of SAMPLE_CANDIDATES) {
    const job = getJobById(candidate.jobId);
    for (const submission of candidate.submissionHistory || []) {
      records.push({
        id: submission.id || `${candidate.jobId}::${candidate.id}::${submission.submittedAt}`,
        jobId: candidate.jobId,
        personId: candidate.id,
        jobTitle: job?.title || "Unknown job",
        client: submission.client || job?.company || "",
        location: submission.location || job?.location || candidate.location || "",
        submittedAt: submission.submittedAt,
        source: "imported",
        candidate: { ...candidate, decision: null, submission, isSubmitted: true },
      });
    }
  }

  for (const [key, submission] of candidateSubmissions.entries()) {
    const [jobId, personId] = key.split("::");
    const job = getJobById(jobId);
    const candidate = SAMPLE_CANDIDATES.find(
      (item) => String(item.jobId) === jobId && String(item.id) === personId
    );
    if (!candidate) continue;
    records.push({
      id: submission.id,
      jobId,
      personId,
      jobTitle: job?.title || "Unknown job",
      client: submission.client || job?.company || "",
      location: submission.location || job?.location || candidate.location || "",
      submittedAt: submission.submittedAt,
      source: "session",
      candidate: { ...candidate, decision: candidateDecisions.get(key) || null, submission, isSubmitted: true },
    });
  }

  return records.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
}

export function getCandidateSessionState(jobId, personId) {
  const key = makeCompositeKey(jobId, personId);
  return {
    decision: candidateDecisions.get(key) || null,
    activities: [...(loggedActivities.get(key) || [])],
  };
}

export async function recordCandidateDecision(jobId, personId, decision, options = {}) {
  // Asynchronous write hook with composite key isolation
  if (options.simulateFailure) {
    throw new Error(options.errorMessage || "Failed to record candidate decision");
  }

  const key = makeCompositeKey(jobId, personId);
  if (!key) {
    throw new Error("Cannot record decision without valid jobId and personId");
  }

  if (decision === "want" || decision === "pass" || decision === null) {
    candidateDecisions.set(key, decision);
  }

  return { ok: true, jobId, personId, decision };
}

export async function recordCandidateSubmission(jobId, personId, details = {}, options = {}) {
  if (options.simulateFailure) {
    throw new Error(options.errorMessage || "Failed to record candidate submission");
  }

  const key = makeCompositeKey(jobId, personId);
  if (!key) {
    throw new Error("Cannot record submission without valid jobId and personId");
  }

  const candidate = SAMPLE_CANDIDATES.find(
    (item) => String(item.jobId) === String(jobId) && String(item.id) === String(personId)
  );
  const job = getJobById(jobId);
  if (!candidate || !job) {
    throw new Error("Cannot record submission for an unknown candidate or job");
  }

  const submission = {
    id: `session-submission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    submittedAt: details.submittedAt || new Date().toISOString(),
    client: details.client || job.company || "",
    location: details.location || job.location || candidate.location || "",
    note: (details.note || "").trim(),
    status: "Session only",
  };
  candidateSubmissions.set(key, submission);
  return { ok: true, jobId, personId, submission, persisted: false };
}

export async function logCandidateActivity(
  jobId,
  personId,
  { type, note, targetStage, idempotencyKey },
  options = {}
) {
  // Asynchronous outbox boundary with idempotency key
  if (options.simulateFailure) {
    throw new Error(options.errorMessage || "Failed to record activity in outbox");
  }

  const key = makeCompositeKey(jobId, personId);
  if (!key) {
    throw new Error("Cannot log activity without valid jobId and personId");
  }

  if (!idempotencyKey) {
    throw new Error("An idempotency key is required for activity retries");
  }
  const resolvedIdempotencyKey = idempotencyKey;

  // Idempotency boundary: return existing record if already queued
  if (activityOutbox.has(resolvedIdempotencyKey)) {
    return {
      ok: true,
      activity: activityOutbox.get(resolvedIdempotencyKey),
      duplicate: true,
    };
  }

  const newActivity = {
    id: `local-act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    idempotencyKey: resolvedIdempotencyKey,
    type,
    actor: "Ja Maralit",
    isJa: true,
    actorUnknown: false,
    date: new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    note: (note || "").trim(),
    // Honest status boundary: do NOT claim real Loxo sync
    status: "Waiting for Loxo",
    targetStage: targetStage || "No automatic stage change",
  };

  activityOutbox.set(resolvedIdempotencyKey, newActivity);

  const list = loggedActivities.get(key) || [];
  list.unshift(newActivity);
  loggedActivities.set(key, list);

  return { ok: true, activity: newActivity };
}

export function _resetStoreForTesting() {
  candidateDecisions.clear();
  loggedActivities.clear();
  activityOutbox.clear();
  candidateSubmissions.clear();
}
