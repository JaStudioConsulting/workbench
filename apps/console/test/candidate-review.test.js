import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOXO_PIPELINE_STAGES,
  PIPELINE_STAGE_ORDER,
  LOXO_LOGGABLE_ACTIVITIES,
  RESUME_INDICATOR_STATES,
} from "../src/features/candidate-review/constants.js";
import {
  getReviewJobs,
  getJobById,
  getCandidatesForJob,
  getSubmissionHistory,
  getCandidateSessionState,
  recordCandidateDecision,
  recordCandidateSubmission,
  logCandidateActivity,
  makeCompositeKey,
  mapLiveCandidate,
  mapLivePresentation,
  buildCandidateSourceKey,
  extractCandidateSourceKey,
  buildCandidatePresentationSummary,
  enrichCandidateWithPresentations,
  enrichCandidatesWithPresentations,
  loadLiveReviewJobs,
  loadLiveCandidatesForJob,
  loadLivePresentations,
  _setSupabaseClientForTesting,
  _resetStoreForTesting,
} from "../src/features/candidate-review/candidateReviewService.js";
import { SAMPLE_CANDIDATES, SAMPLE_JOBS } from "../src/features/candidate-review/sampleReviewData.js";
import { getWindowedIndices, MAX_VISIBLE_DOTS } from "../src/features/candidate-review/figureUtils.js";
import {
  buildBrandResumePayload,
  buildCandidateWriteUp,
  getOwnershipStatus,
} from "../src/features/candidate-review/brandResume.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const featureDir = path.resolve(here, "../src/features/candidate-review");
const appFile = path.resolve(here, "../src/App.jsx");

test.beforeEach(() => {
  _resetStoreForTesting({ jobs: SAMPLE_JOBS, candidates: SAMPLE_CANDIDATES });
});

test("exact pipeline stages match docs/loxo/true-actions.md in order", () => {
  const expectedStages = [
    "Applied",
    "Longlist",
    "Shortlist",
    "Outbound",
    "Follow Up",
    "Screening",
    "Internal Submission",
    "Submitted",
    "Interview #1",
    "Interview #2+",
    "Offer",
    "Rejected",
    "Hired",
  ];
  assert.deepEqual(LOXO_PIPELINE_STAGES, expectedStages);

  // Hard rule: "Called" is NOT a stage
  assert.equal(LOXO_PIPELINE_STAGES.includes("Called"), false);
  assert.equal(PIPELINE_STAGE_ORDER["Called"], undefined);
});

test("loggable activity types and trigger stages match docs/loxo/true-actions.md", () => {
  const activityNames = LOXO_LOGGABLE_ACTIVITIES.map((a) => a.name);

  // Ja's loggable activities
  assert.ok(activityNames.includes("Phone Call"));
  assert.ok(activityNames.includes("Call - No Answer / Left VoiceMail"));
  assert.ok(activityNames.includes("Internal Submission"));
  assert.ok(activityNames.includes("Submitted"));
  assert.ok(activityNames.includes("1st Client Interview"));
  assert.ok(activityNames.includes("2nd+ Client Interview"));
  assert.ok(activityNames.includes("Sent InMail"));
  assert.ok(activityNames.includes("LinkedIn Connection Request Sent"));
  assert.ok(activityNames.includes("*Note"));

  // Hard rule: "Update" is unresolved in true-actions.md and left out
  assert.equal(activityNames.includes("Update"), false);

  // Stage trigger checks
  const phoneCall = LOXO_LOGGABLE_ACTIVITIES.find((a) => a.name === "Phone Call");
  assert.equal(phoneCall.trigger, "Outbound");

  const interview1 = LOXO_LOGGABLE_ACTIVITIES.find((a) => a.name === "1st Client Interview");
  assert.equal(interview1.trigger, "Interview #1");

  const noteAct = LOXO_LOGGABLE_ACTIVITIES.find((a) => a.name === "*Note");
  assert.equal(noteAct.trigger, "No automatic stage change");
});

test("resume indicator supports three distinct states", () => {
  assert.ok(RESUME_INDICATOR_STATES.resume_on_file);
  assert.equal(RESUME_INDICATOR_STATES.resume_on_file.label, "Resume on file");

  assert.ok(RESUME_INDICATOR_STATES.profile_only);
  assert.equal(RESUME_INDICATOR_STATES.profile_only.label, "Profile only");

  assert.ok(RESUME_INDICATOR_STATES.no_resume_data);
  assert.equal(RESUME_INDICATOR_STATES.no_resume_data.label, "No resume data");
  assert.equal(RESUME_INDICATOR_STATES.no_resume_data.tone, "amber");
});

test("candidate review data layer returns sorted candidates and handles async decisions", async () => {
  const jobs = getReviewJobs();
  assert.ok(jobs.length >= 2);
  const activeJob = jobs[0];

  const candidates = getCandidatesForJob(activeJob.id);
  assert.ok(candidates.length > 0);

  // Candidates must be sorted by pipeline stage order
  for (let i = 0; i < candidates.length - 1; i++) {
    const orderCurrent = PIPELINE_STAGE_ORDER[candidates[i].stage];
    const orderNext = PIPELINE_STAGE_ORDER[candidates[i + 1].stage];
    assert.ok(
      orderCurrent <= orderNext,
      `Candidate at index ${i} (${candidates[i].stage}: ${orderCurrent}) is after (${candidates[i + 1].stage}: ${orderNext})`
    );
  }

  // Record decisions asynchronously
  const testCandidate = candidates[0];
  await recordCandidateDecision(activeJob.id, testCandidate.id, "want");
  const updatedCandidates = getCandidatesForJob(activeJob.id);
  const matched = updatedCandidates.find((c) => c.id === testCandidate.id);
  assert.equal(matched.decision, "want");

  // Log activity returns Waiting for Loxo and updates in-memory trail
  const logResult = await logCandidateActivity(activeJob.id, testCandidate.id, {
    type: "Phone Call",
    note: "Spoke to candidate, interested in robotics role",
    targetStage: "Outbound",
    idempotencyKey: "data-layer-log-1",
  });
  assert.equal(logResult.ok, true);
  assert.equal(logResult.activity.status, "Waiting for Loxo");
  assert.equal(logResult.activity.actor, "Ja Maralit");

  const candidatesAfterLog = getCandidatesForJob(activeJob.id);
  const matchedAfterLog = candidatesAfterLog.find((c) => c.id === testCandidate.id);
  assert.equal(matchedAfterLog.activityTrail[0].status, "Waiting for Loxo");
  assert.equal(matchedAfterLog.activityTrail[0].note, "Spoke to candidate, interested in robotics role");
});

test("presentations mapping preserves confirmed vs pending/failed state and unknown client/job fields", () => {
  const serviceSource = fs.readFileSync(path.join(featureDir, "candidateReviewService.js"), "utf8");
  assert.doesNotMatch(serviceSource, /candidateSubmissions/);
  assert.match(serviceSource, /from\("presentations"\)/);

  const confirmedKnown = mapLivePresentation({
    id: "tracker_submissions:1",
    presentation_state: "confirmed",
    source: "tracker_submissions",
    source_id: 1,
    candidate_source: "submission",
    candidate_source_id: 1,
    candidate_key: "key-1",
    candidate_name: "Candidate One",
    client_name: "Client B",
    job_id: 12,
    job_title: "Accountant",
    presented_on: "2026-10-01",
    queued_at: null,
    source_status: "Submitted",
    submission_type: "Role Submission",
    recruiter: "Ja",
    note: null,
  });
  assert.equal(confirmedKnown.presentationState, "confirmed");
  assert.equal(confirmedKnown.isConfirmed, true);
  assert.equal(confirmedKnown.clientName, "Client B");
  assert.equal(confirmedKnown.client, "Client B");
  assert.equal(confirmedKnown.jobId, "12");
  assert.equal(confirmedKnown.jobTitle, "Accountant");
  assert.equal(confirmedKnown.presentedOn, "2026-10-01");
  assert.equal(confirmedKnown.queuedAt, null);
  assert.equal(confirmedKnown.sourceStatus, "Submitted");
  assert.equal(confirmedKnown.candidate.isSubmitted, true);

  const confirmedUnknowns = mapLivePresentation({
    id: "tracker_submissions:3",
    presentation_state: "confirmed",
    source: "tracker_submissions",
    source_id: 3,
    candidate_source: "submission",
    candidate_source_id: 3,
    candidate_key: "key-3",
    candidate_name: "Candidate Three",
    client_name: null,
    job_id: null,
    job_title: null,
    presented_on: "2026-10-03",
    queued_at: null,
    source_status: "Hired",
    submission_type: "MPC",
    recruiter: "Ja",
    note: null,
  });
  assert.equal(confirmedUnknowns.presentationState, "confirmed");
  assert.equal(confirmedUnknowns.isConfirmed, true);
  assert.equal(confirmedUnknowns.clientName, null);
  assert.equal(confirmedUnknowns.client, null);
  assert.equal(confirmedUnknowns.jobId, null);
  assert.equal(confirmedUnknowns.jobTitle, null);
  assert.equal(confirmedUnknowns.sourceStatus, "Hired");
  assert.equal(confirmedUnknowns.candidate.isSubmitted, true);

  const pendingAction = mapLivePresentation({
    id: "candidate_review_actions:100",
    presentation_state: "pending",
    source: "candidate_review_actions",
    source_id: 100,
    candidate_source: "sourcing",
    candidate_source_id: 20,
    candidate_key: "source-20",
    candidate_name: "Source Candidate",
    client_name: "Client A",
    job_id: 10,
    job_title: "Program Manager",
    presented_on: null,
    queued_at: "2026-11-08T18:00:00.000Z",
    source_status: "waiting_for_loxo",
    submission_type: null,
    recruiter: null,
    note: "Queued",
  });
  assert.equal(pendingAction.presentationState, "pending");
  assert.equal(pendingAction.isConfirmed, false);
  assert.equal(pendingAction.status, "Waiting for Loxo");
  assert.equal(pendingAction.presentedOn, null);
  assert.equal(pendingAction.queuedAt, "2026-11-08T18:00:00.000Z");
  assert.equal(pendingAction.candidate.isSubmitted, false);
  assert.equal(pendingAction.candidate.presentationState, "pending");

  const failedAction = mapLivePresentation({
    id: "candidate_review_actions:102",
    presentation_state: "failed",
    source: "candidate_review_actions",
    source_id: 102,
    candidate_source: "submission",
    candidate_source_id: 2,
    candidate_key: "key-2",
    candidate_name: "Candidate Two",
    client_name: "Client B",
    job_id: 12,
    job_title: "Accountant",
    presented_on: null,
    queued_at: "2026-11-08T19:00:00.000Z",
    source_status: "failed",
    submission_type: null,
    recruiter: null,
    note: "Failed",
  });
  assert.equal(failedAction.presentationState, "failed");
  assert.equal(failedAction.isConfirmed, false);
  assert.equal(failedAction.status, "Failed");
  assert.equal(failedAction.presentedOn, null);
  assert.equal(failedAction.candidate.isSubmitted, false);
  assert.equal(failedAction.candidate.presentationState, "failed");
});

test("persisted presentations survive reload, keep queued actions pending, and never invent records on insert failure", async () => {
  const db = {
    jobs: [
      {
        job_id: 10,
        job_title: "Program Manager",
        company: "Client A",
        location: "Toronto, ON",
        compensation: "$120k",
        status: "Active",
        date_opened: "2026-10-01",
        owners: "Ja",
        loxo_link: "",
      },
    ],
    feed: [
      {
        job_id: 10,
        candidate_source: "sourcing",
        candidate_source_id: 20,
        candidate_key: "source-20",
        candidate_name: "Source Candidate",
        current_title: "Program Lead",
        current_company: "North Operations",
        location: "Toronto, ON",
        stage: "Screening",
        resume_text: "Experienced program lead.",
      },
      {
        job_id: 10,
        candidate_source: "submission",
        candidate_source_id: 1,
        candidate_key: "sub-1",
        candidate_name: "Confirmed Candidate",
        current_title: "Senior PM",
        current_company: "East Systems",
        location: "Ottawa, ON",
        stage: "Submitted",
        resume_text: "Senior PM resume.",
      },
    ],
    actions: [],
    presentations: [
      {
        id: "tracker_submissions:1",
        presentation_state: "confirmed",
        source: "tracker_submissions",
        source_id: 1,
        candidate_source: "submission",
        candidate_source_id: 1,
        candidate_key: "sub-1",
        candidate_name: "Confirmed Candidate",
        client_name: null,
        job_id: null,
        job_title: null,
        presented_on: "2026-10-01",
        queued_at: null,
        source_status: "Submitted",
        submission_type: "MPC",
        recruiter: "Ja",
        note: "Confirmed in Tracker",
      },
    ],
    failNextInsert: false,
    nextActionId: 100,
  };

  function createMockSupabase() {
    return {
      from(table) {
        if (table === "tracker_jobs") {
          return {
            select() {
              return {
                eq() {
                  return {
                    order: async () => ({ data: db.jobs, error: null }),
                  };
                },
              };
            },
          };
        }
        if (table === "candidate_review_feed") {
          return {
            select() {
              return {
                limit: async () => ({ data: db.feed, error: null }),
                eq(_col, val) {
                  return {
                    limit: async () => ({
                      data: db.feed.filter((row) => Number(row.job_id) === Number(val)),
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }
        if (table === "candidate_review_actions") {
          return {
            select() {
              return {
                eq(_col, val) {
                  return {
                    order: async () => ({
                      data: db.actions.filter((row) => Number(row.job_id) === Number(val)),
                      error: null,
                    }),
                  };
                },
              };
            },
            insert: async (payload) => {
              if (db.failNextInsert) {
                return { data: null, error: { message: "RLS or network failure" } };
              }
              const id = db.nextActionId++;
              const created_at = "2026-11-09T01:00:00.000Z";
              const actionRow = { id, created_at, ...payload };
              db.actions.unshift(actionRow);
              if (payload.action_type === "activity" && String(payload.activity_type).toLowerCase() === "submitted") {
                const candidateRow = db.feed.find(
                  (item) =>
                    item.candidate_source === payload.candidate_source &&
                    Number(item.candidate_source_id) === Number(payload.candidate_source_id)
                );
                const jobRow = db.jobs.find((item) => Number(item.job_id) === Number(payload.job_id));
                db.presentations.push({
                  id: `candidate_review_actions:${id}`,
                  presentation_state: payload.status === "failed" ? "failed" : "pending",
                  source: "candidate_review_actions",
                  source_id: id,
                  candidate_source: payload.candidate_source,
                  candidate_source_id: payload.candidate_source_id,
                  candidate_key: candidateRow?.candidate_key ?? null,
                  candidate_name: candidateRow?.candidate_name ?? null,
                  client_name: jobRow?.company ?? null,
                  job_id: payload.job_id,
                  job_title: jobRow?.job_title ?? null,
                  presented_on: null,
                  queued_at: created_at,
                  source_status: payload.status,
                  submission_type: null,
                  recruiter: null,
                  note: payload.note ?? null,
                });
              }
              return { data: actionRow, error: null };
            },
          };
        }
        if (table === "presentations") {
          return {
            select() {
              return {
                order() {
                  return {
                    range: async (from, to) => ({
                      data: db.presentations
                        .slice()
                        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
                        .slice(from, to + 1),
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };
  }

  _setSupabaseClientForTesting(createMockSupabase());
  await loadLiveReviewJobs();
  await loadLiveCandidatesForJob("10");

  // Sample fixtures are excluded in live mode; only persisted presentations appear
  const initialHistory = getSubmissionHistory();
  assert.equal(initialHistory.length, 1);
  assert.equal(initialHistory[0].id, "tracker_submissions:1");
  assert.equal(initialHistory[0].presentationState, "confirmed");
  assert.equal(initialHistory[0].clientName, null);
  assert.equal(initialHistory[0].jobId, null);
  assert.equal(initialHistory[0].jobTitle, null);

  // Failed action insert throws error and never invents a session record
  db.failNextInsert = true;
  await assert.rejects(
    recordCandidateSubmission("10", "sourcing:20", { note: "Should fail" }),
    /Could not save the submission draft/
  );
  assert.equal(getSubmissionHistory().length, 1);
  const afterFailedCandidate = getCandidatesForJob("10").find((c) => c.id === "sourcing:20");
  assert.equal(afterFailedCandidate.isSubmitted, false);
  assert.equal(afterFailedCandidate.presentationState, null);

  // Successful action insert refreshes from persisted presentations and stays pending
  db.failNextInsert = false;
  const insertResult = await recordCandidateSubmission("10", "sourcing:20", {
    note: "Queued for Client A",
  });
  assert.equal(insertResult.ok, true);
  assert.equal(insertResult.persisted, true);
  assert.equal(insertResult.submission.id, "candidate_review_actions:100");
  assert.equal(insertResult.submission.presentationState, "pending");
  assert.equal(insertResult.submission.isConfirmed, false);
  assert.equal(insertResult.submission.status, "Waiting for Loxo");

  const candidateAfterQueue = getCandidatesForJob("10").find((c) => c.id === "sourcing:20");
  assert.equal(candidateAfterQueue.isSubmitted, false);
  assert.equal(candidateAfterQueue.presentationState, "pending");
  assert.equal(candidateAfterQueue.submission.status, "Waiting for Loxo");

  // Simulate full browser reload: reset all in-memory stores and reload from Supabase
  _resetStoreForTesting();
  _setSupabaseClientForTesting(createMockSupabase());
  await loadLiveReviewJobs();
  await loadLiveCandidatesForJob("10");
  await loadLivePresentations();

  const reloadedHistory = getSubmissionHistory();
  assert.equal(reloadedHistory.length, 2);
  const reloadedPending = reloadedHistory.find((r) => r.id === "candidate_review_actions:100");
  const reloadedConfirmed = reloadedHistory.find((r) => r.id === "tracker_submissions:1");
  assert.equal(reloadedPending.presentationState, "pending");
  assert.equal(reloadedPending.candidate.isSubmitted, false);
  assert.equal(reloadedPending.status, "Waiting for Loxo");
  assert.equal(reloadedConfirmed.presentationState, "confirmed");
  assert.equal(reloadedConfirmed.candidate.isSubmitted, true);

  const reloadedCandidate = getCandidatesForJob("10").find((c) => c.id === "sourcing:20");
  assert.equal(reloadedCandidate.isSubmitted, false);
  assert.equal(reloadedCandidate.presentationState, "pending");

  db.feed.push({
    job_id: 10,
    candidate_source: "submission",
    candidate_source_id: 2,
    candidate_key: "sub-2",
    candidate_name: "Stage Only Candidate",
    stage: "Submitted",
    resume_text: "",
  });
  await loadLiveCandidatesForJob("10");
  const stageOnly = getCandidatesForJob("10").find((c) => c.id === "submission:2");
  assert.equal(stageOnly.isSubmitted, false);
  assert.equal(stageOnly.presentationState, null);

  for (let index = 0; index < 1001; index += 1) {
    db.presentations.push({
      ...db.presentations[0],
      id: `tracker_submissions:${1000 + index}`,
      source_id: 1000 + index,
      candidate_source_id: 1000 + index,
      candidate_name: "Synthetic pagination record",
    });
  }
  await loadLivePresentations();
  assert.equal(getSubmissionHistory().length, 1003);
});

test("match selected jobs only by immutable ID with zero title fallback and explicit empty state", () => {
  const jobs = getReviewJobs();
  assert.ok(jobs.length > 0);
  const firstJob = jobs[0];

  // Exact ID match
  const matched = getJobById(firstJob.id);
  assert.equal(matched.id, firstJob.id);

  // Title string lookup must FAIL (no title fallback)
  const titleMatch = getJobById(firstJob.title);
  assert.equal(titleMatch, null, "Must not match job by title");

  // Unknown job returns null and empty candidate array
  const unknown = getJobById("NON-EXISTENT-JOB-ID");
  assert.equal(unknown, null);
  const emptyCandidates = getCandidatesForJob("NON-EXISTENT-JOB-ID");
  assert.deepEqual(emptyCandidates, []);

  // Verify CandidateReview component source enforces no title fallback and renders explicit empty state
  const reviewSource = fs.readFileSync(path.join(featureDir, "CandidateReview.jsx"), "utf8");
  assert.doesNotMatch(reviewSource, /j\.title\.toLowerCase\(\)\s*===/);
  assert.doesNotMatch(reviewSource, /\|\|\s*jobs\[0\]/);
  assert.match(reviewSource, /data-testid="unmatched-job-state"/);
  assert.match(reviewSource, /No matching job selected/);
});

test("composite key isolates decisions and activities by jobId + loxoPersonId", async () => {
  const jobA = "DEMO-JOB-ROBOTICS";
  const jobB = "DEMO-JOB-LOGISTICS";
  const personId = "CROSS-JOB-PERSON-100";

  // Record want on Job A
  await recordCandidateDecision(jobA, personId, "want");

  // Verify key isolation
  const keyA = makeCompositeKey(jobA, personId);
  const keyB = makeCompositeKey(jobB, personId);
  assert.notEqual(keyA, keyB);
  assert.equal(keyA, "DEMO-JOB-ROBOTICS::CROSS-JOB-PERSON-100");
  assert.equal(keyB, "DEMO-JOB-LOGISTICS::CROSS-JOB-PERSON-100");

  // Record activity on Job A
  await logCandidateActivity(jobA, personId, {
    type: "Phone Call",
    note: "Job A outreach",
    targetStage: "Outbound",
    idempotencyKey: "job-a-activity",
  });

  // Decision and activity on Job B must remain untouched
  await recordCandidateDecision(jobB, personId, "pass");
  await logCandidateActivity(jobB, personId, {
    type: "Sent InMail",
    note: "Job B outreach",
    targetStage: "Outbound",
    idempotencyKey: "job-b-activity",
  });

  const stateA = getCandidateSessionState(jobA, personId);
  const stateB = getCandidateSessionState(jobB, personId);
  assert.equal(stateA.decision, "want");
  assert.equal(stateB.decision, "pass");
  assert.deepEqual(stateA.activities.map((activity) => activity.note), ["Job A outreach"]);
  assert.deepEqual(stateB.activities.map((activity) => activity.note), ["Job B outreach"]);
});

test("write failure preserves activity note and enforces outbox idempotency", async () => {
  const jobA = "DEMO-JOB-ROBOTICS";
  const personId = "DEMO-PERSON-001";

  // 1. Simulated write failure throws without recording
  await assert.rejects(
    logCandidateActivity(jobA, personId, { type: "Phone Call", note: "Draft note", idempotencyKey: "failed-write" }, { simulateFailure: true }),
    /Failed to record activity in outbox/
  );

  // 2. Outbox idempotency: duplicate key returns duplicate flag
  const idemKey = "test-idempotency-key-001";
  const firstWrite = await logCandidateActivity(jobA, personId, {
    type: "Phone Call",
    note: "Idempotent note",
    idempotencyKey: idemKey,
  });
  assert.equal(firstWrite.ok, true);
  assert.equal(firstWrite.duplicate, undefined);

  const secondWrite = await logCandidateActivity(jobA, personId, {
    type: "Phone Call",
    note: "Idempotent note",
    idempotencyKey: idemKey,
  });
  assert.equal(secondWrite.ok, true);
  assert.equal(secondWrite.duplicate, true);
  assert.equal(secondWrite.activity.id, firstWrite.activity.id);

  // 3. Inspect LogActivityForm.jsx source for error handling and note preservation
  const formSource = fs.readFileSync(path.join(featureDir, "LogActivityForm.jsx"), "utf8");
  assert.match(formSource, /catch\s*\(err\)/);
  assert.match(formSource, /setErrorMessage/);
  // Verify setNote("") is NOT in the catch or finally block
  assert.match(formSource, /setNote\(""\);\s*setJustLogged\(true\);/);
  assert.match(formSource, /pendingIdempotencyKey/);
});

test("brand resume and write-up use only available candidate sources", () => {
  const candidate = SAMPLE_CANDIDATES[0];
  const resume = buildBrandResumePayload(candidate);
  const writeUp = buildCandidateWriteUp(candidate);

  assert.equal(resume.name, candidate.name);
  assert.equal(resume.headline, candidate.title);
  assert.deepEqual(resume.experience[0].bullets, candidate.workHistory[0].bullets);
  assert.match(writeUp.text, /Sources missing:/);
  assert.doesNotMatch(writeUp.text, /NEEDS VERIFICATION/);

  const cardSource = fs.readFileSync(path.join(featureDir, "CandidateCard.jsx"), "utf8");
  assert.match(cardSource, /data-testid="brand-resume-button"/);
  assert.match(cardSource, /CandidateWriteUpDialog/);
});

test("six-month ownership is a warning with a recruiter override", () => {
  const status = getOwnershipStatus(
    [{ actor: "Recruiter Example", isJa: false, actorUnknown: false, date: "Oct 25, 2026" }],
    new Date("2026-11-02T12:00:00Z")
  );
  assert.equal(status.active, true);

  const expired = getOwnershipStatus(
    [{ actor: "Recruiter Example", isJa: false, actorUnknown: false, date: "Jan 1, 2026" }],
    new Date("2026-11-02T12:00:00Z")
  );
  assert.equal(expired.active, false);

  const cardSource = fs.readFileSync(path.join(featureDir, "CandidateCard.jsx"), "utf8");
  assert.match(cardSource, /data-testid="ownership-warning"/);
  assert.match(cardSource, /Reach out anyway/);
});

test("windowed candidate dots enforce bounded display and maintain navigation", () => {
  assert.equal(MAX_VISIBLE_DOTS, 5);

  // Under max: returns all indices
  assert.deepEqual(getWindowedIndices(3, 0, 5), [0, 1, 2]);

  // Exactly max: returns all indices
  assert.deepEqual(getWindowedIndices(5, 2, 5), [0, 1, 2, 3, 4]);

  // Over max: bounds to 5 windowed dots
  assert.deepEqual(getWindowedIndices(50, 0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(getWindowedIndices(50, 25, 5), [23, 24, 25, 26, 27]);
  assert.deepEqual(getWindowedIndices(50, 49, 5), [45, 46, 47, 48, 49]);

  // Verify SwipeView mounts windowed dots container
  const swipeSource = fs.readFileSync(path.join(featureDir, "SwipeView.jsx"), "utf8");
  assert.match(swipeSource, /data-testid="windowed-dots-container"/);
  assert.match(swipeSource, /getWindowedIndices/);
});

test("people view exposes fast queues and wanted actions while swipe stays unreviewed-only", () => {
  const reviewSource = fs.readFileSync(path.join(featureDir, "CandidateReview.jsx"), "utf8");
  const peopleSource = fs.readFileSync(path.join(featureDir, "PeopleView.jsx"), "utf8");
  const swipeSource = fs.readFileSync(path.join(featureDir, "SwipeView.jsx"), "utf8");

  assert.match(reviewSource, /candidate\.decision && !candidate\.isSubmitted/);
  assert.match(reviewSource, /candidates=\{swipeCandidates\}/);
  assert.match(peopleSource, /people-tab-\$\{key\}/);
  for (const label of ["All", "Unreviewed", "Wanted", "Passed", "Submitted"]) {
    assert.match(peopleSource, new RegExp(`\\[\\"[^\\"]+\\", \\"${label}\\"\\]`));
  }
  assert.match(peopleSource, /data-testid="people-search"/);
  assert.match(peopleSource, /data-testid="wanted-actions"/);
  assert.match(peopleSource, />Call</);
  assert.match(peopleSource, /onStartCandidateCall/);
  assert.doesNotMatch(peopleSource, /href=\{candidate\.phone \? `tel:/);
  assert.match(peopleSource, />Brand resume</);
  assert.match(peopleSource, />Write-up</);
  assert.match(peopleSource, /Mark submitted/);
  assert.match(peopleSource, /data-testid="submission-filters"/);
  assert.match(peopleSource, /Reach out anyway/);
  assert.doesNotMatch(peopleSource, /Session only/);
  assert.doesNotMatch(peopleSource, /candidate\.reviewJobTitle \|\| currentJob\?\.title/);
  assert.match(peopleSource, /record\.presentationState === "confirmed"/);
  assert.match(peopleSource, /candidate\.presentationState === "pending"/);
  assert.match(peopleSource, /Waiting for Loxo/);
  assert.match(peopleSource, /Job not recorded/);
  assert.match(peopleSource, /Client not recorded/);
  assert.equal([...swipeSource.matchAll(/onNavigateIndex\(safeIndex \+ 1\)/g)].length, 1);
});

test("screenshot feedback: LoginButton removed from shell, navigation cleaned, eyebrow removed, buttons concise", () => {
  const appSource = fs.readFileSync(appFile, "utf8");

  // Removed from app shell header
  assert.doesNotMatch(appSource, /<LoginButton\s*\/>/);
  assert.doesNotMatch(appSource, /import LoginButton from/);

  // Staff stays out of navigation; Mail and Profile are real pages now
  assert.doesNotMatch(appSource, /\["Staff"/);
  assert.match(appSource, /\["Mail"/);
  assert.match(appSource, /\["Profile"/);

  // Eyebrow removed
  assert.doesNotMatch(appSource, /JA STUDIO CONSULTING/);

  // Drag Left / Drag Right button text removed from CandidateCard
  const cardSource = fs.readFileSync(path.join(featureDir, "CandidateCard.jsx"), "utf8");
  assert.doesNotMatch(cardSource, /Pass \(Drag Left\)/);
  assert.doesNotMatch(cardSource, /Want This Candidate \(Drag Right\)/);
  assert.match(cardSource, /Pass/);
  assert.match(cardSource, /Want this candidate/);

  // CandidateReview renders Jobs Map navigation and job title in picker
  const reviewSource = fs.readFileSync(path.join(featureDir, "CandidateReview.jsx"), "utf8");
  assert.match(reviewSource, /data-testid="navigate-jobs-map"/);
  assert.match(reviewSource, /currentJob\s*\?\s*currentJob\.title\s*:\s*"Select active job"/);
});

test("fixtures strictly use synthetic IDs, 555 numbers, and example.invalid emails", () => {
  for (const job of SAMPLE_JOBS) {
    assert.match(job.id, /^DEMO-JOB-/);
    assert.doesNotMatch(job.company, /Dyna-Mig|Linamar|Gerdau|Metro Supply Chain/i);
  }

  for (const cand of SAMPLE_CANDIDATES) {
    assert.match(cand.id, /^DEMO-PERSON-/);
    assert.match(cand.candidateId, /^DEMO-CAND-/);
    assert.match(cand.jobId, /^DEMO-JOB-/);
    assert.match(cand.email, /@example\.invalid$/);
    assert.match(cand.phone, /^\+1 555 01\d{2}$/);
    assert.doesNotMatch(cand.employer, /Dyna-Mig|Linamar|Gerdau|Metro Supply Chain/i);
    assert.doesNotMatch(cand.fullResumeText, /@example\.com|\.co\b/);
  }
});

test("candidate review code limits localStorage to the Canada filter, has no sessionStorage, and no send authority", () => {
  const filenames = fs.readdirSync(featureDir).filter((f) => f.endsWith(".js") || f.endsWith(".jsx"));
  const sources = filenames.map((file) => fs.readFileSync(path.join(featureDir, file), "utf8")).join("\n");
  const withoutCanadaFilter = filenames
    .filter((file) => file !== "canadaFilter.js")
    .map((file) => fs.readFileSync(path.join(featureDir, file), "utf8"))
    .join("\n");

  // The remembered Canada filter is the only approved use of localStorage.
  assert.doesNotMatch(withoutCanadaFilter, /localStorage/);
  assert.doesNotMatch(sources, /sessionStorage/);
  assert.doesNotMatch(sources, /sendEmail|candidateSubmit/i);
});

test("candidate review code adheres to design rules: zero purple, no forbidden punctuation in text", () => {
  const filenames = fs.readdirSync(featureDir).filter((f) => f.endsWith(".js") || f.endsWith(".jsx"));
  const sources = filenames.map((file) => fs.readFileSync(path.join(featureDir, file), "utf8")).join("\n");

  // Zero purple color tokens
  assert.doesNotMatch(sources, /#6b4ea8/i);
  assert.doesNotMatch(sources, /text-purple|bg-purple|border-purple/i);

  // No em dashes, en dashes, or tildes anywhere in feature sources
  assert.doesNotMatch(sources, /—/); // em dash
  assert.doesNotMatch(sources, /–/); // en dash
  assert.doesNotMatch(sources, /~/); // tilde
});

test("also fits tags are backed by tracker rows and matching resume lines", () => {
  const jobs = getReviewJobs();
  const candidates = getCandidatesForJob(jobs[0].id);
  const candidateWithFits = candidates.find((c) => c.alsoFits && c.alsoFits.length > 0);

  assert.ok(candidateWithFits, "Expected at least one sample candidate with alsoFits");
  for (const fit of candidateWithFits.alsoFits) {
    assert.ok(fit.jobTitle);
    assert.ok(fit.company);
    assert.ok(fit.trackerRow.sheet);
    assert.ok(fit.trackerRow.rowNumber);
    assert.ok(fit.trackerRow.dateAdded);
    assert.ok(fit.trackerRow.addedBy);
    assert.ok(Array.isArray(fit.matchingResumeLines));
    assert.ok(fit.matchingResumeLines.length > 0);
  }
});

// ---- Finish run, Builder A: reject, outreach, timeline, AI handoff, Canada filter ----

const dash = String.fromCharCode(0x2014);

test("reject with a reason records a pass, then queues a Loxo note to Rejected", async () => {
  const { REJECT_REASONS, rejectCandidate, buildRejectNote } = await import("../src/features/candidate-review/rejectReasons.js");
  assert.deepEqual(REJECT_REASONS, [
    "Not interested",
    "Comp / location mismatch",
    "Already engaged by another recruiter",
    "Not qualified on paper",
    "Placed elsewhere",
  ]);
  const calls = [];
  const result = await rejectCandidate({
    jobId: "10",
    personId: "sourcing:5",
    reason: "Not interested",
    recordDecision: async (...args) => { calls.push(["decision", ...args]); return { ok: true }; },
    logActivity: async (...args) => { calls.push(["log", ...args]); return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "Waiting for Loxo");
  assert.deepEqual(calls[0], ["decision", "10", "sourcing:5", "pass"]);
  assert.deepEqual(calls[1], ["log", "10", "sourcing:5", { type: "*Note", note: "Rejected: Not interested", targetStage: "Rejected" }]);
  assert.equal(buildRejectNote("Placed elsewhere"), "Rejected: Placed elsewhere");
});

test("reject refuses an unknown reason and reports a failed Loxo note honestly", async () => {
  const { rejectCandidate } = await import("../src/features/candidate-review/rejectReasons.js");
  const bad = await rejectCandidate({ jobId: "1", personId: "a", reason: "Because", recordDecision: async () => ({ ok: true }), logActivity: async () => ({ ok: true }) });
  assert.equal(bad.ok, false);
  const partial = await rejectCandidate({
    jobId: "1",
    personId: "a",
    reason: "Placed elsewhere",
    recordDecision: async () => ({ ok: true }),
    logActivity: async () => { throw new Error("offline"); },
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.decisionSaved, true);
});

test("Quick One template fills from job data and never invents a blurb", async () => {
  const { OUTREACH_TEMPLATES, renderOutreach, buildBlurb, pickRoleOptions, buildMailto, canSaveGmailDraft } = await import("../src/features/candidate-review/outreachTemplates.js");
  assert.equal(OUTREACH_TEMPLATES[0].name, "Quick One");
  assert.equal(OUTREACH_TEMPLATES[0].subject, "Quick One");

  const job = { id: "1", title: "Millwright", company: "Grand River Steel Works", location: "Cambridge, ON" };
  const out = renderOutreach({ candidate: { name: "Alex Rivera" }, job, signature: "Ja" });
  assert.match(out.body, /^Hey Alex,/);
  assert.match(out.body, /working on a Millwright role - Grand River Steel Works in Cambridge, ON\./);
  assert.match(out.body, /\n\nJa$/);
  assert.equal(out.body.includes(dash), false);

  assert.equal(buildBlurb({ title: "x" }), "");
  assert.equal(buildBlurb({ company: "Company not recorded", location: "" }), "");

  const jobs = [
    job,
    { id: "2", title: "Welder", location: "Toronto, ON", status: "Active" },
    { id: "3", title: "Pilot", location: "Calgary, AB", status: "Active" },
    { id: "4", title: "Closed", location: "Toronto, ON", status: "Closed" },
  ];
  const provinceOf = (loc) => (/ON$/.test(loc) ? "ON" : /AB$/.test(loc) ? "AB" : "");
  assert.deepEqual(pickRoleOptions(job, jobs, provinceOf).map((j) => j.id), ["1", "2"]);

  assert.equal(buildMailto({ to: "a@example.invalid", subject: "Hi there", body: "x\ny" }), "mailto:a@example.invalid?subject=Hi%20there&body=x%0Ay");
  assert.equal(canSaveGmailDraft({ ok: true }), true);
  assert.equal(canSaveGmailDraft({ scopes: { compose: false } }), false);
});

test("experience timeline parses dates, totals without double counting, flags short stints", async () => {
  const { parseDateRange, buildTimeline, formatDuration } = await import("../src/features/candidate-review/experienceTimeline.js");
  const now = new Date("2026-11-07T12:00:00Z");
  assert.equal(parseDateRange("Jan 2024 to Present", now).months, 35);
  assert.equal(parseDateRange("Source record", now), null);
  assert.equal(parseDateRange("", now), null);
  assert.equal(formatDuration(14), "1 yr 2 mos");

  const timeline = buildTimeline(
    [
      { id: "a", title: "Tech", company: "Acme", dates: "Jan 2024 to Present" },
      { id: "b", title: "Lead", company: "Acme", dates: "Jun 2021 to Dec 2023" },
      { id: "c", title: "Temp", company: "Other", dates: "Mar 2021 to Aug 2021" },
      { id: "d", title: "Odd", company: "X", dates: "Source record" },
    ],
    [{ index: 0, why: "Runs Fanuc weld cells" }],
    now
  );
  assert.equal(timeline.rows[0].why, "Runs Fanuc weld cells");
  assert.equal(timeline.rows[1].why, "");
  assert.equal(timeline.rows[2].shortStint, true);
  assert.equal(timeline.rows[0].shortStint, false);
  assert.equal(timeline.rows[3].duration, "");
  assert.equal(timeline.rows[3].dates, "Source record");
  // Mar 2021 to Nov 2026 is inclusive is continuous: 69 months.
  assert.equal(timeline.totalMonths, 69);
});

test("For your AI handoff starts with the front door line and lists only ticked work", async () => {
  const { buildAiHandoff } = await import("../src/features/candidate-review/aiHandoff.js");
  const candidate = { name: "Alex Rivera", loxoPersonId: "777" };
  const job = { id: "42", title: "Millwright", company: "Grand River Steel Works" };
  const empty = buildAiHandoff({ candidate, job, ticked: new Set() });
  const first = empty.split("\n")[0];
  assert.equal(first, "Route through the Recruiter front door ($recruiter).");
  assert.match(empty, /Loxo person id: 777/);
  assert.match(empty, /Loxo job id: 42/);
  assert.match(empty, /Role in play: Millwright at Grand River Steel Works/);
  assert.match(empty, /todo:\n\(nothing ticked yet\)$/);

  const some = buildAiHandoff({ candidate, job, ticked: new Set(["loxo", "brandedresume"]) });
  assert.match(some, /1\. Build the TTTG branded resume/);
  assert.match(some, /2\. Queue the Loxo update/);
  assert.doesNotMatch(some, /nothing ticked/);
});

test("Canada filter defaults on, remembers choices, and can include unknown locations", async () => {
  const { loadCanadaPrefs, saveCanadaPrefs, filterByCanada } = await import("../src/features/candidate-review/canadaFilter.js");
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadCanadaPrefs(storage), { canadaOnly: true, showUnknown: false });
  saveCanadaPrefs({ canadaOnly: true, showUnknown: true }, storage);
  assert.deepEqual(loadCanadaPrefs(storage), { canadaOnly: true, showUnknown: true });
  assert.deepEqual(loadCanadaPrefs({ getItem: () => { throw new Error("blocked"); } }), { canadaOnly: true, showUnknown: false });

  const people = [{ location: "Toronto, ON" }, { location: "Austin, TX" }, { location: "" }];
  const isCa = (loc) => /ON$/.test(loc);
  assert.equal(filterByCanada(people, { canadaOnly: true, showUnknown: false }, isCa).length, 1);
  assert.equal(filterByCanada(people, { canadaOnly: true, showUnknown: true }, isCa).length, 2);
  assert.equal(filterByCanada(people, { canadaOnly: false, showUnknown: false }, isCa).length, 3);
});

test("card wires the new pieces and drops the old no-resume message", () => {
  const card = fs.readFileSync(path.join(featureDir, "CandidateCard.jsx"), "utf8");
  const people = fs.readFileSync(path.join(featureDir, "PeopleView.jsx"), "utf8");
  for (const source of [card, people]) {
    assert.doesNotMatch(source, /No source resume is stored/);
    assert.match(source, /Not enough data to build a resume/);
    assert.match(source, /getResumeSource/);
  }
  assert.match(card, /<FitBadge job=\{currentJob\} candidate=\{candidate\} \/>/);
  assert.match(card, /RejectMenu/);
  assert.match(card, /ContactReveal/);
  assert.match(card, /ForYourAiBox/);
  // All cross-builder imports stay in one file.
  const externals = fs.readFileSync(path.join(featureDir, "externals.js"), "utf8");
  assert.match(externals, /pipeline\/location\.js/);
  assert.match(externals, /mail\/mailClient\.js/);
});

test("empty live state never falls back to sample records", async () => {
  _resetStoreForTesting();
  assert.deepEqual(getReviewJobs(), []);
  assert.deepEqual(getCandidatesForJob(SAMPLE_JOBS[0].id), []);
  assert.deepEqual(getSubmissionHistory(), []);
  await assert.rejects(
    recordCandidateSubmission(SAMPLE_JOBS[0].id, SAMPLE_CANDIDATES[0].id),
    /unknown candidate or job/
  );
  const reviewSource = fs.readFileSync(path.join(featureDir, "CandidateReview.jsx"), "utf8");
  const serviceSource = fs.readFileSync(path.join(featureDir, "candidateReviewService.js"), "utf8");
  assert.match(reviewSource, /No live review jobs available/);
  assert.doesNotMatch(reviewSource, /Sample data|isSampleData/);
  assert.doesNotMatch(serviceSource, /SAMPLE_JOBS|SAMPLE_CANDIDATES/);
});

test("live mapper keeps profile evidence in its own fields and invents no job history", () => {
  const candidate = mapLiveCandidate({
    candidate_source: "sourcing",
    candidate_source_id: 42,
    candidate_key: "sourcing_42",
    job_id: 7,
    candidate_name: "Real Candidate",
    current_title: "Maintenance Manager",
    profile_summary: "Summary from the source profile.",
    fit_evidence: "Fit evidence from the source profile.",
    resume_text: "Full resume text on file.",
    stage: "Needs checking",
  });

  assert.deepEqual(candidate.workHistory, []);
  assert.equal(candidate.profileSummary, "Summary from the source profile.");
  assert.equal(candidate.fitEvidence, "Fit evidence from the source profile.");
  assert.equal(candidate.fullResumeText, "Full resume text on file.");
});

test("Presented badge and client list join strictly by candidate_source:candidate_source_id, deduplicate repeated clients, and preserve unknowns", () => {
  assert.equal(buildCandidateSourceKey("submission", 1), "submission:1");
  assert.equal(buildCandidateSourceKey("sourcing", "20"), "sourcing:20");
  assert.equal(buildCandidateSourceKey("submission", null), null);
  assert.equal(buildCandidateSourceKey("invalid_source", 1), null);
  assert.equal(
    extractCandidateSourceKey({
      id: "tracker_submissions:99",
      candidate_source: null,
      candidate_source_id: null,
      candidate_name: "Same Name Candidate",
    }),
    null
  );

  const syntheticPresentations = [
    // Confirmed presentation 1 for submission:1 (Maple Robotics, Hired)
    {
      id: "tracker_submissions:1",
      presentation_state: "confirmed",
      source: "tracker_submissions",
      source_id: 1,
      candidate_source: "submission",
      candidate_source_id: 1,
      candidate_key: "sub-1",
      candidate_name: "Same Name Candidate",
      client_name: "Maple Robotics",
      job_id: 10,
      job_title: "Controls Lead",
      presented_on: "2026-10-15",
      queued_at: null,
      source_status: "Hired",
    },
    // Confirmed presentation 2 for submission:1 (repeated client in lowercase, earlier date/role)
    {
      id: "tracker_submissions:2",
      presentation_state: "confirmed",
      source: "tracker_submissions",
      source_id: 2,
      candidate_source: "submission",
      candidate_source_id: 1,
      candidate_key: "sub-1",
      candidate_name: "Same Name Candidate",
      client_name: "maple robotics",
      job_id: 11,
      job_title: "Automation Engineer",
      presented_on: "2026-09-01",
      queued_at: null,
      source_status: "Submitted",
    },
    // Confirmed presentation 3 for submission:1 (second distinct client)
    {
      id: "tracker_submissions:3",
      presentation_state: "confirmed",
      source: "tracker_submissions",
      source_id: 3,
      candidate_source: "submission",
      candidate_source_id: 1,
      candidate_key: "sub-1",
      candidate_name: "Same Name Candidate",
      client_name: "Northern Steel",
      job_id: 12,
      job_title: "Maintenance Supervisor",
      presented_on: "2026-08-12",
      queued_at: null,
      source_status: "Rejected",
    },
    // Pending Workbench action for submission:1 (must be labeled separately and excluded from presentedClients)
    {
      id: "candidate_review_actions:201",
      presentation_state: "pending",
      source: "candidate_review_actions",
      source_id: 201,
      candidate_source: "submission",
      candidate_source_id: 1,
      candidate_key: "sub-1",
      candidate_name: "Same Name Candidate",
      client_name: "Western Logistics",
      job_id: 15,
      job_title: "Operations Manager",
      presented_on: null,
      queued_at: "2026-11-08T18:00:00.000Z",
      source_status: "waiting_for_loxo",
    },
    // Confirmed presentation with null/unknown client, job, and date for submission:5
    {
      id: "tracker_submissions:5",
      presentation_state: "confirmed",
      source: "tracker_submissions",
      source_id: 5,
      candidate_source: "submission",
      candidate_source_id: 5,
      candidate_key: "sub-5",
      candidate_name: "Unknown Fields Candidate",
      client_name: null,
      job_id: null,
      job_title: null,
      presented_on: null,
      queued_at: null,
      source_status: "Submitted",
    },
    // Pending-only Workbench action for sourcing:20
    {
      id: "candidate_review_actions:202",
      presentation_state: "pending",
      source: "candidate_review_actions",
      source_id: 202,
      candidate_source: "sourcing",
      candidate_source_id: 20,
      candidate_key: "src-20",
      candidate_name: "Pending Only Candidate",
      client_name: "Summit Machining",
      job_id: 10,
      job_title: "Program Manager",
      presented_on: null,
      queued_at: "2026-11-08T19:00:00.000Z",
      source_status: "waiting_for_loxo",
    },
    // Failed-only Workbench action for sourcing:21
    {
      id: "candidate_review_actions:203",
      presentation_state: "failed",
      source: "candidate_review_actions",
      source_id: 203,
      candidate_source: "sourcing",
      candidate_source_id: 21,
      candidate_key: "src-21",
      candidate_name: "Failed Only Candidate",
      client_name: null,
      job_id: null,
      job_title: null,
      presented_on: null,
      queued_at: null,
      source_status: "failed",
    },
  ];

  // 1. Confirmed candidate with repeated and multiple clients + pending action
  const multiClientSummary = buildCandidatePresentationSummary(
    {
      id: "submission:1",
      candidate_source: "submission",
      candidate_source_id: 1,
      name: "Same Name Candidate",
    },
    syntheticPresentations
  );
  assert.equal(multiClientSummary.isPresented, true);
  assert.equal(multiClientSummary.isSubmitted, true);
  assert.equal(multiClientSummary.presentationState, "confirmed");
  assert.equal(multiClientSummary.badgeLabel, "Presented");
  assert.equal(multiClientSummary.pendingBadgeLabel, "Pending confirmation");
  assert.deepEqual(multiClientSummary.presentedClients, ["Maple Robotics", "Northern Steel"]);
  assert.deepEqual(multiClientSummary.presentedClientLabels, ["Maple Robotics", "Northern Steel"]);
  assert.equal(multiClientSummary.presentedClientSummaries.length, 2);
  assert.equal(multiClientSummary.presentedClientSummaries[0].clientLabel, "Maple Robotics");
  assert.equal(multiClientSummary.presentedClientSummaries[0].presentationCount, 2);
  assert.equal(multiClientSummary.presentedClientSummaries[0].statusLabel, "Hired");
  assert.equal(multiClientSummary.presentedClientSummaries[0].dateLabel, "2026-10-15");
  assert.equal(multiClientSummary.presentedClientSummaries[1].clientLabel, "Northern Steel");
  assert.equal(multiClientSummary.presentedClientSummaries[1].presentationCount, 1);
  assert.equal(multiClientSummary.presentedClientSummaries[1].statusLabel, "Rejected");
  assert.equal(multiClientSummary.presentedClientSummaries[1].dateLabel, "2026-08-12");
  assert.equal(multiClientSummary.confirmedPresentations.length, 3);
  assert.equal(multiClientSummary.pendingPresentations.length, 1);
  assert.equal(multiClientSummary.pendingPresentations[0].clientLabel, "Western Logistics");
  assert.equal(multiClientSummary.pendingPresentations[0].statusLabel, "Waiting for Loxo");
  assert.equal(multiClientSummary.pendingPresentations[0].dateLabel, "Queued 2026-11-08");

  // 2. Different candidate_source:candidate_source_id with identical name NEVER matches
  const sameNameDifferentSource = buildCandidatePresentationSummary(
    {
      id: "sourcing:99",
      candidate_source: "sourcing",
      candidate_source_id: 99,
      name: "Same Name Candidate",
    },
    syntheticPresentations
  );
  assert.equal(sameNameDifferentSource.isPresented, false);
  assert.equal(sameNameDifferentSource.isSubmitted, false);
  assert.equal(sameNameDifferentSource.badgeLabel, null);
  assert.deepEqual(sameNameDifferentSource.presentedClients, []);
  assert.deepEqual(sameNameDifferentSource.confirmedPresentations, []);

  // 3. Confirmed presentation with unknown/null client, job, and date preserves nulls and labels
  const unknownSummary = buildCandidatePresentationSummary(
    {
      id: "submission:5",
      candidate_source: "submission",
      candidate_source_id: 5,
      name: "Unknown Fields Candidate",
    },
    syntheticPresentations
  );
  assert.equal(unknownSummary.isPresented, true);
  assert.equal(unknownSummary.badgeLabel, "Presented");
  assert.equal(unknownSummary.hasUnknownConfirmedClient, true);
  assert.deepEqual(unknownSummary.presentedClients, []);
  assert.deepEqual(unknownSummary.presentedClientLabels, ["Client not recorded"]);
  assert.equal(unknownSummary.confirmedPresentations[0].clientName, null);
  assert.equal(unknownSummary.confirmedPresentations[0].jobId, null);
  assert.equal(unknownSummary.confirmedPresentations[0].jobTitle, null);
  assert.equal(unknownSummary.confirmedPresentations[0].presentedOn, null);
  assert.equal(unknownSummary.confirmedPresentations[0].clientLabel, "Client not recorded");
  assert.equal(unknownSummary.confirmedPresentations[0].jobLabel, "Job not recorded");
  assert.equal(unknownSummary.confirmedPresentations[0].dateLabel, "Date not recorded");
  assert.equal(unknownSummary.confirmedPresentations[0].statusLabel, "Submitted");

  // 4. Pending-only Workbench action never counts as Presented
  const pendingSummary = buildCandidatePresentationSummary(
    {
      id: "sourcing:20",
      candidate_source: "sourcing",
      candidate_source_id: 20,
      name: "Pending Only Candidate",
    },
    syntheticPresentations
  );
  assert.equal(pendingSummary.isPresented, false);
  assert.equal(pendingSummary.isSubmitted, false);
  assert.equal(pendingSummary.presentationState, "pending");
  assert.equal(pendingSummary.badgeLabel, "Pending confirmation");
  assert.deepEqual(pendingSummary.presentedClients, []);
  assert.deepEqual(pendingSummary.presentedClientLabels, []);
  assert.equal(pendingSummary.pendingPresentations.length, 1);
  assert.equal(pendingSummary.pendingPresentations[0].clientLabel, "Summit Machining");
  assert.equal(pendingSummary.pendingPresentations[0].jobLabel, "Program Manager");
  assert.equal(pendingSummary.pendingPresentations[0].dateLabel, "Queued 2026-11-08");

  // 5. Failed-only Workbench action with unknown fields never counts as Presented
  const failedSummary = buildCandidatePresentationSummary(
    {
      id: "sourcing:21",
      candidate_source: "sourcing",
      candidate_source_id: 21,
      name: "Failed Only Candidate",
    },
    syntheticPresentations
  );
  assert.equal(failedSummary.isPresented, false);
  assert.equal(failedSummary.isSubmitted, false);
  assert.equal(failedSummary.presentationState, "failed");
  assert.equal(failedSummary.badgeLabel, "Submission failed");
  assert.deepEqual(failedSummary.presentedClients, []);
  assert.equal(failedSummary.failedPresentations.length, 1);
  assert.equal(failedSummary.failedPresentations[0].clientLabel, "Client not recorded");
  assert.equal(failedSummary.failedPresentations[0].jobLabel, "Job not recorded");
  assert.equal(failedSummary.failedPresentations[0].dateLabel, "Date not recorded");

  // 6. enrichCandidatesWithPresentations attaches presentation fields across candidate lists
  const enrichedList = enrichCandidatesWithPresentations(
    [
      { id: "submission:1", candidate_source: "submission", candidate_source_id: 1, name: "Same Name Candidate" },
      { id: "sourcing:20", candidate_source: "sourcing", candidate_source_id: 20, name: "Pending Only Candidate" },
    ],
    syntheticPresentations
  );
  assert.equal(enrichedList[0].isPresented, true);
  assert.deepEqual(enrichedList[0].presentedClients, ["Maple Robotics", "Northern Steel"]);
  assert.equal(enrichedList[1].isPresented, false);
  assert.equal(enrichedList[1].presentationState, "pending");
});

test("CandidateCard, PeopleView, SwipeView, and CandidatePresentationSummary wire Presented badges and client lists without numeric fit scores or purple", () => {
  const summarySource = fs.readFileSync(path.join(featureDir, "CandidatePresentationSummary.jsx"), "utf8");
  const cardSource = fs.readFileSync(path.join(featureDir, "CandidateCard.jsx"), "utf8");
  const peopleSource = fs.readFileSync(path.join(featureDir, "PeopleView.jsx"), "utf8");
  const swipeSource = fs.readFileSync(path.join(featureDir, "SwipeView.jsx"), "utf8");

  assert.match(summarySource, /data-testid=\{`\$\{prefix\}-presented-badge`\}/);
  assert.match(summarySource, /data-testid=\{`\$\{prefix\}-pending-presentation-badge`\}/);
  assert.match(summarySource, /data-testid=\{`\$\{prefix\}-failed-presentation-badge`\}/);
  assert.match(summarySource, /data-testid=\{`\$\{prefix\}-presented-clients`\}/);
  assert.match(summarySource, /data-testid=\{`\$\{prefix\}-presented-client-badge`\}/);
  assert.match(summarySource, /data-testid=\{`\$\{prefix\}-confirmed-presentations`\}/);
  assert.match(summarySource, /data-testid=\{`\$\{prefix\}-unconfirmed-presentations`\}/);
  assert.match(summarySource, /Presented to: \{summary\.presentedClientLabels\.join\(", "\)\}/);

  assert.match(cardSource, /<CandidatePresentationBadges/);
  assert.match(cardSource, /<CandidatePresentationSummary/);
  assert.match(cardSource, /prefix="card"/);

  assert.match(peopleSource, /<CandidatePresentationBadges/);
  assert.match(peopleSource, /<CandidatePresentationSummary/);
  assert.match(peopleSource, /prefix="people"/);
  assert.match(peopleSource, /enrichCandidatesWithPresentations/);

  assert.match(swipeSource, /<CandidatePresentationBadges/);
  assert.match(swipeSource, /prefix="swipe"/);

  for (const src of [summarySource, cardSource, peopleSource, swipeSource]) {
    assert.doesNotMatch(src, /purple|violet|indigo|fuchsia|#6b4ea8/i);
  }
});

test("CandidatePresentationSummary compiles and renders confirmed, repeated-client, unknown, pending, and failed markup across card, people, and pipeline surfaces", async () => {
  const { transformWithEsbuild } = await import("vite");
  const React = await import("react");
  const jsxRuntime = await import("react/jsx-runtime");
  const { renderToStaticMarkup } = await import("react-dom/server");

  const summaryPath = path.join(featureDir, "CandidatePresentationSummary.jsx");
  const rawSource = fs.readFileSync(summaryPath, "utf8");
  const compiled = await transformWithEsbuild(rawSource, "CandidatePresentationSummary.jsx", {
    loader: "jsx",
    jsx: "automatic",
  });
  assert.match(compiled.code, /function CandidatePresentationBadges/);
  assert.match(compiled.code, /function CandidatePresentationSummary/);

  // Replace relative imports with inline test doubles for Badge and service so we can execute rendered markup directly
  const executableCode = compiled.code
    .replace(
      /import\s*\{\s*Badge\s*\}\s*from\s*"[^"]+";/,
      'const Badge = ({ children, className, ...rest }) => React.createElement("span", { className, ...rest }, children);'
    )
    .replace(
      /import\s*\{\s*buildCandidatePresentationSummary\s*\}\s*from\s*"[^"]+";/,
      ""
    );

  const moduleFactory = new Function(
    "React",
    "useMemo",
    "jsx",
    "jsxs",
    "Fragment",
    "buildCandidatePresentationSummary",
    `${executableCode.replace(/import\s+[^;]+;/g, "").replace(/export\s+default\s+function\s+CandidatePresentationSummary/, "function CandidatePresentationSummary").replace(/export\s+function\s+CandidatePresentationBadges/, "function CandidatePresentationBadges")}\nreturn { CandidatePresentationBadges, CandidatePresentationSummary };`
  );
  const { CandidatePresentationBadges, CandidatePresentationSummary } = moduleFactory(
    React,
    React.useMemo,
    jsxRuntime.jsx,
    jsxRuntime.jsxs,
    jsxRuntime.Fragment,
    buildCandidatePresentationSummary
  );

  const rows = [
    {
      id: "tracker_submissions:10",
      presentation_state: "confirmed",
      source: "tracker_submissions",
      source_id: 10,
      candidate_source: "submission",
      candidate_source_id: 7,
      client_name: "Client Alpha",
      job_id: 101,
      job_title: "Operations Manager",
      presented_on: "2026-10-20",
      source_status: "Hired",
    },
    {
      id: "tracker_submissions:11",
      presentation_state: "confirmed",
      source: "tracker_submissions",
      source_id: 11,
      candidate_source: "submission",
      candidate_source_id: 7,
      client_name: "Client Alpha",
      job_id: 102,
      job_title: "Plant Manager",
      presented_on: "2026-09-12",
      source_status: "Submitted",
    },
    {
      id: "tracker_submissions:12",
      presentation_state: "confirmed",
      source: "tracker_submissions",
      source_id: 12,
      candidate_source: "submission",
      candidate_source_id: 7,
      client_name: null,
      job_id: null,
      job_title: null,
      presented_on: null,
      source_status: "Rejected",
    },
    {
      id: "candidate_review_actions:301",
      presentation_state: "pending",
      source: "candidate_review_actions",
      source_id: 301,
      candidate_source: "sourcing",
      candidate_source_id: 88,
      client_name: "Pending Client",
      job_id: 201,
      job_title: "Quality Lead",
      presented_on: null,
      queued_at: "2026-11-08T12:00:00.000Z",
      source_status: "waiting_for_loxo",
    },
  ];

  // Render confirmed candidate on card, people, and pipeline surfaces
  for (const prefix of ["card", "people", "pipeline"]) {
    const badgesHtml = renderToStaticMarkup(
      React.createElement(CandidatePresentationBadges, {
        candidate: { id: "submission:7", candidate_source: "submission", candidate_source_id: 7 },
        presentations: rows,
        prefix,
      })
    );
    const summaryHtml = renderToStaticMarkup(
      React.createElement(CandidatePresentationSummary, {
        candidate: { id: "submission:7", candidate_source: "submission", candidate_source_id: 7 },
        presentations: rows,
        prefix,
        compact: prefix !== "card",
      })
    );
    assert.match(badgesHtml, new RegExp(`data-testid="${prefix}-presented-badge"`));
    assert.match(badgesHtml, />Presented</);
    assert.match(summaryHtml, new RegExp(`data-testid="${prefix}-presented-clients"`));
    assert.match(summaryHtml, /Presented to: Client Alpha, Client not recorded/);
    assert.match(summaryHtml, /Client Alpha \(2x\)/);
    assert.match(summaryHtml, /Operations Manager/);
    assert.match(summaryHtml, /Hired/);
    assert.match(summaryHtml, /2026-10-20/);
    assert.match(summaryHtml, /Job not recorded/);
    assert.match(summaryHtml, /Date not recorded/);
  }

  // Render pending-only candidate: never renders Presented badge
  const pendingBadgesHtml = renderToStaticMarkup(
    React.createElement(CandidatePresentationBadges, {
      candidate: { id: "sourcing:88", candidate_source: "sourcing", candidate_source_id: 88 },
      presentations: rows,
      prefix: "card",
    })
  );
  const pendingSummaryHtml = renderToStaticMarkup(
    React.createElement(CandidatePresentationSummary, {
      candidate: { id: "sourcing:88", candidate_source: "sourcing", candidate_source_id: 88 },
      presentations: rows,
      prefix: "card",
    })
  );
  assert.doesNotMatch(pendingBadgesHtml, /data-testid="card-presented-badge"/);
  assert.match(pendingBadgesHtml, /data-testid="card-pending-presentation-badge"/);
  assert.match(pendingBadgesHtml, /Pending confirmation/);
  assert.doesNotMatch(pendingSummaryHtml, /Presented to:/);
  assert.match(pendingSummaryHtml, /data-testid="card-unconfirmed-presentations"/);
  assert.match(pendingSummaryHtml, /Pending Client/);
  assert.match(pendingSummaryHtml, /Queued 2026-11-08/);
});

test("two Submitted actions for one source candidate retain separate job and client history", async () => {
  const rows = [
    {
      id: "candidate_review_actions:501",
      presentation_state: "pending",
      source: "candidate_review_actions",
      source_id: 501,
      candidate_source: "sourcing",
      candidate_source_id: 20,
      job_id: 10,
      job_title: "Controls Lead",
      client_name: "Client A",
      queued_at: "2026-11-08T10:00:00.000Z",
      source_status: "waiting_for_loxo",
    },
    {
      id: "candidate_review_actions:502",
      presentation_state: "pending",
      source: "candidate_review_actions",
      source_id: 502,
      candidate_source: "sourcing",
      candidate_source_id: 20,
      job_id: 11,
      job_title: "Automation Manager",
      client_name: "Client B",
      queued_at: "2026-11-09T10:00:00.000Z",
      source_status: "waiting_for_loxo",
    },
  ];
  const query = {
    select() { return this; },
    order() { return this; },
    async range(start, end) { return { data: rows.slice(start, end + 1), error: null }; },
  };
  _resetStoreForTesting();
  _setSupabaseClientForTesting({
    from(table) {
      assert.equal(table, "presentations");
      return query;
    },
  });
  try {
    await loadLivePresentations();
    const history = getSubmissionHistory();
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((item) => [item.id, item.jobId, item.clientName]), [
      ["candidate_review_actions:502", "11", "Client B"],
      ["candidate_review_actions:501", "10", "Client A"],
    ]);
    assert.ok(history.every((item) => item.personId === "sourcing:20" && item.presentationState === "pending"));
    const summary = buildCandidatePresentationSummary("sourcing:20", history);
    assert.equal(summary.pendingPresentations.length, 2);
    assert.equal(summary.confirmedPresentations.length, 0);
    assert.deepEqual(summary.pendingPresentations.map((item) => item.jobId), ["11", "10"]);
  } finally {
    _resetStoreForTesting();
  }
});
