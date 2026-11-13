import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { request as httpRequest } from "node:http";
import { registerBrandedResumeEditRoutes } from "../src/branded-resume-edit-routes.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const artifactId = "33333333-3333-4333-8333-333333333333";
const revisedArtifactId = "44444444-4444-4444-8444-444444444444";
const updatedAt = "2026-11-13T12:00:00.000Z";
const evidence = { source: "resume", quote: "Led plant maintenance programs." };

const sections = {
  name: { value: "Avery Sample", evidence: [{ source: "resume", quote: "Avery Sample" }] },
  title: { value: "Maintenance Supervisor", evidence: [{ source: "resume", quote: "Maintenance Supervisor" }] },
  summary: [{ text: "Experienced plant leader", evidence: [evidence] }],
  skills: [
    { text: "Maintenance planning", evidence: [evidence] },
    { text: "Preventive programs", evidence: [evidence] },
  ],
  experience: [],
  education: [],
  certifications: [],
  additionalInformation: [],
};

const originalSections = structuredClone(sections);
originalSections.summary[0].text = "Plant maintenance leader";

function makeApp({ rpcStatus = 201, rpcBody } = {}) {
  const app = express();
  app.use(express.json());
  const calls = [];
  const caseRow = { id: caseId, owner_id: ownerId, case_type: "after_call", case_key: "after_call:sourcing:7:9" };
  const artifact = {
    id: artifactId, case_id: caseId, owner_id: ownerId, artifact_type: "branded_resume",
    updated_at: updatedAt, review_state: "approved",
    content: {
      text: "Original resume text", sections: originalSections,
      audit: { supportedClaims: [{ text: evidence.quote, evidence: [evidence] }] },
      pdf: { fileName: "original.pdf" },
    },
  };
  const renderer = async (resume) => {
    calls.push({ kind: "render", resume });
    return { fileName: "Avery Sample - Top Tier Talent Group - DRAFT.pdf", mimeType: "application/pdf", sizeBytes: 512, base64: Buffer.from("%PDF-synthetic").toString("base64"), reviewLabel: "Draft for recruiter review" };
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ kind: "fetch", url, options });
    if (String(url).includes("/operator_cases?")) return { ok: true, json: async () => [caseRow] };
    if (String(url).includes("/candidates_all?")) return { ok: true, json: async () => [{ id: "sourcing:7", candidate_name: "Avery Sample" }] };
    if (String(url).includes("/case_artifacts?")) return { ok: true, json: async () => [artifact] };
    if (String(url).endsWith("/rpc/save_operator_artifact_revision")) {
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ["artifact_id", "content", "expected_updated_at"]);
      assert.equal(body.artifact_id, artifactId);
      assert.equal(body.expected_updated_at, updatedAt);
      assert.equal(body.content.generated_by, undefined);
      assert.equal(options.headers.Authorization, "Bearer user-access-token");
      if (rpcStatus >= 400) return { ok: false, status: rpcStatus, json: async () => rpcBody || { message: "STALE_ARTIFACT" } };
      return { ok: true, status: 200, json: async () => ({
        id: revisedArtifactId, owner_id: ownerId, case_id: caseId, artifact_type: "branded_resume",
        generated_by: "human", review_state: "draft", content: body.content,
      }) };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const access = (req, res, next) => {
    req.supabaseRecruiter = { ownerId, accessToken: "user-access-token" };
    next();
  };
  registerBrandedResumeEditRoutes(app, {
    access,
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" },
    fetchImpl,
    renderer,
  });
  return { app, calls, artifact };
}

async function request(app, body) {
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    return await new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = httpRequest({ port: server.address().port, path: `/api/operator-cases/${caseId}/branded-resume/versions`, method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      });
      req.on("error", reject);
      req.end(payload);
    });
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("resume edits preserve saved citations, regenerate PDF, and append a human draft from an approved version", async () => {
  const { app, calls } = makeApp();
  const updatedSections = structuredClone(originalSections);
  updatedSections.summary[0].text = "Experienced maintenance leader";
  const result = await request(app, { artifactId, expectedUpdatedAt: updatedAt, sections: updatedSections });
  assert.equal(result.status, 201);
  assert.equal(result.body.artifact.id, revisedArtifactId);
  assert.equal(result.body.artifact.generated_by, "human");
  assert.equal(result.body.artifact.review_state, "draft");
  assert.equal(result.body.artifact.content.text.includes("Experienced maintenance leader"), true);
  assert.deepEqual(result.body.artifact.content.sections, updatedSections);
  assert.equal(result.body.artifact.content.pdf.mimeType, "application/pdf");
  assert.deepEqual(result.body.artifact.content.audit.supportedClaims[0].evidence, [evidence]);
  assert.deepEqual(result.body.artifact.content.editReview.humanEditedPaths, ["resume.summary[0]"]);
  assert.match(result.body.artifact.content.editReview.note, /do not verify revised wording/i);
  assert.equal(calls.filter((call) => call.kind === "render").length, 1);
  assert.equal(calls.some((call) => call.kind === "fetch" && String(call.url).includes("/rpc/save_operator_artifact_revision")), true);
});

test("resume edits reject new or job-description evidence and preserve current version on stale write", async (t) => {
  await t.test("new citation is rejected before render or write", async () => {
    const { app, calls } = makeApp();
    const modified = structuredClone(originalSections);
    modified.summary[0].evidence = [{ source: "resume", quote: "A quote not in saved audit" }];
    const result = await request(app, { artifactId, expectedUpdatedAt: updatedAt, sections: modified });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "INVALID_EVIDENCE");
    assert.equal(calls.some((call) => call.kind === "render"), false);
  });
  await t.test("job description citation is rejected", async () => {
    const { app } = makeApp();
    const modified = structuredClone(originalSections);
    modified.summary[0].evidence = [{ source: "job_description", quote: "Led plant maintenance programs." }];
    const result = await request(app, { artifactId, expectedUpdatedAt: updatedAt, sections: modified });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "INVALID_EVIDENCE");
  });
  await t.test("RPC rejects a stale revision after render", async () => {
    const { app, calls } = makeApp({ rpcStatus: 409, rpcBody: { message: "STALE_ARTIFACT" } });
    const result = await request(app, { artifactId, expectedUpdatedAt: updatedAt, sections: originalSections });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "STALE_ARTIFACT");
    assert.equal(calls.filter((call) => call.kind === "render").length, 1);
  });
});

test("resume edit preserves the candidate identity gate when the edited name differs", async () => {
  const { app } = makeApp();
  const modified = structuredClone(originalSections);
  modified.name.value = "Another Candidate";
  const result = await request(app, { artifactId, expectedUpdatedAt: updatedAt, sections: modified });
  assert.equal(result.status, 201);
  assert.equal(result.body.artifact.content.audit.identityReviewRequired, true);
  assert.equal(result.body.artifact.content.audit.finalizationBlocked, true);
  assert.equal(result.body.artifact.content.editReview.identityReviewRequired, true);
});
