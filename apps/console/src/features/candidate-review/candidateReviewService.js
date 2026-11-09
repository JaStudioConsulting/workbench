// Data layer for live Candidate Review records.
// Empty or unavailable sources never substitute synthetic records.
import { PIPELINE_STAGE_ORDER } from "./constants.js";
import { supabase } from "../../supabase-client.js";

// In-memory local stores (in-memory only, no persistent browser storage)
// Keyed strictly by composite key: jobId + "::" + loxoPersonId
const candidateDecisions = new Map(); // compositeKey -> "want" | "pass" | null
const loggedActivities = new Map(); // compositeKey -> Array<Activity>
const activityOutbox = new Map(); // idempotencyKey -> ActivityRecord
const candidateSubmissions = new Map(); // compositeKey -> session-only submission record
let runtimeJobs = [];
const runtimeCandidatesByJob = new Map();

function sourceIdentity(candidateId) {
  const [source, rawId] = String(candidateId || "").split(":");
  const sourceId = Number(rawId);
  if (!["sourcing", "submission"].includes(source) || !Number.isInteger(sourceId)) return null;
  return { source, sourceId };
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function displayDate(value) {
  if (!value) return "Recent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function mapLiveCandidate(row, actions = []) {
  const decision = actions.find((item) => item.action_type === "decision")?.decision || null;
  const activityTrail = actions
    .filter((item) => item.action_type === "activity")
    .map((item) => ({
      id: `db-act-${item.id}`,
      type: item.activity_type,
      actor: "Ja Maralit",
      isJa: true,
      actorUnknown: false,
      date: displayDate(item.created_at),
      note: item.note || "",
      status: item.status === "waiting_for_loxo" ? "Waiting for Loxo" : "Saved",
      targetStage: item.target_stage || "No automatic stage change",
    }));

  const resumeText = row.resume_text || "";

  return {
    id: `${row.candidate_source}:${row.candidate_source_id}`,
    candidateId: row.candidate_key || `${row.candidate_source}-${row.candidate_source_id}`,
    candidateSource: row.candidate_source,
    candidateSourceId: row.candidate_source_id,
    jobId: String(row.job_id),
    name: row.candidate_name || "Unnamed candidate",
    initials: initials(row.candidate_name),
    title: row.current_title || "Title not recorded",
    employer: row.current_company || "Company not recorded",
    location: row.location || "",
    email: row.email || "",
    phone: row.phone || "",
    stage: row.stage || "Needs checking",
    resumeStatus: resumeText ? "resume_on_file" : row.profile_url ? "profile_only" : "no_resume_data",
    fullResumeText: resumeText,
    workHistory: [],
    education: [],
    skills: [],
    certifications: [],
    profileSummary: row.profile_summary || "",
    additionalNotes: row.additional_notes || "",
    fitEvidence: row.fit_evidence || "",
    gaps: row.gaps || "",
    profileUrl: row.profile_url || "",
    trackerRow: row.tracker_row,
    sourceVerifiedDate: row.source_verified_date || null,
    decision,
    activityTrail,
    otherContactsCount: 0,
    alsoFits: [],
    submissionHistory: [],
  };
}

export async function loadLiveReviewJobs() {
  const [{ data, error }, { data: linkedRows, error: linkedError }] = await Promise.all([
    supabase
      .from("tracker_jobs")
      .select("job_id,job_title,company,location,compensation,status,date_opened,owners,loxo_link")
      .eq("status", "Active")
      .order("date_opened", { ascending: false, nullsFirst: false }),
    supabase.from("candidate_review_feed").select("job_id").limit(1000),
  ]);
  if (error) throw new Error("Supabase could not load Tracker jobs");
  if (linkedError) throw new Error("Supabase could not load candidate job links");

  const linkedJobIds = new Set((linkedRows || []).map((row) => String(row.job_id)));

  runtimeJobs = (data || []).map((job) => ({
    id: String(job.job_id),
    loxoJobId: String(job.job_id),
    title: job.job_title,
    company: job.company || "Company not recorded",
    location: job.location || "",
    compensation: job.compensation || "",
    status: job.status || "",
    openedOn: job.date_opened || null,
    owners: job.owners || "",
    loxoLink: job.loxo_link || "",
  })).sort((a, b) => Number(linkedJobIds.has(b.id)) - Number(linkedJobIds.has(a.id)));
  return runtimeJobs;
}

export async function loadLiveCandidatesForJob(jobId) {
  const { data: rows, error } = await supabase
    .from("candidate_review_feed")
    .select("*")
    .eq("job_id", Number(jobId))
    .limit(500);
  if (error) throw new Error("Supabase could not load candidates for this job");

  const { data: actions, error: actionsError } = await supabase
    .from("candidate_review_actions")
    .select("*")
    .eq("job_id", Number(jobId))
    .order("created_at", { ascending: false });
  if (actionsError) throw new Error("Supabase could not load saved review actions");

  const actionMap = new Map();
  for (const item of actions || []) {
    const key = `${item.candidate_source}:${item.candidate_source_id}`;
    const list = actionMap.get(key) || [];
    list.push(item);
    actionMap.set(key, list);
  }

  const candidates = (rows || []).map((row) => {
    const key = `${row.candidate_source}:${row.candidate_source_id}`;
    return mapLiveCandidate(row, actionMap.get(key) || []);
  });
  runtimeCandidatesByJob.set(String(jobId), candidates);
  return candidates;
}

export function makeCompositeKey(jobId, personId) {
  if (!jobId || !personId) return "";
  return `${String(jobId).trim()}::${String(personId).trim()}`;
}

export function getReviewJobs() {
  return runtimeJobs;
}

export function getJobById(jobId) {
  if (!jobId) return null;
  // Match ONLY by immutable job ID. Zero title matching. Zero jobs[0] fallback.
  return getReviewJobs().find((j) => String(j.id) === String(jobId)) || null;
}

export function getCandidatesForJob(jobId) {
  if (!jobId) return [];

  const job = getJobById(jobId);
  if (!job) return []; // Unmatched job yields empty array

  const source = runtimeCandidatesByJob.get(String(jobId)) || [];
  const matches = source.filter(
    (cand) => String(cand.jobId) === String(jobId)
  );

  const enriched = matches.map((cand) => {
    const key = makeCompositeKey(jobId, cand.id);
    const decision = candidateDecisions.has(key) ? candidateDecisions.get(key) : (cand.decision || null);
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
  const candidateSource = [...runtimeCandidatesByJob.values()].flat();

  for (const candidate of candidateSource) {
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
    const candidate = candidateSource.find(
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

  const source = sourceIdentity(personId);
  if (source) {
    const { data: existing, error: lookupError } = await supabase
      .from("candidate_review_actions")
      .select("id")
      .eq("job_id", Number(jobId))
      .eq("candidate_source", source.source)
      .eq("candidate_source_id", source.sourceId)
      .eq("action_type", "decision")
      .maybeSingle();
    if (lookupError) throw new Error("Could not check the saved decision");

    if (decision === null && existing) {
      const { error } = await supabase.from("candidate_review_actions").delete().eq("id", existing.id);
      if (error) throw new Error("Could not clear the saved decision");
    } else if (decision === "want" || decision === "pass") {
      const payload = { decision, updated_at: new Date().toISOString() };
      const result = existing
        ? await supabase.from("candidate_review_actions").update(payload).eq("id", existing.id)
        : await supabase.from("candidate_review_actions").insert({
            job_id: Number(jobId),
            candidate_source: source.source,
            candidate_source_id: source.sourceId,
            action_type: "decision",
            decision,
          });
      if (result.error) throw new Error("Could not save the candidate decision");
    }
  }

  if (decision === "want" || decision === "pass" || decision === null) {
    candidateDecisions.set(key, decision);
    const candidates = runtimeCandidatesByJob.get(String(jobId));
    const candidate = candidates?.find((item) => item.id === personId);
    if (candidate) candidate.decision = decision;
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

  const candidateSource = runtimeCandidatesByJob.get(String(jobId)) || [];
  const candidate = candidateSource.find(
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

  const source = sourceIdentity(personId);
  if (source) {
    const idempotencyKey = `submission-${jobId}-${source.source}-${source.sourceId}-${submission.submittedAt}`;
    const { error } = await supabase.from("candidate_review_actions").insert({
      job_id: Number(jobId),
      candidate_source: source.source,
      candidate_source_id: source.sourceId,
      action_type: "activity",
      activity_type: "Submitted",
      note: submission.note,
      target_stage: "Submitted",
      status: "waiting_for_loxo",
      idempotency_key: idempotencyKey,
    });
    if (error) throw new Error("Could not save the submission draft");
    submission.status = "Waiting for Loxo";
  }
  candidateSubmissions.set(key, submission);
  return { ok: true, jobId, personId, submission, persisted: Boolean(source) };
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

  const resolvedIdempotencyKey = idempotencyKey ||
    `activity-${jobId}-${personId}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

  const source = sourceIdentity(personId);
  if (source) {
    const { data, error } = await supabase
      .from("candidate_review_actions")
      .insert({
        job_id: Number(jobId),
        candidate_source: source.source,
        candidate_source_id: source.sourceId,
        action_type: "activity",
        activity_type: type,
        note: (note || "").trim(),
        target_stage: targetStage || null,
        status: "waiting_for_loxo",
        idempotency_key: resolvedIdempotencyKey,
      })
      .select("id,created_at")
      .single();
    if (error) throw new Error("Could not save the activity draft");
    newActivity.id = `db-act-${data.id}`;
    newActivity.date = displayDate(data.created_at);
  }

  activityOutbox.set(resolvedIdempotencyKey, newActivity);

  const list = loggedActivities.get(key) || [];
  list.unshift(newActivity);
  loggedActivities.set(key, list);

  return { ok: true, activity: newActivity };
}

export async function createCandidateDraft({ job, candidate, kind, body }) {
  const source = sourceIdentity(candidate?.id);
  const cleanBody = String(body || "").trim();
  if (!source || !job?.id) throw new Error("Candidate source is not available");
  if (!cleanBody) throw new Error("The draft has no source-backed content");
  if (!["resume_pdf", "write_up"].includes(kind)) throw new Error("Unsupported draft type");

  const { data, error } = await supabase
    .from("review_drafts")
    .insert({
      person_id: null,
      job_id: Number(job.id),
      candidate_source: source.source,
      candidate_source_id: source.sourceId,
      kind,
      status: "ready",
      body: cleanBody,
      source_snapshot: {
        trackerRow: candidate.trackerRow || null,
        candidateKey: candidate.candidateId || null,
        sourceVerifiedDate: candidate.sourceVerifiedDate || null,
      },
    })
    .select("id,kind,status,body,created_at")
    .single();
  if (error) throw new Error("Could not save the draft");
  return data;
}

export function _resetStoreForTesting({ jobs = [], candidates = [] } = {}) {
  candidateDecisions.clear();
  loggedActivities.clear();
  activityOutbox.clear();
  candidateSubmissions.clear();
  runtimeJobs = jobs.map((job) => ({ ...job }));
  runtimeCandidatesByJob.clear();
  for (const candidate of candidates) {
    const key = String(candidate.jobId);
    const group = runtimeCandidatesByJob.get(key) || [];
    group.push({ ...candidate });
    runtimeCandidatesByJob.set(key, group);
  }
}
