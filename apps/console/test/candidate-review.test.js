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
  isSampleData,
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
  _resetStoreForTesting();
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
  assert.equal(isSampleData(), true);

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

test("submission history is explicit, filterable, and session writes stay marked non-persistent", async () => {
  const imported = getSubmissionHistory();
  assert.ok(imported.some((record) => record.source === "imported"));
  assert.ok(imported.every((record) => record.jobId && record.personId && record.submittedAt));

  const result = await recordCandidateSubmission("DEMO-JOB-ROBOTICS", "DEMO-PERSON-001", {
    client: "Synthetic Client",
    location: "Toronto, ON",
    submittedAt: "2026-11-02T08:00:00.000Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.persisted, false);
  assert.equal(result.submission.status, "Session only");

  const history = getSubmissionHistory();
  const sessionRecord = history.find((record) => record.personId === "DEMO-PERSON-001");
  assert.equal(sessionRecord.source, "session");
  assert.equal(sessionRecord.client, "Synthetic Client");

  const candidate = getCandidatesForJob("DEMO-JOB-ROBOTICS").find((item) => item.id === "DEMO-PERSON-001");
  assert.equal(candidate.isSubmitted, true);
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

test("candidate review labels sample data instead of claiming a live connection", () => {
  const source = fs.readFileSync(path.join(featureDir, "CandidateReview.jsx"), "utf8");
  assert.match(source, /Sample data only - sign in for live candidates/);
  assert.match(source, /isSampleData\(\)/);
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
