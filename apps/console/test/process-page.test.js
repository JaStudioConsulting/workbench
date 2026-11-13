import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProcessSummary, hasCandidateProfileData } from "../src/features/recruiting/processService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("process summary counts real stages per active job", () => {
  const summary = buildProcessSummary({
    jobs: [
      { job_id: 10, job_title: "Plant Manager", company: "Example Industries", status: "Active" },
      { job_id: 20, job_title: "Closed role", company: "Example Industries", status: "Closed" },
    ],
    candidates: [
      { job_id: 10, candidate_source: "sourcing", candidate_source_id: 1, stage: "Applied", resume_text: "Resume" },
      { job_id: 10, candidate_source: "sourcing", candidate_source_id: 2, stage: "Submitted", profile_summary: "Profile" },
      { job_id: 20, candidate_source: "sourcing", candidate_source_id: 3, stage: "Hired", resume_text: "Resume" },
    ],
    actions: [],
  });

  assert.equal(summary.jobs.length, 1);
  assert.equal(summary.jobs[0].candidateCount, 2);
  assert.equal(summary.jobs[0].stageCounts.Applied, 1);
  assert.equal(summary.jobs[0].stageCounts.Submitted, 1);
  assert.equal(summary.jobs[0].stageCounts.Hired, 0);
});

test("process summary reports each specified blocked condition", () => {
  const now = new Date("2026-11-07T12:00:00.000Z");
  const summary = buildProcessSummary({
    jobs: [
      { job_id: 10, job_title: "Plant Manager", company: "Example Industries", status: "Active" },
      { job_id: 11, job_title: "Controller", company: "Example Holdings", status: "Active" },
    ],
    candidates: [{
      job_id: 10,
      candidate_source: "sourcing",
      candidate_source_id: 1,
      candidate_name: "Candidate One",
      stage: "Applied",
    }],
    actions: [{
      id: 4,
      job_id: 10,
      candidate_source: "sourcing",
      candidate_source_id: 1,
      status: "waiting_for_loxo",
      created_at: "2026-11-04T11:00:00.000Z",
    }],
  }, now);

  assert.deepEqual(summary.blocked.map((item) => item.type).sort(), [
    "empty_job",
    "missing_source",
    "waiting_action",
  ]);
  assert.ok(summary.blocked.every((item) => !item.label.includes("undefined")));
});

test("profile evidence prevents a false missing-source block", () => {
  assert.equal(hasCandidateProfileData({ profile_url: "https://example.invalid/profile" }), true);
  assert.equal(hasCandidateProfileData({ current_title: "Controller" }), true);
  assert.equal(hasCandidateProfileData({}), false);
});

test("Process shows live records and keeps case history behind its existing flag", () => {
  const source = fs.readFileSync(path.join(root, "src/features/recruiting/RecruitingWorkspace.jsx"), "utf8");
  const page = fs.readFileSync(path.join(root, "src/features/recruiting/ProcessPage.jsx"), "utf8");

  assert.match(source, /if \(page === "Process"\) return <ProcessPage \/>/);
  assert.doesNotMatch(source, /generateRecruitingDrafts|DEMO_SF_JOBS_HIERARCHY|ApprovalCard|DraftViews/);
  assert.match(source, /JobsMapView/);
  assert.match(page, /Loading live process data/);
  assert.match(page, /No active Tracker jobs/);
  assert.match(page, /role="alert"/);
  assert.match(page, /operatorCasesEnabled \? <Card data-testid="process-case-history">/);
  assert.match(page, /listOperatorCases\(\)/);
});
