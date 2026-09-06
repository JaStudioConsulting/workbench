import test from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_SF_JOBS_HIERARCHY,
  INITIAL_RECRUITING_STATE,
  NEEDS_VERIFICATION,
  advanceRecruitingStage,
  approveAction,
  createBlankCandidateIntake,
  generateJobSpecificMessages,
  generateRecruitingDrafts,
  requestApproval,
} from "../src/features/recruiting/domain.js";

const job = DEMO_SF_JOBS_HIERARCHY[0].jobs[0];
const input = { ...createBlankCandidateIntake(), name: "Alex Example", title: "Accountant", resumeText: "Resume header. Toronto. Two years of accounting experience.", jobDescription: "Staff accounting role.", verifiedFacts: [{ label: "location", value: "Toronto", source: "resume", evidence: "Resume header" }] };

test("models immutable demo parent-child hierarchy with Loxo relation", () => {
  assert.equal(DEMO_SF_JOBS_HIERARCHY[0].demoOnly, true);
  assert.equal(DEMO_SF_JOBS_HIERARCHY[0].jobs[0].loxoJobId, "DEMO-LOXO-JOB-001");
  assert.throws(() => { DEMO_SF_JOBS_HIERARCHY[0].jobs.push(job); }, TypeError);
});

test("generates job-specific drafts without inventing unknown facts", () => {
  const output = generateRecruitingDrafts(input, job);
  assert.match(output.presentationEmail.body, /DEMO STAFF ACCOUNTANT/);
  assert.match(output.presentationEmail.body, /DEMO-LOXO-JOB-001/);
  assert.match(output.submission.fields.profileSummary.join("\n"), new RegExp(NEEDS_VERIFICATION));
  assert.equal(output.submission.fields.reasonForLeaving, NEEDS_VERIFICATION);
  assert.equal(output.submission.fields.currentCompensation, NEEDS_VERIFICATION);
  assert.equal(output.submission.fields.location, "Toronto");
  assert.equal(output.reviewRequired, true);
  assert.equal(output.brandedResume.status, "draft");
});

test("rejection and campaign copy interpolate the selected child job", () => {
  const messages = generateJobSpecificMessages(input, job);
  assert.match(messages.rejection, /Thank you for your time and interest/);
  assert.match(messages.campaignStep, /Role details: NEEDS VERIFICATION/);
});

test("stage guards prevent approvals before verified", () => {
  assert.throws(() => requestApproval(INITIAL_RECRUITING_STATE, "gmail"), /verified draft/);
  const verified = { ...INITIAL_RECRUITING_STATE, stage: "verified" };
  const pending = requestApproval(verified, "gmail");
  const approved = approveAction(pending, "gmail");
  assert.equal(approved.approvals.gmail, "approved");
  assert.throws(() => approveAction(approved, "gmail"), /pending/);
});

test("fabricated verified facts are downgraded to NEEDS VERIFICATION", () => {
  const fabricated = { ...input, verifiedFacts: [{ label: "location", value: "Vancouver", source: "resume", evidence: "Resume header" }] };
  const output = generateRecruitingDrafts(fabricated, job);
  assert.equal(output.submission.fields.location, NEEDS_VERIFICATION);
  assert.deepEqual(output.audit.supportedClaims, []);
});

test("approveAction rejects a manually constructed pending action before verified", () => {
  const manuallyPending = { ...INITIAL_RECRUITING_STATE, approvals: { ...INITIAL_RECRUITING_STATE.approvals, tracker: "pending" } };
  assert.throws(() => approveAction(manuallyPending, "tracker"), /verified draft/);
});

test("approval states never become external execution states", () => {
  const verified = { ...INITIAL_RECRUITING_STATE, stage: "verified" };
  const state = approveAction(requestApproval(verified, "tracker"), "tracker");
  assert.deepEqual(Object.values(state.approvals), ["approved", "not_requested", "not_requested"]);
  assert.equal(state.stage, "verified");
  assert.throws(() => advanceRecruitingStage(state, "intake"), /Invalid recruiting stage/);
});
