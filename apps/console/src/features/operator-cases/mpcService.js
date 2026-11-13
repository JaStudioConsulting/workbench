import { supabase } from "../../supabase-client.js";
import { buildMpcCaseReferences, buildMpcReview, buildMpcBlindExport, canonicalMpcSourceUrl } from "./mpcDomain.js";
import { appendCaseArtifactRevision, saveCaseArtifactVersion } from "./operatorCaseService.js";

async function checked(query, message) {
  const { data, error } = await query;
  if (error) throw new Error(message);
  return data;
}

function sourceItems(review) {
  const items = [];
  if (review.positioning.headline || review.positioning.summary) items.push({ type: "resume", kind: "positioning_summary", index: 0, row: review.positioning });
  review.positioning.strengths.forEach((row, index) => items.push({ type: "resume", kind: "positioning", index, row }));
  review.targets.forEach((row, index) => items.push({ type: "client", kind: "target", index, row }));
  review.contacts.forEach((row, index) => items.push({ type: "communication", kind: "contact", index, row }));
  review.signals.forEach((row, index) => items.push({ type: "client", kind: "signal", index, row }));
  for (const [index, [field, row]] of Object.entries(Object.entries(review.approvedFields))) {
    if (row.value) items.push({ type: "resume", kind: `profile_field:${field}`, index: Number(index), row: { ...row, text: row.value } });
  }
  return items;
}

async function ensureMpcSource(client, caseId, source) {
  const existing = await checked(client.from("case_sources").select("id,evidence_status,metadata,observed_at,label")
    .eq("case_id", caseId).eq("source_type", source.source_type)
    .eq("source_system", source.source_system).eq("source_id", source.source_id).maybeSingle(),
  "MPC source evidence could not be checked.");
  if (!existing) return checked(client.from("case_sources").insert({ ...source, case_id: caseId }).select("id").single(), "MPC source evidence could not be saved.");
  const sameEvidence = existing.evidence_status === source.evidence_status
    && existing.observed_at === source.observed_at
    && existing.label === source.label
    && JSON.stringify(existing.metadata || {}) === JSON.stringify(source.metadata || {});
  if (sameEvidence) return existing;
  return checked(client.from("case_sources").update(source).eq("id", existing.id).select("id").single(), "MPC source evidence could not be updated for review.");
}

function evidenceSourceId(kind, index) {
  return `${kind}:row:${index + 1}`;
}

async function saveMpcDraftVersion(client, caseId, artifactType, content, { expectedArtifact } = {}) {
  const latest = await checked(client.from("case_artifacts").select("*").eq("case_id", caseId)
    .eq("artifact_type", artifactType).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  "The prior MPC draft version could not be checked.");
  if (expectedArtifact !== undefined && ((expectedArtifact?.id || null) !== (latest?.id || null)
    || (expectedArtifact && expectedArtifact.updatedAt !== latest?.updated_at))) {
    throw new Error("This MPC review changed since you opened it. Reload the saved case before saving.");
  }
  if (latest && JSON.stringify(latest.content) === JSON.stringify(content)) return latest;
  if (latest) return appendCaseArtifactRevision(latest.id, latest.updated_at, content, { client });
  const sourceRef = `mpc:${artifactType}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
  return saveCaseArtifactVersion({ caseId, artifactType, sourceRef, content, generatedBy: "human" }, { client });
}

export async function loadMpcCaseForCandidate(candidateId, { client = supabase } = {}) {
  const refs = buildMpcCaseReferences(candidateId);
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data?.user?.id) throw new Error("Sign in with an authorized Workbench account to open MPC history.");
  const liveCandidate = await checked(client.from("candidates_all").select("id,candidate_name,current_title,current_company")
    .eq("id", refs.candidateId).maybeSingle(), "The selected candidate could not be checked.");
  if (!liveCandidate) throw new Error("The selected candidate is not available in the current Tracker data.");
  const record = await checked(client.from("operator_cases").select("*").eq("case_key", refs.caseKey).maybeSingle(), "The MPC case could not be checked.");
  if (!record) return null;
  if (record.case_type !== "mpc") throw new Error("The saved case does not match the selected candidate marketing workflow.");
  const [sources, artifacts, actions] = await Promise.all([
    checked(client.from("case_sources").select("*").eq("case_id", record.id).order("created_at"), "MPC evidence could not be reloaded."),
    checked(client.from("case_artifacts").select("*").eq("case_id", record.id).order("created_at"), "MPC artifacts could not be reloaded."),
    checked(client.from("case_actions").select("*").eq("case_id", record.id).order("created_at"), "MPC action history could not be reloaded."),
  ]);
  const latestArtifacts = {};
  for (const artifact of artifacts || []) {
    const prior = latestArtifacts[artifact.artifact_type];
    if (!prior || Date.parse(artifact.created_at) >= Date.parse(prior.created_at)) latestArtifacts[artifact.artifact_type] = artifact;
  }
  const positioning = latestArtifacts.candidate_positioning?.content || {};
  const formData = {
    positioning: {
      headline: String(positioning.headline || ""), summary: String(positioning.summary || ""),
      sourceUrl: positioning.sourceUrl || "", observedAt: positioning.observedAt || "",
      strengths: Array.isArray(positioning.strengths) ? positioning.strengths : [],
      caveats: Array.isArray(positioning.caveats) ? positioning.caveats : [],
    },
    targets: Array.isArray(latestArtifacts.target_companies?.content?.items) ? latestArtifacts.target_companies.content.items : [],
    contacts: Array.isArray(latestArtifacts.contacts?.content?.items) ? latestArtifacts.contacts.content.items : [],
    signals: Array.isArray(latestArtifacts.hiring_signals?.content?.items)
      ? latestArtifacts.hiring_signals.content.items
      : Array.isArray(latestArtifacts.hiring_signals?.content) ? latestArtifacts.hiring_signals.content : [],
    outreachDraft: latestArtifacts.outreach_draft?.content || { subject: "", body: "" },
  };
  return {
    record, sources: sources || [], artifacts: artifacts || [], actions: actions || [], latestArtifacts,
    expectedArtifactVersions: Object.fromEntries(Object.entries(latestArtifacts).map(([type, artifact]) => [type, { id: artifact.id, updatedAt: artifact.updated_at }])),
    formData,
    candidate: {
      id: liveCandidate.id, candidate_name: liveCandidate.candidate_name,
      current_title: liveCandidate.current_title || "", current_company: liveCandidate.current_company || "",
    },
  };
}

export async function openMpcCase({ candidateId, candidate = {}, positioning = {}, targets = [], contacts = [], signals = [], outreachDraft = {}, approvedFields = {}, approvedFieldEvidence = {}, expectedArtifactVersions } = {}, { client = supabase, now = new Date() } = {}) {
  if (candidateId && candidate.id && String(candidateId) !== String(candidate.id)) {
    throw new Error("The selected candidate ID does not match the candidate details. Reopen the saved Tracker record and try again.");
  }
  const refs = buildMpcCaseReferences(candidateId || candidate.id);
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data?.user?.id) throw new Error("Sign in with an authorized Workbench account before saving MPC research.");
  const ownerId = auth.data.user.id;
  const liveCandidate = await checked(client.from("candidates_all").select("id,candidate_name,current_title,current_company")
    .eq("id", refs.candidateId).maybeSingle(), "The selected candidate could not be checked.");
  if (!liveCandidate) throw new Error("The selected candidate is not available in the current Tracker data.");

  const canonicalCandidate = {
    id: liveCandidate.id,
    candidate_name: liveCandidate.candidate_name,
    current_title: liveCandidate.current_title || "",
    current_company: liveCandidate.current_company || "",
    employers: liveCandidate.current_company ? [liveCandidate.current_company] : [],
  };
  const review = buildMpcReview({ positioning, targets, contacts, signals, outreachDraft, approvedFields, approvedFieldEvidence }, { now });
  let record = await checked(client.from("operator_cases").select("*").eq("case_key", refs.caseKey).maybeSingle(), "The MPC case could not be checked.");
  if (!record) {
    const title = `${liveCandidate.candidate_name || refs.candidateId} — Candidate marketing`;
    const created = await client.from("operator_cases").insert({ case_key: refs.caseKey, case_type: "mpc", title, status: review.gaps.length ? "blocked" : "open" }).select("*").single();
    if (created.error?.code === "23505") record = await checked(client.from("operator_cases").select("*").eq("case_key", refs.caseKey).maybeSingle(), "The MPC case could not be checked after concurrent creation.");
    else if (created.error) throw new Error("The MPC case could not be created.");
    else record = created.data;
  }
  if (!record || record.case_type !== "mpc") throw new Error("The saved case does not match the selected candidate marketing workflow.");

  await ensureMpcSource(client, record.id, { ...refs.source, case_id: record.id });
  for (const item of sourceItems(review)) {
    const row = item.row;
    const url = canonicalMpcSourceUrl(row.sourceUrl);
    const sourceId = evidenceSourceId(item.kind, item.index);
    const evidenceStatus = row.evidenceStatus || "missing";
    await ensureMpcSource(client, record.id, {
      source_type: item.type, source_system: "human_review", source_id: sourceId,
      label: String(row.text || row.value || row.companyName || row.name || row.signal || `${item.kind} evidence ${item.index + 1}`).slice(0, 300),
      evidence_status: evidenceStatus, required: true,
      observed_at: row.observedAt || null,
      metadata: { reviewedBy: ownerId, sourceUrl: url || null, evidenceReason: row.evidenceReason || "Source details were not provided." },
    });
  }

  const artifacts = [
    ["candidate_positioning", review.positioning],
    ["target_companies", { items: review.targets, dedupe: review.dedupe.targets }],
    ["contacts", { items: review.contacts, dedupe: review.dedupe.contacts }],
    ["hiring_signals", { items: review.signals }],
    ["outreach_draft", review.outreachDraft],
  ];
  for (const [type, content] of artifacts) {
    // Every explicit save snapshots every editable section. Empty sections are
    // tombstone versions, so removing content cannot leave an older approval live.
    const expectedArtifact = expectedArtifactVersions === undefined ? undefined : expectedArtifactVersions[type] || null;
    await saveMpcDraftVersion(client, record.id, type, content, { expectedArtifact });
  }
  await checked(client.from("operator_cases").update({ status: review.gaps.length ? "blocked" : "open" }).eq("id", record.id).select("id").single(), "MPC case status could not be refreshed.");
  const saved = await Promise.all([
    checked(client.from("operator_cases").select("*").eq("id", record.id).single(), "The MPC case could not be reloaded."),
    checked(client.from("case_sources").select("*").eq("case_id", record.id).order("created_at"), "MPC evidence could not be reloaded."),
    checked(client.from("case_artifacts").select("*").eq("case_id", record.id).order("created_at"), "MPC artifacts could not be reloaded."),
    checked(client.from("case_actions").select("*").eq("case_id", record.id).order("created_at"), "MPC action history could not be reloaded."),
  ]);
  return {
    record: saved[0], sources: saved[1] || [], artifacts: saved[2] || [], actions: saved[3] || [],
    review, blindExport: buildMpcBlindExport({ candidate: canonicalCandidate, positioning: review.positioning, approvedFields: review.approvedFields,
      targets: review.targets, contacts: review.contacts, signals: review.signals, evidence: review.evidence }),
  };
}

export async function updateMpcArtifact(artifactId, content, { client = supabase, expectedUpdatedAt } = {}) {
  const prior = await checked(client.from("case_artifacts").select("id,case_id,artifact_type,updated_at")
    .eq("id", artifactId).single(), "The MPC artifact could not be checked.");
  if (!expectedUpdatedAt || prior.updated_at !== expectedUpdatedAt) throw new Error("This MPC draft changed since you opened it. Reload the case before editing.");
  if (!["candidate_positioning", "target_companies", "contacts", "hiring_signals", "outreach_draft"].includes(prior.artifact_type)) {
    throw new Error("This artifact is not part of the MPC workflow.");
  }
  const latest = await checked(client.from("case_artifacts").select("id").eq("case_id", prior.case_id)
    .eq("artifact_type", prior.artifact_type).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  "The latest MPC draft could not be checked.");
  if (!latest || latest.id !== prior.id) throw new Error("This MPC artifact is stale. Reload the case before editing.");
  return saveMpcDraftVersion(client, prior.case_id, prior.artifact_type, content, { expectedArtifact: { id: prior.id, updatedAt: expectedUpdatedAt } });
}
