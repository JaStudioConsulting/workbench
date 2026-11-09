// Data layer abstraction for Candidate Review
// Allows sample fixture data to be swapped with Supabase later without modifying UI views

import { SAMPLE_JOBS, SAMPLE_CANDIDATES } from "./sampleReviewData.js";
import { PIPELINE_STAGE_ORDER } from "./constants.js";
import { supabase } from "../../supabase-client.js";

// In-memory local stores (in-memory only, no persistent browser storage)
// Keyed strictly by composite key: jobId + "::" + loxoPersonId
const candidateDecisions = new Map(); // compositeKey -> "want" | "pass" | null
const loggedActivities = new Map(); // compositeKey -> Array<Activity>
const activityOutbox = new Map(); // idempotencyKey -> ActivityRecord
let supabaseClient = supabase;
let liveModeActive = false;
let runtimeJobs = [];
let runtimePresentations = [];
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

function findLoadedCandidate(jobId, personId) {
  if (!personId) return null;
  if (jobId) {
    const byJob = runtimeCandidatesByJob.get(String(jobId));
    const exact = byJob?.find((item) => String(item.id) === String(personId));
    if (exact) return exact;
  }
  for (const list of runtimeCandidatesByJob.values()) {
    const match = list.find((item) => String(item.id) === String(personId));
    if (match) return match;
  }
  return null;
}

export function mapLivePresentation(row, candidate = null) {
  const presentationState =
    row.presentation_state === "confirmed"
      ? "confirmed"
      : row.presentation_state === "failed"
        ? "failed"
        : "pending";
  const isConfirmed = presentationState === "confirmed";
  const personId =
    row.candidate_source && row.candidate_source_id !== null && row.candidate_source_id !== undefined
      ? `${row.candidate_source}:${row.candidate_source_id}`
      : candidate?.id || null;
  const jobId =
    row.job_id !== null && row.job_id !== undefined && String(row.job_id).trim() !== ""
      ? String(row.job_id)
      : null;
  const clientName =
    row.client_name !== null && row.client_name !== undefined && String(row.client_name).trim() !== ""
      ? String(row.client_name).trim()
      : null;
  const jobTitle =
    row.job_title !== null && row.job_title !== undefined && String(row.job_title).trim() !== ""
      ? String(row.job_title).trim()
      : null;
  const presentedOn = row.presented_on ?? null;
  const queuedAt = row.queued_at ?? null;
  const sourceStatus = row.source_status ?? null;
  const status = isConfirmed
    ? sourceStatus || "Submitted"
    : presentationState === "failed"
      ? "Failed"
      : "Waiting for Loxo";

  const matchedCandidate = candidate || findLoadedCandidate(jobId, personId);
  const baseCandidate = matchedCandidate || {
    id: personId || String(row.id),
    candidateId: row.candidate_key || (personId ? personId.replace(":", "-") : String(row.id)),
    candidateSource: row.candidate_source ?? null,
    candidateSourceId: row.candidate_source_id ?? null,
    jobId,
    name: row.candidate_name || "Unnamed candidate",
    initials: initials(row.candidate_name),
    title: "Title not recorded",
    employer: "Company not recorded",
    location: "",
    email: "",
    phone: "",
    stage: isConfirmed ? sourceStatus || "Submitted" : "Needs checking",
    resumeStatus: "no_resume_data",
    fullResumeText: "",
    workHistory: [],
    education: [],
    skills: [],
    certifications: [],
    profileSummary: "",
    additionalNotes: "",
    fitEvidence: "",
    gaps: "",
    profileUrl: "",
    trackerRow: null,
    sourceVerifiedDate: null,
    decision: null,
    activityTrail: [],
    otherContactsCount: 0,
    alsoFits: [],
    submissionHistory: [],
  };

  const record = {
    id: String(row.id),
    presentationState,
    isConfirmed,
    source: row.source || null,
    sourceId: row.source_id ?? null,
    candidateSource: row.candidate_source ?? null,
    candidateSourceId: row.candidate_source_id ?? null,
    personId,
    candidateKey: row.candidate_key ?? null,
    candidateName: row.candidate_name ?? null,
    clientName,
    client: clientName,
    jobId,
    jobTitle,
    presentedOn,
    queuedAt,
    submittedAt: presentedOn ?? queuedAt ?? null,
    sourceStatus,
    status,
    submissionType: row.submission_type ?? null,
    recruiter: row.recruiter ?? null,
    note: row.note ?? null,
    location: baseCandidate.location || null,
  };

  return {
    ...record,
    candidate: {
      ...baseCandidate,
      submission: record,
      presentationState,
      isSubmitted: isConfirmed,
    },
  };
}

const PRESENTATION_PAGE_SIZE = 1000;

async function fetchPresentationRows() {
  const allRows = [];
  for (let start = 0; ; start += PRESENTATION_PAGE_SIZE) {
    const { data, error } = await supabaseClient
      .from("presentations")
      .select("*")
      .order("id", { ascending: true })
      .range(start, start + PRESENTATION_PAGE_SIZE - 1);
    if (error) throw new Error("Supabase could not load presentation history");
    const page = data || [];
    allRows.push(...page);
    if (page.length < PRESENTATION_PAGE_SIZE) return allRows;
  }
}

export async function loadLivePresentations() {
  const rows = await fetchPresentationRows();
  liveModeActive = true;
  runtimePresentations = rows.map((row) => mapLivePresentation(row));
  return runtimePresentations;
}

export async function loadLiveReviewJobs() {
  const [
    { data, error },
    { data: linkedRows, error: linkedError },
    presentations,
  ] = await Promise.all([
    supabaseClient
      .from("tracker_jobs")
      .select("job_id,job_title,company,location,compensation,status,date_opened,owners,loxo_link")
      .eq("status", "Active")
      .order("date_opened", { ascending: false, nullsFirst: false }),
    supabaseClient.from("candidate_review_feed").select("job_id").limit(1000),
    fetchPresentationRows(),
  ]);
  if (error) throw new Error("Supabase could not load Tracker jobs");
  if (linkedError) throw new Error("Supabase could not load candidate job links");

  const linkedJobIds = new Set((linkedRows || []).map((row) => String(row.job_id)));

  liveModeActive = true;
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
  runtimePresentations = (presentations || []).map((row) => mapLivePresentation(row));
  return runtimeJobs;
}

export async function loadLiveCandidatesForJob(jobId) {
  const [
    { data: rows, error },
    { data: actions, error: actionsError },
    presentations,
  ] = await Promise.all([
    supabaseClient
      .from("candidate_review_feed")
      .select("*")
      .eq("job_id", Number(jobId))
      .limit(500),
    supabaseClient
      .from("candidate_review_actions")
      .select("*")
      .eq("job_id", Number(jobId))
      .order("created_at", { ascending: false }),
    fetchPresentationRows(),
  ]);
  if (error) throw new Error("Supabase could not load candidates for this job");
  if (actionsError) throw new Error("Supabase could not load saved review actions");

  const actionMap = new Map();
  for (const item of actions || []) {
    const key = `${item.candidate_source}:${item.candidate_source_id}`;
    const list = actionMap.get(key) || [];
    list.push(item);
    actionMap.set(key, list);
  }

  liveModeActive = true;
  const candidates = (rows || []).map((row) => {
    const key = `${row.candidate_source}:${row.candidate_source_id}`;
    return mapLiveCandidate(row, actionMap.get(key) || []);
  });
  runtimeCandidatesByJob.set(String(jobId), candidates);
  runtimePresentations = (presentations || []).map((row) => mapLivePresentation(row));
  return candidates;
}

export function makeCompositeKey(jobId, personId) {
  if (!jobId || !personId) return "";
  return `${String(jobId).trim()}::${String(personId).trim()}`;
}

export function isSampleData() {
  return !liveModeActive && runtimeJobs.length === 0 && runtimePresentations.length === 0;
}

export function getReviewJobs() {
  return !isSampleData() ? runtimeJobs : SAMPLE_JOBS;
}

export function getJobById(jobId) {
  if (!jobId) return null;
  // Match ONLY by immutable job ID. Zero title matching. Zero jobs[0] fallback.
  return getReviewJobs().find((j) => String(j.id) === String(jobId)) || null;
}

function sortPresentationRecords(records) {
  return [...records].sort((a, b) => {
    const cmp = String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""));
    if (cmp !== 0) return cmp;
    return Number(b.sourceId || 0) - Number(a.sourceId || 0);
  });
}

export function getCandidatesForJob(jobId) {
  if (!jobId) return [];

  const job = getJobById(jobId);
  if (!job) return []; // Unmatched job yields empty array

  const sampleMode = isSampleData();
  const source = !sampleMode
    ? (runtimeCandidatesByJob.get(String(jobId)) || [])
    : SAMPLE_CANDIDATES;
  const matches = source.filter(
    (cand) => String(cand.jobId) === String(jobId)
  );
  const sortedPresentations = !sampleMode ? sortPresentationRecords(runtimePresentations) : [];

  const enriched = matches.map((cand) => {
    const key = makeCompositeKey(jobId, cand.id);
    const decision = candidateDecisions.has(key) ? candidateDecisions.get(key) : (cand.decision || null);
    const additional = loggedActivities.get(key) || [];
    const fullTrail = [...additional, ...cand.activityTrail];

    // Compute other contacts count (activities performed by someone other than Ja)
    const otherContactsCount = fullTrail.filter(
      (ev) => !ev.isJa && ev.actor && !ev.actorUnknown
    ).length;

    if (sampleMode) {
      const importedSubmission = cand.submissionHistory?.[0]
        ? {
            ...cand.submissionHistory[0],
            presentationState: "confirmed",
            isConfirmed: true,
            source: "imported",
          }
        : null;
      const stageIsSubmitted = (PIPELINE_STAGE_ORDER[cand.stage] ?? -1) >= PIPELINE_STAGE_ORDER.Submitted;
      const isSubmitted = Boolean(importedSubmission || stageIsSubmitted);
      return {
        ...cand,
        decision,
        submission: importedSubmission,
        presentationState: isSubmitted ? "confirmed" : null,
        isSubmitted,
        activityTrail: fullTrail,
        otherContactsCount,
      };
    }

    const matchingPresentations = sortedPresentations.filter((item) => {
      if (item.personId !== cand.id) return false;
      if (item.jobId !== null) return String(item.jobId) === String(jobId);
      return cand.candidateSource === "submission" && item.source === "tracker_submissions";
    });
    const confirmedPresentation = matchingPresentations.find((item) => item.presentationState === "confirmed") || null;
    const pendingPresentation = matchingPresentations.find((item) => item.presentationState === "pending") || null;
    const failedPresentation = matchingPresentations.find((item) => item.presentationState === "failed") || null;
    const primaryPresentation = confirmedPresentation || pendingPresentation || failedPresentation || null;
    const isSubmitted = Boolean(confirmedPresentation);
    const presentationState = isSubmitted
      ? "confirmed"
      : pendingPresentation
        ? "pending"
        : failedPresentation
          ? "failed"
          : null;

    return {
      ...cand,
      decision,
      submission: primaryPresentation,
      presentationState,
      isSubmitted,
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
  if (isSampleData()) {
    const records = [];
    for (const candidate of SAMPLE_CANDIDATES) {
      const job = getJobById(candidate.jobId);
      for (const submission of candidate.submissionHistory || []) {
        const record = {
          id: submission.id || `${candidate.jobId}::${candidate.id}::${submission.submittedAt}`,
          presentationState: "confirmed",
          isConfirmed: true,
          jobId: candidate.jobId ?? null,
          personId: candidate.id,
          jobTitle: job?.title ?? null,
          clientName: submission.client ?? job?.company ?? null,
          client: submission.client ?? job?.company ?? null,
          location: submission.location || job?.location || candidate.location || null,
          presentedOn: submission.submittedAt ? String(submission.submittedAt).slice(0, 10) : null,
          queuedAt: null,
          submittedAt: submission.submittedAt,
          sourceStatus: "Submitted",
          status: "Submitted",
          source: "imported",
          note: submission.note ?? null,
        };
        records.push({
          ...record,
          candidate: {
            ...candidate,
            decision: null,
            submission: record,
            presentationState: "confirmed",
            isSubmitted: true,
          },
        });
      }
    }
    return sortPresentationRecords(records);
  }

  const hydrated = runtimePresentations.map((record) => {
    const matchedCandidate = findLoadedCandidate(record.jobId, record.personId);
    const baseCandidate = matchedCandidate || record.candidate;
    const key = record.jobId && record.personId ? makeCompositeKey(record.jobId, record.personId) : "";
    const decision =
      key && candidateDecisions.has(key)
        ? candidateDecisions.get(key)
        : (baseCandidate?.decision ?? null);
    const isConfirmed = record.presentationState === "confirmed";
    const location = matchedCandidate?.location || record.location || null;
    const nextRecord = {
      ...record,
      location,
    };
    return {
      ...nextRecord,
      candidate: {
        ...baseCandidate,
        decision,
        submission: nextRecord,
        presentationState: record.presentationState,
        isSubmitted: isConfirmed,
      },
    };
  });

  return sortPresentationRecords(hydrated);
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
    const { data: existing, error: lookupError } = await supabaseClient
      .from("candidate_review_actions")
      .select("id")
      .eq("job_id", Number(jobId))
      .eq("candidate_source", source.source)
      .eq("candidate_source_id", source.sourceId)
      .eq("action_type", "decision")
      .maybeSingle();
    if (lookupError) throw new Error("Could not check the saved decision");

    if (decision === null && existing) {
      const { error } = await supabaseClient.from("candidate_review_actions").delete().eq("id", existing.id);
      if (error) throw new Error("Could not clear the saved decision");
    } else if (decision === "want" || decision === "pass") {
      const payload = { decision, updated_at: new Date().toISOString() };
      const result = existing
        ? await supabaseClient.from("candidate_review_actions").update(payload).eq("id", existing.id)
        : await supabaseClient.from("candidate_review_actions").insert({
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

  const candidateSource = !isSampleData()
    ? (runtimeCandidatesByJob.get(String(jobId)) || [])
    : SAMPLE_CANDIDATES;
  const candidate = candidateSource.find(
    (item) => String(item.jobId) === String(jobId) && String(item.id) === String(personId)
  );
  const job = getJobById(jobId);
  if (!candidate || !job) {
    throw new Error("Cannot record submission for an unknown candidate or job");
  }

  const source = sourceIdentity(personId);
  if (!source) {
    throw new Error("Cannot record submission without a source-linked candidate");
  }

  const submittedAt = details.submittedAt || new Date().toISOString();
  const note = (details.note || "").trim();
  const idempotencyKey =
    details.idempotencyKey || `submission-${jobId}-${source.source}-${source.sourceId}-${submittedAt}`;

  const { error } = await supabaseClient.from("candidate_review_actions").insert({
    job_id: Number(jobId),
    candidate_source: source.source,
    candidate_source_id: source.sourceId,
    action_type: "activity",
    activity_type: "Submitted",
    note,
    target_stage: "Submitted",
    status: "waiting_for_loxo",
    idempotency_key: idempotencyKey,
  });
  if (error) throw new Error("Could not save the submission draft");

  await loadLiveCandidatesForJob(jobId);

  const refreshed =
    getSubmissionHistory().find(
      (record) =>
        record.source === "candidate_review_actions" &&
        String(record.jobId) === String(jobId) &&
        String(record.personId) === String(personId)
    ) || null;

  return {
    ok: true,
    jobId: String(jobId),
    personId: String(personId),
    submission: refreshed,
    persisted: true,
  };
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
    const { data, error } = await supabaseClient
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

  const { data, error } = await supabaseClient
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

export function _setSupabaseClientForTesting(client) {
  supabaseClient = client || supabase;
}

export function _resetStoreForTesting() {
  supabaseClient = supabase;
  liveModeActive = false;
  candidateDecisions.clear();
  loggedActivities.clear();
  activityOutbox.clear();
  runtimeJobs = [];
  runtimePresentations = [];
  runtimeCandidatesByJob.clear();
}
