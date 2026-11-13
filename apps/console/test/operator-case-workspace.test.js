import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { blockingEvidence, buildAfterCallCaseReferences, buildDailyCaseReferences, saveAfterCallCase } from "../src/features/operator-cases/operatorCaseService.js";

test("only required missing, conflicting, or stale evidence blocks approval", () => {
  const blocked = blockingEvidence([
    { required: true, evidence_status: "missing", label: "Transcript unavailable" },
    { required: true, evidence_status: "conflicting", label: "Compensation conflict" },
    { required: false, evidence_status: "missing", label: "Optional notes" },
    { required: true, evidence_status: "confirmed", label: "Candidate" },
  ]);
  assert.deepEqual(blocked.map((item) => item.label), ["Transcript unavailable", "Compensation conflict"]);
});

test("after-call cases reject malformed candidate source IDs before database access", async () => {
  await assert.rejects(
    saveAfterCallCase({
      job: { id: "42", title: "Maintenance Manager" },
      candidate: { id: "sourcing:7:unexpected", name: "Candidate Example" },
      transcript: "Call transcript",
    }, { client: { from() { throw new Error("database must not be queried"); } } }),
    /real candidate and job/i,
  );
});

test("case workspace exposes review controls but no execution control", async () => {
  const source = await readFile(new URL("../src/features/operator-cases/OperatorCaseWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /Source evidence/);
  assert.match(source, /Current outputs/);
  assert.match(source, /Actions for review/);
  assert.match(source, /Approve output/);
  assert.match(source, /Approve this plan/);
  assert.match(source, /Approval records your decision; Workbench does not send or write it/);
  assert.match(source, /I applied these in Loxo/);
  assert.match(source, /markLoxoEntryReported/);
  assert.match(source, /markDailyReviewActionReported/);
  assert.match(source, /Ready for manual entry/);
  assert.match(source, /identityReviewRequired/);
  assert.match(source, /Download resume PDF/);
  assert.match(source, /updateMpcArtifact/);
  assert.match(source, /if \(state\.data\.record\.case_type === "mpc"\) return updateMpcArtifact/);
  assert.match(source, /Earlier saved versions/);
  assert.match(source, /Edit output/);
  assert.match(source, /renderBrandedResumeVersion\(state\.data\.record\.id/);
  assert.match(source, /Retained quotes are reference material only/);
  assert.match(source, /Current version \{versionNumber\}/);
  assert.match(source, /!artifactVersions\.currentIds\.has\(action\.manifest\?\.artifactId\)/);
  assert.match(source, /planStale \? <p/);
  assert.doesNotMatch(source, /valid JSON/);
  assert.doesNotMatch(source, /JSON\.stringify\(action\.manifest,\s*null,\s*2\)/);
  assert.doesNotMatch(source, /manifest approved/);
  assert.doesNotMatch(source, />Send</);
  assert.doesNotMatch(source, /Write to Loxo/);
});

test("after-call case references use stable candidate and normalized job IDs", () => {
  const references = buildAfterCallCaseReferences({
    candidateId: "sourcing:7",
    jobId: "0042",
    meetingId: "meeting-1",
    candidateExists: true,
    jobExists: true,
    hasTranscript: true,
  });
  assert.equal(references.caseKey, "after_call:sourcing:7:42");
  assert.deepEqual(references.sources.slice(0, 2).map(({ source_type, source_system, source_id, required, evidence_status }) => ({ source_type, source_system, source_id, required, evidence_status })), [
    { source_type: "candidate", source_system: "supabase_tracker", source_id: "sourcing:7", required: true, evidence_status: "confirmed" },
    { source_type: "job", source_system: "supabase_tracker", source_id: "42", required: true, evidence_status: "confirmed" },
  ]);
});

test("missing transcript blocks output approval while remaining an optional drafting input", () => {
  const references = buildAfterCallCaseReferences({ candidateId: "sourcing:7", jobId: 42 });
  const transcript = references.sources.find((source) => source.source_type === "transcript");
  assert.equal(transcript.evidence_status, "missing");
  assert.equal(transcript.required, true);
  assert.deepEqual(blockingEvidence(references.sources).map((source) => source.source_type), ["candidate", "job", "transcript"]);
});

test("daily Home case references are tied to the exact queued action ID", () => {
  const references = buildDailyCaseReferences({ id: 501, job_id: 42, candidate_source: "sourcing", candidate_source_id: 7, created_at: "2026-11-13T15:00:00.000Z" });
  assert.equal(references.caseKey, "daily:candidate_review_actions:501");
  assert.deepEqual(references.sources.map(({ source_type, source_system, source_id, required }) => ({ source_type, source_system, source_id, required })), [
    { source_type: "candidate", source_system: "supabase_tracker", source_id: "sourcing:7", required: true },
    { source_type: "job", source_system: "supabase_tracker", source_id: "42", required: true },
    { source_type: "draft", source_system: "candidate_review_actions", source_id: "501", required: true },
  ]);
});

test("case service keeps Sheets data outside cases", async () => {
  const source = await readFile(new URL("../src/features/operator-cases/operatorCaseService.js", import.meta.url), "utf8");
  assert.match(source, /buildAfterCallCaseReferences/);
  assert.match(source, /source_system: "supabase_tracker"/);
  assert.doesNotMatch(source, /merge.*name/i);
  assert.match(source, /create_draft_only/);
  assert.match(source, /operation: "manual_loxo_entry", execution: "user_reported"/);
  assert.match(source, /workflow\.brandedResume\?\.pdf/);
  assert.match(source, /workflow\.audit/);
  assert.match(source, /required: false/);
});
