// Data layer for live Candidate Review records.
// Empty or unavailable sources never substitute synthetic records.
import { PIPELINE_STAGE_ORDER } from "./constants.js";
import { supabase } from "../../supabase-client.js";
import { parseCandidateSourceKey } from "@ja/shared-types";

// In-memory local stores (in-memory only, no persistent browser storage)
// Keyed strictly by composite key: jobId + "::" + loxoPersonId
const candidateDecisions = new Map(); // compositeKey -> "want" | "pass" | null
const loggedActivities = new Map(); // compositeKey -> Array<Activity>
const activityOutbox = new Map(); // idempotencyKey -> ActivityRecord
let supabaseClient = supabase;
let runtimeJobs = [];
let runtimePresentations = [];
const runtimeCandidatesByJob = new Map();

function sourceIdentity(candidateId) {
  const [source, rawId] = String(candidateId || "").split(":");
  const sourceId = Number(rawId);
  if (!["sourcing", "submission"].includes(source) || !Number.isInteger(sourceId)) return null;
  return { source, sourceId };
}

export function buildCandidateSourceKey(candidateSource, candidateSourceId) {
  if (typeof candidateSource !== "string" || candidateSourceId === null || candidateSourceId === undefined) {
    return null;
  }
  const source = candidateSource.trim();
  const rawId = String(candidateSourceId).trim();
  return parseCandidateSourceKey(`${source}:${rawId}`)?.id ?? null;
}

export function extractCandidateSourceKey(entity) {
  if (!entity) return null;
  if (typeof entity === "string") {
    const trimmed = entity.trim();
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex <= 0) return null;
    return buildCandidateSourceKey(trimmed.slice(0, colonIndex), trimmed.slice(colonIndex + 1));
  }
  if (typeof entity !== "object") return null;

  const rawSource = entity.candidate_source ?? entity.candidateSource;
  const rawSourceId = entity.candidate_source_id ?? entity.candidateSourceId;
  if (
    (rawSource !== undefined && rawSource !== null) ||
    (rawSourceId !== undefined && rawSourceId !== null)
  ) {
    return buildCandidateSourceKey(rawSource, rawSourceId);
  }

  if (typeof entity.personId === "string" && entity.personId.trim()) {
    const fromPersonId = extractCandidateSourceKey(entity.personId);
    if (fromPersonId) return fromPersonId;
  }

  if (typeof entity.id === "string" && entity.id.trim()) {
    return extractCandidateSourceKey(entity.id);
  }

  return null;
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

export function normalizePresentationRecord(row, candidate = null) {
  if (!row || typeof row !== "object") return null;
  const rawState = row.presentation_state ?? row.presentationState;
  const rawStatus = row.source_status ?? row.sourceStatus ?? null;
  const source = row.source ? String(row.source).trim() : null;
  const presentationState =
    rawState === "confirmed" && source !== "candidate_review_actions"
      ? "confirmed"
      : rawState === "failed" || rawStatus === "failed"
        ? "failed"
        : "pending";
  const isConfirmed = presentationState === "confirmed";

  const candidateSource =
    row.candidate_source !== undefined ? row.candidate_source : (row.candidateSource ?? null);
  const candidateSourceId =
    row.candidate_source_id !== undefined ? row.candidate_source_id : (row.candidateSourceId ?? null);
  const hasExplicitSourceFields =
    (candidateSource !== undefined && candidateSource !== null) ||
    (candidateSourceId !== undefined && candidateSourceId !== null);

  const sourceKeyFromRow = buildCandidateSourceKey(candidateSource, candidateSourceId);
  const personId =
    sourceKeyFromRow ||
    (!hasExplicitSourceFields && row.personId ? extractCandidateSourceKey({ id: row.personId }) : null) ||
    (source === "imported" && row.personId ? String(row.personId).trim() : null) ||
    (!hasExplicitSourceFields ? extractCandidateSourceKey(candidate) : null) ||
    null;

  const rawJobId = row.job_id !== undefined ? row.job_id : row.jobId;
  const jobId =
    rawJobId !== null && rawJobId !== undefined && String(rawJobId).trim() !== ""
      ? String(rawJobId).trim()
      : null;

  const rawClientName =
    row.client_name !== undefined
      ? row.client_name
      : row.clientName !== undefined
        ? row.clientName
        : row.client;
  const clientName =
    rawClientName !== null && rawClientName !== undefined && String(rawClientName).trim() !== ""
      ? String(rawClientName).trim()
      : null;

  const rawJobTitle = row.job_title !== undefined ? row.job_title : row.jobTitle;
  const jobTitle =
    rawJobTitle !== null && rawJobTitle !== undefined && String(rawJobTitle).trim() !== ""
      ? String(rawJobTitle).trim()
      : null;

  const rawPresentedOn = row.presented_on !== undefined ? row.presented_on : row.presentedOn;
  const presentedOn =
    rawPresentedOn !== null && rawPresentedOn !== undefined && String(rawPresentedOn).trim() !== ""
      ? String(rawPresentedOn).trim()
      : null;

  const rawQueuedAt = row.queued_at !== undefined ? row.queued_at : row.queuedAt;
  const queuedAt =
    rawQueuedAt !== null && rawQueuedAt !== undefined && String(rawQueuedAt).trim() !== ""
      ? String(rawQueuedAt).trim()
      : null;

  const sourceStatus =
    rawStatus !== null && rawStatus !== undefined && String(rawStatus).trim() !== ""
      ? String(rawStatus).trim()
      : null;

  const status = isConfirmed
    ? sourceStatus || "Submitted"
    : presentationState === "failed"
      ? "Failed"
      : "Waiting for Loxo";

  const clientLabel = clientName || "Client not recorded";
  const jobLabel = jobTitle || "Job not recorded";
  const dateLabel = isConfirmed
    ? presentedOn
      ? String(presentedOn).slice(0, 10)
      : "Date not recorded"
    : queuedAt
      ? `Queued ${String(queuedAt).slice(0, 10)}`
      : "Date not recorded";
  const statusLabel = isConfirmed
    ? source === "imported"
      ? "Imported"
      : sourceStatus || "Submitted"
    : presentationState === "failed"
      ? "Submission failed"
      : "Waiting for Loxo";

  return {
    id: String(row.id ?? `${source || "presentation"}:${personId || "unknown"}:${presentedOn || queuedAt || "unknown"}`),
    presentationState,
    isConfirmed,
    source,
    sourceId: row.source_id !== undefined ? row.source_id : (row.sourceId ?? null),
    candidateSource: candidateSource ?? (sourceKeyFromRow ? sourceKeyFromRow.split(":")[0] : null),
    candidateSourceId: candidateSourceId ?? null,
    personId,
    candidateKey: row.candidate_key !== undefined ? row.candidate_key : (row.candidateKey ?? null),
    candidateName: row.candidate_name !== undefined ? row.candidate_name : (row.candidateName ?? null),
    clientName,
    client: clientName,
    clientLabel,
    jobId,
    jobTitle,
    jobLabel,
    presentedOn,
    queuedAt,
    submittedAt: presentedOn ?? queuedAt ?? (row.submittedAt ?? null),
    dateLabel,
    sourceStatus,
    status,
    statusLabel,
    submissionType: row.submission_type !== undefined ? row.submission_type : (row.submissionType ?? null),
    recruiter: row.recruiter ?? null,
    note: row.note ?? null,
    location: row.location ?? candidate?.location ?? null,
  };
}

export function mapLivePresentation(row, candidate = null) {
  const normalized = normalizePresentationRecord(row, candidate);
  const { presentationState, isConfirmed, personId, jobId, sourceStatus } = normalized;

  const matchedCandidate = candidate || findLoadedCandidate(jobId, personId);
  const baseCandidate = matchedCandidate || {
    id: personId || String(row.id),
    candidateId: normalized.candidateKey || (personId ? personId.replace(":", "-") : String(row.id)),
    candidateSource: normalized.candidateSource ?? null,
    candidateSourceId: normalized.candidateSourceId ?? null,
    jobId,
    name: normalized.candidateName || "Unnamed candidate",
    initials: initials(normalized.candidateName),
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
    ...normalized,
    location: baseCandidate.location || normalized.location || null,
  };

  return {
    ...record,
    candidate: {
      ...baseCandidate,
      submission: record,
      presentationState,
      isPresented: isConfirmed,
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
  runtimePresentations = rows.map((row) => mapLivePresentation(row));
  for (const [jobId, list] of runtimeCandidatesByJob.entries()) {
    runtimeCandidatesByJob.set(
      jobId,
      list.map((cand) => enrichCandidateWithPresentations(cand, runtimePresentations, { jobId }))
    );
  }
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

  runtimePresentations = (presentations || []).map((row) => mapLivePresentation(row));
  const rawCandidates = (rows || []).map((row) => {
    const key = `${row.candidate_source}:${row.candidate_source_id}`;
    return mapLiveCandidate(row, actionMap.get(key) || []);
  });
  const candidates = rawCandidates.map((cand) =>
    enrichCandidateWithPresentations(cand, runtimePresentations, { jobId })
  );
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

function sortPresentationRecords(records) {
  return [...records].sort((a, b) => {
    const cmp = String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""));
    if (cmp !== 0) return cmp;
    return Number(b.sourceId || 0) - Number(a.sourceId || 0);
  });
}

function buildEmptyPresentationSummary(candidateSourceKey = null) {
  return {
    candidateSourceKey,
    isPresented: false,
    isSubmitted: false,
    presentationState: null,
    badgeLabel: null,
    pendingBadgeLabel: null,
    failedBadgeLabel: null,
    submission: null,
    presentations: [],
    confirmedPresentations: [],
    pendingPresentations: [],
    failedPresentations: [],
    unconfirmedPresentations: [],
    presentedClients: [],
    presentedClientLabels: [],
    presentedClientSummaries: [],
    hasUnknownConfirmedClient: false,
  };
}

export function buildCandidatePresentationSummary(
  candidate,
  presentationRecords = null,
  { jobId = null } = {}
) {
  if (!candidate) return buildEmptyPresentationSummary(null);

  const candidateKey =
    typeof candidate === "string"
      ? extractCandidateSourceKey(candidate)
      : extractCandidateSourceKey(candidate);

  if (!candidateKey) {
    return buildEmptyPresentationSummary(null);
  }

  const candidateRecords = [];
  if (Array.isArray(presentationRecords)) {
    candidateRecords.push(...presentationRecords);
  } else {
    candidateRecords.push(...runtimePresentations);
    if (typeof candidate === "object") {
      if (Array.isArray(candidate.presentations)) candidateRecords.push(...candidate.presentations);
      if (Array.isArray(candidate.confirmedPresentations)) candidateRecords.push(...candidate.confirmedPresentations);
      if (Array.isArray(candidate.pendingPresentations)) candidateRecords.push(...candidate.pendingPresentations);
      if (Array.isArray(candidate.failedPresentations)) candidateRecords.push(...candidate.failedPresentations);
      if (candidate.submission && typeof candidate.submission === "object") {
        candidateRecords.push(candidate.submission);
      }
    }
  }

  // Exact candidate_source:candidate_source_id join only (never match by candidate_name).
  const byId = new Map();
  for (const rawItem of candidateRecords) {
    const record = normalizePresentationRecord(rawItem);
    if (!record) continue;
    if (record.personId !== candidateKey) continue;
    if (!byId.has(record.id)) {
      byId.set(record.id, record);
    }
  }

  const sorted = sortPresentationRecords([...byId.values()]);
  const confirmedPresentations = sorted.filter((item) => item.presentationState === "confirmed");
  const pendingPresentations = sorted.filter((item) => item.presentationState === "pending");
  const failedPresentations = sorted.filter((item) => item.presentationState === "failed");
  const unconfirmedPresentations = sorted.filter((item) => item.presentationState !== "confirmed");

  const clientGroups = new Map();
  for (const record of confirmedPresentations) {
    const groupKey = record.clientName
      ? `client:${record.clientName.toLowerCase()}`
      : "__unknown_client__";
    const existing = clientGroups.get(groupKey);
    if (!existing) {
      clientGroups.set(groupKey, {
        key: groupKey,
        clientName: record.clientName,
        clientLabel: record.clientLabel,
        isUnknownClient: !record.clientName,
        jobId: record.jobId,
        jobTitle: record.jobTitle,
        jobLabel: record.jobLabel,
        presentedOn: record.presentedOn ? String(record.presentedOn).slice(0, 10) : null,
        dateLabel: record.dateLabel,
        sourceStatus: record.sourceStatus,
        statusLabel: record.statusLabel,
        presentationCount: 1,
        records: [record],
      });
    } else {
      existing.presentationCount += 1;
      existing.records.push(record);
    }
  }

  const presentedClientSummaries = [...clientGroups.values()];
  const presentedClients = presentedClientSummaries
    .filter((group) => !group.isUnknownClient)
    .map((group) => group.clientName);
  const hasUnknownConfirmedClient = clientGroups.has("__unknown_client__");
  const presentedClientLabels = presentedClientSummaries.map((group) => group.clientLabel);

  const isPresented = confirmedPresentations.length > 0;
  const isSubmitted = isPresented;

  const targetJobId = jobId ?? (typeof candidate === "object" ? candidate.jobId : null) ?? null;
  const pickForJob = (list) =>
    (targetJobId
      ? list.find((item) => item.jobId !== null && String(item.jobId) === String(targetJobId))
      : null) ||
    list[0] ||
    null;

  const confirmedPrimary = pickForJob(confirmedPresentations);
  const pendingPrimary = pickForJob(pendingPresentations);
  const failedPrimary = pickForJob(failedPresentations);
  const primaryPresentation = confirmedPrimary || pendingPrimary || failedPrimary || null;

  const presentationState = isSubmitted
    ? "confirmed"
    : pendingPrimary
      ? "pending"
      : failedPrimary
        ? "failed"
        : null;

  const badgeLabel = isPresented
    ? "Presented"
    : pendingPrimary
      ? "Pending confirmation"
      : failedPrimary
        ? "Submission failed"
        : null;

  return {
    candidateSourceKey: candidateKey,
    isPresented,
    isSubmitted,
    presentationState,
    badgeLabel,
    pendingBadgeLabel: pendingPresentations.length > 0 ? "Pending confirmation" : null,
    failedBadgeLabel: failedPresentations.length > 0 ? "Submission failed" : null,
    submission: primaryPresentation,
    presentations: sorted,
    confirmedPresentations,
    pendingPresentations,
    failedPresentations,
    unconfirmedPresentations,
    presentedClients,
    presentedClientLabels,
    presentedClientSummaries,
    hasUnknownConfirmedClient,
  };
}

export function enrichCandidateWithPresentations(
  candidate,
  presentationRecords = null,
  { jobId = null } = {}
) {
  if (!candidate || typeof candidate !== "object") return candidate;
  const summary = buildCandidatePresentationSummary(candidate, presentationRecords, { jobId });
  return {
    ...candidate,
    ...summary,
  };
}

export function enrichCandidatesWithPresentations(
  candidates = [],
  presentationRecords = null,
  { jobId = null } = {}
) {
  return (candidates || []).map((candidate) =>
    enrichCandidateWithPresentations(candidate, presentationRecords, { jobId })
  );
}

export function getCandidatesForJob(jobId) {
  if (!jobId) return [];

  const job = getJobById(jobId);
  if (!job) return []; // Unmatched job yields empty array

  const source = runtimeCandidatesByJob.get(String(jobId)) || [];
  const matches = source.filter(
    (cand) => String(cand.jobId) === String(jobId)
  );
  const sortedPresentations = sortPresentationRecords(runtimePresentations);

  const enriched = matches.map((cand) => {
    const key = makeCompositeKey(jobId, cand.id);
    const decision = candidateDecisions.has(key) ? candidateDecisions.get(key) : (cand.decision || null);
    const additional = loggedActivities.get(key) || [];
    const fullTrail = [...additional, ...(cand.activityTrail || [])];

    // Compute other contacts count (activities performed by someone other than Ja)
    const otherContactsCount = fullTrail.filter(
      (ev) => !ev.isJa && ev.actor && !ev.actorUnknown
    ).length;

    const withPresentations = enrichCandidateWithPresentations(cand, sortedPresentations, { jobId });

    return {
      ...withPresentations,
      decision,
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
  const hydrated = runtimePresentations.map((record) => {
    const matchedCandidate = findLoadedCandidate(record.jobId, record.personId);
    const baseCandidate = matchedCandidate || record.candidate;
    const key = record.jobId && record.personId ? makeCompositeKey(record.jobId, record.personId) : "";
    const decision =
      key && candidateDecisions.has(key)
        ? candidateDecisions.get(key)
        : (baseCandidate?.decision ?? null);
    const summary = buildCandidatePresentationSummary(
      { ...baseCandidate, id: record.personId || baseCandidate?.id },
      runtimePresentations,
      { jobId: record.jobId }
    );
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
        ...summary,
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

  const candidateSource = runtimeCandidatesByJob.get(String(jobId)) || [];
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

export function _resetStoreForTesting({ jobs = [], candidates = [] } = {}) {
  supabaseClient = supabase;
  candidateDecisions.clear();
  loggedActivities.clear();
  activityOutbox.clear();
  runtimeJobs = jobs.map((job) => ({ ...job }));
  runtimePresentations = [];
  runtimeCandidatesByJob.clear();
  for (const candidate of candidates) {
    const key = String(candidate.jobId);
    const group = runtimeCandidatesByJob.get(key) || [];
    group.push({ ...candidate });
    runtimeCandidatesByJob.set(key, group);
  }
}
