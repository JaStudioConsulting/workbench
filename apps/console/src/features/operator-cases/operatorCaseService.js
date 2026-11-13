import { supabase } from "../../supabase-client.js";

export const operatorCasesEnabled = import.meta.env?.VITE_OPERATOR_CASES_ENABLED === "1";

function candidateIdentity(candidateId) {
  const match = /^(sourcing|submission):([1-9]\d*)$/.exec(String(candidateId || ""));
  if (!match) return null;
  const [, source, rawId] = match;
  const sourceId = Number(rawId);
  if (!["sourcing", "submission"].includes(source) || !Number.isSafeInteger(sourceId) || sourceId <= 0) return null;
  return { source, sourceId, key: `${source}:${sourceId}` };
}

export function buildAfterCallCaseReferences({ candidateId, jobId, meetingId, candidateExists = false, jobExists = false, hasTranscript = false, hasNotes = false, candidateLabel = "Candidate source unavailable", jobLabel = "Job source unavailable" }) {
  const identity = candidateIdentity(candidateId);
  const normalizedJobId = Number(jobId);
  if (!identity || !Number.isInteger(normalizedJobId) || normalizedJobId <= 0) throw new Error("Choose a real candidate and job before preparing an approval case.");
  const meetingSourceId = String(meetingId || "unsaved-capture");
  return Object.freeze({
    caseKey: `after_call:${identity.key}:${normalizedJobId}`,
    sources: Object.freeze([
      Object.freeze({ source_type: "candidate", source_system: "supabase_tracker", source_id: identity.key, label: candidateLabel, evidence_status: candidateExists ? "confirmed" : "missing", required: true, metadata: {} }),
      Object.freeze({ source_type: "job", source_system: "supabase_tracker", source_id: String(normalizedJobId), label: jobLabel, evidence_status: jobExists ? "confirmed" : "missing", required: true, metadata: {} }),
      Object.freeze({ source_type: "transcript", source_system: "meeting_drafts", source_id: meetingSourceId, label: hasTranscript ? "Saved meeting transcript" : "Saved transcript unavailable or does not match", evidence_status: hasTranscript ? "confirmed" : "missing", required: true, metadata: {} }),
      Object.freeze({ source_type: "notes", source_system: "meeting_drafts", source_id: meetingSourceId, label: hasNotes ? "Saved call notes" : "Saved call notes unavailable or do not match", evidence_status: hasNotes ? "confirmed" : "missing", required: false, metadata: {} }),
    ]),
  });
}

export function buildDailyCaseReferences(action) {
  const id = Number(action?.id);
  const jobId = Number(action?.job_id);
  const candidateSource = String(action?.candidate_source || "");
  const candidateSourceId = Number(action?.candidate_source_id);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(jobId) || jobId <= 0
    || !/^(sourcing|submission)$/.test(candidateSource) || !Number.isSafeInteger(candidateSourceId) || candidateSourceId <= 0) {
    throw new Error("This review action is missing its exact candidate or job identity.");
  }
  return Object.freeze({
    caseKey: `daily:candidate_review_actions:${id}`,
    sources: Object.freeze([
      Object.freeze({ source_type: "candidate", source_system: "supabase_tracker", source_id: `${candidateSource}:${candidateSourceId}`, label: "Candidate linked from review action", evidence_status: "confirmed", required: true, metadata: {} }),
      Object.freeze({ source_type: "job", source_system: "supabase_tracker", source_id: String(jobId), label: "Job linked from review action", evidence_status: "confirmed", required: true, metadata: {} }),
      Object.freeze({ source_type: "draft", source_system: "candidate_review_actions", source_id: String(id), label: "Original candidate review action", evidence_status: "confirmed", required: true, observed_at: action.created_at || null, metadata: {} }),
    ]),
  });
}

async function checked(query, message) {
  const { data, error } = await query;
  if (error) throw new Error(message);
  return data;
}

export function nextCaseArtifactSourceRef(previousRef, now = Date.now()) {
  const prefix = String(previousRef || "case-artifact").slice(0, 400);
  return `${prefix}:rev:${now}:${Math.random().toString(36).slice(2, 9)}`;
}

export async function saveCaseArtifactVersion({ caseId, artifactType, sourceRef, content, generatedBy = "human" }, { client = supabase } = {}) {
  if (!caseId || !artifactType || !sourceRef || !content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("A complete draft artifact version is required.");
  }
  return checked(client.from("case_artifacts").insert({
    case_id: caseId, artifact_type: artifactType, source_ref: String(sourceRef).slice(0, 500),
    content, generated_by: generatedBy, review_state: "draft",
  }).select("*").single(), "The new draft version could not be saved.");
}

export async function appendCaseArtifactRevision(artifactId, expectedUpdatedAt, content, { client = supabase } = {}) {
  if (!artifactId || !expectedUpdatedAt || !content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("Reload the current artifact before saving a new version.");
  }
  return checked(client.rpc("save_operator_artifact_revision", {
    artifact_id: artifactId, expected_updated_at: expectedUpdatedAt, content,
  }), "The new draft revision could not be saved. Reload the latest version and try again.");
}

async function findOrCreateCase({ client, caseKey, caseType, title, status }) {
  const existing = await checked(
    client.from("operator_cases").select("*").eq("case_key", caseKey).maybeSingle(),
    "The approval case could not be checked.",
  );
  if (existing) {
    return checked(
      client.from("operator_cases").update({ title, status }).eq("id", existing.id).select("*").single(),
      "The approval case could not be updated.",
    );
  }
  const { data, error } = await client.from("operator_cases").insert({ case_key: caseKey, case_type: caseType, title, status }).select("*").single();
  if (!error) return data;
  if (error.code === "23505") {
    const raced = await checked(client.from("operator_cases").select("*").eq("case_key", caseKey).maybeSingle(), "The approval case could not be checked after a concurrent create.");
    if (raced) return raced;
  }
  throw new Error("The approval case could not be created.");
}

async function putSource(client, caseId, source) {
  const existing = await checked(
    client.from("case_sources").select("id")
      .eq("case_id", caseId).eq("source_type", source.source_type)
      .eq("source_system", source.source_system).eq("source_id", source.source_id).maybeSingle(),
    "Case evidence could not be checked.",
  );
  const payload = { ...source, case_id: caseId };
  if (existing) {
    return checked(client.from("case_sources").update(payload).eq("id", existing.id).select("*").single(), "Case evidence could not be updated.");
  }
  return checked(client.from("case_sources").insert(payload).select("*").single(), "Case evidence could not be saved.");
}

async function putArtifact(client, caseId, artifact) {
  const payload = { ...artifact, case_id: caseId, review_state: "draft", reviewed_at: null };
  // Each preparation gets a distinct source_ref, preserving reviewed snapshots.
  return checked(client.from("case_artifacts").insert(payload).select("*").single(), "The review output could not be saved.");
}

async function putAction(client, caseId, action) {
  const existing = await checked(
    client.from("case_actions").select("id,approval_state").eq("idempotency_key", action.idempotency_key).maybeSingle(),
    "The exact action could not be checked.",
  );
  if (existing) return existing;
  return checked(client.from("case_actions").insert({ ...action, case_id: caseId }).select("*").single(), "The exact action could not be saved.");
}

export function blockingEvidence(sources = []) {
  return sources.filter((source) => source.required && ["missing", "conflicting", "stale"].includes(source.evidence_status));
}

export async function listOperatorCases({ client = supabase, limit = 20 } = {}) {
  return (await checked(
    client.from("operator_cases").select("id,case_type,title,status,created_at,updated_at")
      .neq("status", "archived").order("updated_at", { ascending: false }).limit(limit),
    "Approval cases could not be loaded.",
  )) || [];
}

export async function loadOperatorCase(caseId, { client = supabase } = {}) {
  const [record, sources, artifacts, actions] = await Promise.all([
    checked(client.from("operator_cases").select("*").eq("id", caseId).single(), "The approval case could not be loaded."),
    checked(client.from("case_sources").select("*").eq("case_id", caseId).order("created_at"), "Case evidence could not be loaded."),
    checked(client.from("case_artifacts").select("*").eq("case_id", caseId).order("created_at"), "Review outputs could not be loaded."),
    checked(client.from("case_actions").select("*").eq("case_id", caseId).order("created_at"), "Exact actions could not be loaded."),
  ]);
  return { record, sources: sources || [], artifacts: artifacts || [], actions: actions || [] };
}

export async function saveAfterCallCase({ job, candidate, meetingId, transcript, notes, workflow }, { client = supabase } = {}) {
  const identity = candidateIdentity(candidate?.id);
  const jobId = Number(job?.id);
  if (!identity || !Number.isInteger(jobId) || jobId <= 0) throw new Error("Choose a real candidate and job before preparing an approval case.");

  const candidateRow = await checked(client.from("candidates_all").select("id,candidate_name").eq("id", identity.key).maybeSingle(), "The candidate source could not be checked.");
  const jobRow = await checked(client.from("tracker_jobs").select("job_id,job_title,status").eq("job_id", jobId).maybeSingle(), "The job source could not be checked.");
  const savedMeeting = meetingId ? await checked(
    client.from("meeting_drafts").select("id,job_id,candidate_source,candidate_source_id,transcript,notes").eq("id", meetingId).maybeSingle(),
    "The saved meeting could not be checked.",
  ) : null;
  const hasTranscript = Boolean(savedMeeting && String(transcript || "").trim() && savedMeeting.transcript === transcript
    && String(savedMeeting.transcript || "").trim() && Number(savedMeeting.job_id) === jobId
    && savedMeeting.candidate_source === identity.source && Number(savedMeeting.candidate_source_id) === identity.sourceId);
  const hasNotes = Boolean(savedMeeting && String(notes || "").trim() && savedMeeting.notes === notes);
  const references = buildAfterCallCaseReferences({
    candidateId: candidate.id, jobId, meetingId: savedMeeting?.id || meetingId,
    candidateExists: Boolean(candidateRow), jobExists: Boolean(jobRow), hasTranscript, hasNotes,
    candidateLabel: candidateRow?.candidate_name || candidate?.name || "Candidate source unavailable",
    jobLabel: jobRow?.job_title || job?.title || "Job source unavailable",
  });
  const caseKey = references.caseKey;
  const title = `${candidate?.name || "Candidate name not on file"} — ${job?.title || `Job ${jobId}`}`;
  const record = await findOrCreateCase({
    client, caseKey, caseType: "after_call", title,
    status: candidateRow && jobRow && hasTranscript && workflow && !workflow.audit?.finalizationBlocked && !workflow.audit?.identityReviewRequired ? "ready_for_review" : "blocked",
  });

  await Promise.all(references.sources.map((source) => putSource(client, record.id, source)));

  if (!workflow) return loadOperatorCase(record.id, { client });

  const sourceRef = `after-call:${savedMeeting?.id || "unverified"}:${Date.now()}`;
  const artifacts = [
    { artifact_type: "branded_resume", content: { text: workflow.brandedResume?.content || "", sections: workflow.brandedResume?.sections || null, pdf: workflow.brandedResume?.pdf || null, audit: workflow.audit || null } },
    { artifact_type: "candidate_submission", content: { fields: workflow.submission?.fields || {}, client: workflow.submission?.client || null, audit: workflow.audit || null } },
    { artifact_type: "presentation_email", content: { subject: workflow.presentationEmail?.subject || "", body: workflow.presentationEmail?.body || "", attachmentStatus: workflow.presentationEmail?.attachmentStatus || "not_generated", audit: workflow.audit || null } },
    { artifact_type: "loxo_update", content: { bullets: workflow.loxoDraft?.bullets || [], audit: workflow.audit || null } },
  ];
  const savedArtifacts = await Promise.all(artifacts.map((artifact) => putArtifact(client, record.id, {
    ...artifact, source_ref: sourceRef, generated_by: "after_call_service",
  })));
  const artifactByType = new Map(savedArtifacts.map((artifact) => [artifact.artifact_type, artifact]));
  await Promise.all([
    putAction(client, record.id, {
      action_type: "external_submission", idempotency_key: `${record.id}:submission:${artifactByType.get("candidate_submission").id}`,
      manifest: { caseId: record.id, artifactId: artifactByType.get("candidate_submission").id, artifactVersion: artifactByType.get("candidate_submission").created_at, contentSnapshot: artifactByType.get("candidate_submission").content, requiredSources: ["candidate", "job", "transcript"], operation: "review_submission" }, approval_state: "proposed",
    }),
    putAction(client, record.id, {
      action_type: "gmail_draft", idempotency_key: `${record.id}:gmail-draft:${artifactByType.get("presentation_email").id}`,
      manifest: { caseId: record.id, artifactId: artifactByType.get("presentation_email").id, artifactVersion: artifactByType.get("presentation_email").created_at, contentSnapshot: artifactByType.get("presentation_email").content, requiredSources: ["candidate", "job", "transcript"], operation: "create_draft_only" }, approval_state: "proposed",
    }),
    putAction(client, record.id, {
      action_type: "loxo_queue", idempotency_key: `${record.id}:loxo-queue:${artifactByType.get("loxo_update").id}`,
      manifest: { caseId: record.id, artifactId: artifactByType.get("loxo_update").id, artifactVersion: artifactByType.get("loxo_update").created_at, contentSnapshot: artifactByType.get("loxo_update").content, requiredSources: ["candidate", "job", "transcript"], operation: "manual_loxo_entry", execution: "user_reported" }, approval_state: "proposed",
    }),
  ]);
  return loadOperatorCase(record.id, { client });
}

export async function openDailyCaseFromReviewAction(actionId, { client = supabase } = {}) {
  const id = Number(actionId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Choose a valid Home review action.");
  const action = await checked(client.from("candidate_review_actions")
    .select("id,job_id,candidate_source,candidate_source_id,action_type,activity_type,note,status,created_at")
    .eq("id", id).single(), "The Home review action could not be loaded.");
  if (!["waiting_for_loxo", "completed"].includes(action.status)) throw new Error("This review action is no longer in the active queue.");
  const refs = buildDailyCaseReferences(action);
  const [candidate, job] = await Promise.all([
    checked(client.from("candidates_all").select("id,candidate_name").eq("id", refs.sources[0].source_id).maybeSingle(), "The linked candidate could not be verified."),
    checked(client.from("tracker_jobs").select("job_id,job_title,company").eq("job_id", action.job_id).maybeSingle(), "The linked job could not be verified."),
  ]);
  if (!candidate || !job) throw new Error("The original review action no longer has a live candidate and job. It was not added to an approval case.");

  let record = await checked(client.from("operator_cases").select("*").eq("case_key", refs.caseKey).maybeSingle(), "The daily case could not be checked.");
  if (!record) {
    if (action.status === "completed") throw new Error("This queue action is already marked complete and has no saved daily case history.");
    const title = `${candidate.candidate_name || refs.sources[0].source_id} — ${job.job_title || `Job ${action.job_id}`}`;
    const created = await client.from("operator_cases").insert({ case_key: refs.caseKey, case_type: "daily", title, status: "ready_for_review" }).select("*").single();
    if (created.error?.code === "23505") {
      record = await checked(client.from("operator_cases").select("*").eq("case_key", refs.caseKey).maybeSingle(), "The daily case could not be checked after a concurrent create.");
    } else if (created.error) {
      throw new Error("The daily case could not be created.");
    } else record = created.data;
  }
  if (!record || record.case_type !== "daily") throw new Error("The saved case does not match this Home review action.");

  for (const source of refs.sources) {
    const existing = await checked(client.from("case_sources").select("id,evidence_status")
      .eq("case_id", record.id).eq("source_type", source.source_type)
      .eq("source_system", source.source_system).eq("source_id", source.source_id).maybeSingle(), "Daily case evidence could not be checked.");
    if (!existing) await checked(client.from("case_sources").insert({ ...source, case_id: record.id }).select("id").single(), "Daily case evidence could not be saved.");
    else if (existing.evidence_status !== "confirmed") throw new Error("The saved Home evidence needs review before it can be used.");
  }

  const artifactRef = `candidate_review_actions:${id}`;
  let artifact = await checked(client.from("case_artifacts").select("*").eq("case_id", record.id)
    .eq("artifact_type", "loxo_update").eq("source_ref", artifactRef).maybeSingle(), "The saved Home review artifact could not be checked.");
  if (!artifact) {
    artifact = await checked(client.from("case_artifacts").insert({
      case_id: record.id, artifact_type: "loxo_update", source_ref: artifactRef, generated_by: "human",
      content: { source: "candidate_review_actions", actionId: id, actionType: action.action_type, activityType: action.activity_type, note: action.note || "" },
      review_state: "draft",
    }).select("*").single(), "The Home review artifact could not be saved.");
  }
  const actionKey = `${record.id}:manual-loxo:${artifact.id}`;
  const savedAction = await checked(client.from("case_actions").select("*").eq("idempotency_key", actionKey).maybeSingle(), "The Home review action could not be checked.");
  if (!savedAction) await checked(client.from("case_actions").insert({
    case_id: record.id, action_type: "loxo_queue", idempotency_key: actionKey, approval_state: "proposed",
    manifest: { caseId: record.id, artifactId: artifact.id, artifactVersion: artifact.created_at, contentSnapshot: artifact.content,
      requiredSources: ["candidate", "job", "draft"], operation: "manual_loxo_entry", execution: "user_reported" },
  }).select("id").single(), "The manual Loxo action could not be saved.");
  return loadOperatorCase(record.id, { client });
}

export async function markDailyReviewActionReported(caseActionId, { client = supabase } = {}) {
  return checked(client.rpc("complete_daily_review_action", { p_case_action_id: caseActionId }),
    "The Home action could not be recorded as user-reported in one transaction.");
}

export async function reviewCaseArtifact(artifactId, reviewState, { client = supabase } = {}) {
  if (!["approved", "rejected"].includes(reviewState)) throw new Error("Choose approve or reject.");
  return checked(
    client.from("case_artifacts").update({ review_state: reviewState, reviewed_at: new Date().toISOString() }).eq("id", artifactId).select("*").single(),
    "The review decision could not be saved.",
  );
}

export async function updateCaseArtifact(artifactId, content, { client = supabase, expectedUpdatedAt } = {}) {
  const prior = await checked(client.from("case_artifacts").select("*").eq("id", artifactId).single(), "The draft version could not be checked.");
  if (!expectedUpdatedAt || prior.updated_at !== expectedUpdatedAt) throw new Error("This draft changed since you opened it. Reload the case before editing.");
  const latest = await checked(client.from("case_artifacts").select("id").eq("case_id", prior.case_id)
    .eq("artifact_type", prior.artifact_type).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  "The latest draft version could not be checked.");
  if (!latest || latest.id !== prior.id) throw new Error("This artifact version is stale. Reload the case before editing.");
  let nextContent = { ...content };
  if (prior.artifact_type === "branded_resume" && prior.content?.text !== nextContent.text) {
    nextContent = { ...nextContent, pdf: null, exportStatus: "not_rendered", exportMessage: "Edited text has not been rendered as a new PDF." };
  }
  const textAtPaths = (value, prefix = "", result = {}) => {
    if (typeof value === "string") result[prefix || "$"] = value;
    else if (Array.isArray(value)) value.forEach((item, index) => textAtPaths(item, `${prefix}[${index}]`, result));
    else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) textAtPaths(item, prefix ? `${prefix}.${key}` : key, result);
    }
    return result;
  };
  const before = textAtPaths(prior.content || {});
  const after = textAtPaths(nextContent);
  const humanEditedPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path]);
  nextContent.editReview = {
    reviewNeeded: true,
    humanEditedPaths,
    note: "Human-edited wording needs fresh recruiter source review. Preserved quotes are reference material and do not verify revised wording.",
  };
  return appendCaseArtifactRevision(prior.id, expectedUpdatedAt, nextContent, { client });
}

export async function reviewCaseAction(actionId, approvalState, { client = supabase } = {}) {
  if (!["approved", "rejected"].includes(approvalState)) throw new Error("Choose approve or reject.");
  return checked(
    client.from("case_actions").update({ approval_state: approvalState }).eq("id", actionId).select("*").single(),
    "The exact action decision could not be saved.",
  );
}

export async function markLoxoEntryReported(actionId, { client = supabase } = {}) {
  const current = await checked(
    client.from("case_actions").select("id,action_type,approval_state,manifest").eq("id", actionId).single(),
    "The Loxo update could not be checked.",
  );
  if (current.action_type !== "loxo_queue" || current.manifest?.operation !== "manual_loxo_entry" || current.manifest?.execution !== "user_reported") {
    throw new Error("This action is not a manual Loxo update.");
  }
  if (!(["approved", "queued"].includes(current.approval_state))) throw new Error("Approve the exact Loxo update before recording it as entered.");
  return checked(
    client.from("case_actions").update({ approval_state: "completed" }).eq("id", actionId).in("approval_state", ["approved", "queued"]).select("*").single(),
    "Your Loxo update could not be recorded. Retry and check its status.",
  );
}
