import { WorkflowResumeSchema, errorEnvelope } from "@ja/shared-types";
import { resolveCandidateSupabaseConfig } from "./candidate-routes.js";
import { renderResume } from "./after-call.js";
import { renderBrandedResume } from "./branded-resume-renderer.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function respond(res, code, message, status) {
  res.set("Cache-Control", "private, no-store");
  return res.status(status).json(errorEnvelope(code, message));
}

function textAtPaths(value, path = "resume", result = {}) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    value.forEach((item, index) => textAtPaths(item, `${path}[${index}]`, result));
    return result;
  }
  if (Array.isArray(value.evidence) && (Object.hasOwn(value, "text") || Object.hasOwn(value, "value"))) {
    result[path] = String(Object.hasOwn(value, "text") ? value.text : value.value ?? "");
    return result;
  }
  for (const [key, child] of Object.entries(value)) textAtPaths(child, `${path}.${key}`, result);
  return result;
}

function evidenceKey(item) {
  return `${item.source}\u0000${item.quote}`;
}

function normalizeIdentity(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
}

function caseCandidateId(caseKey) {
  const match = /^after_call:(sourcing|submission):([1-9]\d*):[1-9]\d*$/.exec(String(caseKey || ""));
  return match ? `${match[1]}:${match[2]}` : null;
}

function collectResumeEvidence(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectResumeEvidence(item, result);
    return result;
  }
  if (Array.isArray(value.evidence) && (Object.hasOwn(value, "text") || Object.hasOwn(value, "value"))) {
    result.push(...value.evidence);
    return result;
  }
  for (const child of Object.values(value)) collectResumeEvidence(child, result);
  return result;
}

function supportedResumeEvidence(original) {
  const claims = Array.isArray(original?.content?.audit?.supportedClaims)
    ? original.content.audit.supportedClaims
    : [];
  return new Set([
    ...collectResumeEvidence(original?.content?.sections || {}),
    ...claims.flatMap((claim) => Array.isArray(claim?.evidence) ? claim.evidence : []),
  ].filter((item) => item && item.source !== "job_description" && typeof item.quote === "string" && item.quote.trim()).map(evidenceKey));
}

function validateResumeEvidence(sections, allowedEvidence) {
  const evidence = collectResumeEvidence(sections);
  return evidence.every((item) => item.source !== "job_description" && allowedEvidence.has(evidenceKey(item)));
}

function editReview(originalSections, newSections) {
  const before = textAtPaths(originalSections || {});
  const after = textAtPaths(newSections);
  const humanEditedPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path]);
  return {
    reviewNeeded: true,
    humanEditedPaths,
    note: humanEditedPaths.length
      ? "Human-edited wording needs recruiter source review. Preserved quotes are reference material and do not verify revised wording."
      : "New draft version. Review the structured resume and PDF before approval.",
  };
}

async function readJson(response) {
  return response.json().catch(() => null);
}

async function listCaseRows(fetchImpl, config, request, table, filters) {
  const query = new URLSearchParams({ select: "*", ...filters });
  const response = await fetchImpl(`${config.supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${request.supabaseRecruiter.accessToken}`,
      Accept: "application/json",
    },
  });
  const data = await readJson(response);
  if (!response.ok || !Array.isArray(data)) throw new Error("SUPABASE_QUERY_FAILED");
  return data;
}

export function registerBrandedResumeEditRoutes(app, {
  access,
  env = process.env,
  fetchImpl = globalThis.fetch,
  renderer = renderBrandedResume,
} = {}) {
  const config = resolveCandidateSupabaseConfig(env);
  app.post("/api/operator-cases/:caseId/branded-resume/versions", access, async (req, res) => {
    if (!config.enabled) return respond(res, "SUPABASE_UNAVAILABLE", "Supabase is unavailable for resume editing", 503);
    const caseId = String(req.params.caseId || "").toLowerCase();
    const artifactId = String(req.body?.artifactId || "").toLowerCase();
    const expectedUpdatedAt = req.body?.expectedUpdatedAt;
    if (!UUID_RE.test(caseId) || !UUID_RE.test(artifactId)
      || typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt.trim() || expectedUpdatedAt.length > 100) {
      return respond(res, "INVALID_INPUT", "Choose the current resume draft before saving edits", 400);
    }
    const sectionBytes = new TextEncoder().encode(JSON.stringify(req.body?.sections ?? null)).byteLength;
    if (sectionBytes > 1024 * 1024) {
      return respond(res, "PAYLOAD_TOO_LARGE", "Structured resume edits exceed 1 MiB. Shorten the resume sections and try again.", 413);
    }
    const parsedSections = WorkflowResumeSchema.safeParse(req.body?.sections);
    if (!parsedSections.success) return respond(res, "INVALID_INPUT", "The structured resume fields are incomplete or invalid", 400);

    try {
      const ownerId = req.supabaseRecruiter.ownerId;
      const cases = await listCaseRows(fetchImpl, config, req, "operator_cases", { id: `eq.${caseId}`, owner_id: `eq.${ownerId}`, limit: "1" });
      const record = cases[0];
      if (!record || record.case_type !== "after_call") return respond(res, "CASE_NOT_FOUND", "This after-call review is unavailable", 404);
      const selectedCandidateId = caseCandidateId(record.case_key);
      if (!selectedCandidateId) return respond(res, "IDENTITY_SOURCE_UNAVAILABLE", "The saved case has no verifiable candidate identity", 409);
      const candidateRows = await listCaseRows(fetchImpl, config, req, "candidates_all", {
        select: "id,candidate_name", id: `eq.${selectedCandidateId}`, limit: "1",
      });
      const candidate = candidateRows.find((row) => row?.id === selectedCandidateId && typeof row.candidate_name === "string" && row.candidate_name.trim());
      if (!candidate) return respond(res, "IDENTITY_SOURCE_UNAVAILABLE", "The selected candidate could not be rechecked", 409);

      const artifacts = await listCaseRows(fetchImpl, config, req, "case_artifacts", {
        case_id: `eq.${caseId}`, owner_id: `eq.${ownerId}`, artifact_type: "eq.branded_resume",
        order: "created_at.desc", limit: "1",
      });
      const latest = artifacts[0];
      if (!latest || latest.id !== artifactId) return respond(res, "STALE_ARTIFACT", "A newer resume draft exists. Reload it before saving edits.", 409);
      if (latest.updated_at !== expectedUpdatedAt) return respond(res, "STALE_ARTIFACT", "The resume draft changed. Reload it before saving edits.", 409);
      if (latest.owner_id !== ownerId || latest.case_id !== caseId || latest.artifact_type !== "branded_resume") {
        return respond(res, "ARTIFACT_NOT_FOUND", "This resume draft is unavailable", 404);
      }
      if (latest.content?.sections == null || !latest.content?.audit) {
        return respond(res, "STRUCTURED_RESUME_UNAVAILABLE", "This saved resume has no editable structured source record", 409);
      }
      if (!validateResumeEvidence(parsedSections.data, supportedResumeEvidence(latest))) {
        return respond(res, "INVALID_EVIDENCE", "Use only the saved source references when editing resume wording", 400);
      }

      let pdf;
      try { pdf = await renderer(parsedSections.data); }
      catch { return respond(res, "RESUME_RENDER_FAILED", "A new branded PDF could not be rendered. No resume version was saved.", 503); }

      const identityMatches = normalizeIdentity(parsedSections.data.name.value) === normalizeIdentity(candidate.candidate_name);
      const audit = {
        ...latest.content.audit,
        ...(identityMatches ? {} : { identityReviewRequired: true, finalizationBlocked: true }),
      };
      const content = {
        text: renderResume(parsedSections.data),
        sections: parsedSections.data,
        pdf,
        exportStatus: "draft_rendered",
        exportMessage: null,
        audit,
        editReview: {
          ...editReview(latest.content.sections, parsedSections.data),
          ...(!identityMatches ? { identityReviewRequired: true, note: "The resume name does not match the selected candidate record. Resolve identity before approval." } : {}),
        },
      };
      const insertResponse = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/save_operator_artifact_revision`, {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${req.supabaseRecruiter.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          artifact_id: artifactId,
          expected_updated_at: expectedUpdatedAt,
          content,
        }),
      });
      const inserted = await readJson(insertResponse);
      if (!insertResponse.ok) {
        if (/STALE_ARTIFACT/i.test(String(inserted?.message || inserted?.details || ""))) {
          return respond(res, "STALE_ARTIFACT", "The resume draft changed while it was rendering. Reload it before saving edits.", 409);
        }
        return respond(res, "RESUME_SAVE_FAILED", "The rendered resume draft could not be saved", 502);
      }
      res.set("Cache-Control", "private, no-store");
      return res.status(201).json({ artifact: inserted });
    } catch {
      return respond(res, "RESUME_EDIT_UNAVAILABLE", "The resume draft could not be checked or saved", 502);
    }
  });
}
