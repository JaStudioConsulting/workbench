import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProcessSummary, hasCandidateProfileData, loadJobRailData, loadProcessData } from "../src/features/recruiting/processService.js";

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

test("process summary keeps active jobs honest when candidate stages are unavailable", () => {
  const summary = buildProcessSummary({
    jobs: [{ job_id: 10, job_title: "Plant Manager", company: "Example Industries", status: "Active" }],
    candidates: [],
    actions: [],
    candidateDataAvailable: false,
  });
  assert.equal(summary.candidateDataAvailable, false);
  assert.equal(summary.jobs[0].candidateCount, null);
  assert.deepEqual(summary.jobs[0].stageCounts, {});
  assert.deepEqual(summary.blocked, []);
});

test("job rail loads active jobs without downloading candidate or action records", async () => {
  const tables = [];
  const client = {
    from(table) {
      tables.push(table);
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() {
          return Promise.resolve({
            data: [{ job_id: 10, job_title: "Plant Manager", company: "Example Industries", status: "Active" }],
            error: null,
          });
        },
      };
      return builder;
    },
  };

  const summary = await loadJobRailData(client);
  assert.deepEqual(tables, ["tracker_jobs"]);
  assert.equal(summary.jobs.length, 1);
  assert.equal(summary.candidateDataAvailable, false);
  assert.deepEqual(summary.jobs[0].stageCounts, {});
});

test("profile evidence prevents a false missing-source block", () => {
  assert.equal(hasCandidateProfileData({ profile_url: "https://example.invalid/profile" }), true);
  assert.equal(hasCandidateProfileData({ current_title: "Controller" }), true);
  assert.equal(hasCandidateProfileData({}), false);
});

test("resume text alone prevents a missing-source block", () => {
  const summary = buildProcessSummary({
    jobs: [{ job_id: 10, job_title: "Plant Manager", company: "Example Industries", status: "Active" }],
    candidates: [{ job_id: 10, candidate_source: "sourcing", candidate_source_id: 1, resume_text: "Resume text" }],
    actions: [],
  });
  assert.equal(summary.blocked.some((item) => item.type === "missing_source"), false);
});

test("stage counts select only job_id and stage and dedupe between JobRail and ProcessPage", async () => {
  const selected = [];
  let stageCountCalls = 0;
  const client = {
    from(table) {
      let selectedColumns = "";
      const result = table === "tracker_jobs"
        ? { data: [{ job_id: 5, job_title: "Role", company: "Client", status: "Active" }], error: null }
          : table === "candidate_review_feed"
          ? null
          : { data: [], error: null };
      const query = {
        select(columns) {
          selectedColumns = columns;
          selected.push([table, columns]);
          if (table === "candidate_review_feed" && columns === "job_id,stage") stageCountCalls += 1;
          return query;
        },
        eq() { return query; },
        order() { return query; },
        limit() { return query; },
        then(resolve, reject) {
          const resolved = table === "candidate_review_feed"
            ? { data: selectedColumns.includes("candidate_source") ? [{ job_id: 5, stage: "Applied", candidate_source: "sourcing", candidate_source_id: 2 }] : [{ job_id: 5, stage: "Applied" }], error: null }
            : result;
          return Promise.resolve(resolved).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const [railData, processData] = await Promise.all([
    loadJobRailData(client),
    loadProcessData(client),
  ]);
  assert.equal(stageCountCalls, 1);
  assert.deepEqual(selected.find(([table]) => table === "candidate_review_feed"), ["candidate_review_feed", "job_id,stage"]);
  assert.ok(selected.some(([table, columns]) => table === "candidate_review_feed" && columns === "job_id,stage,candidate_source,candidate_source_id,candidate_name,resume_text,profile_url,profile_summary,fit_evidence,current_title,current_company"));
  assert.deepEqual(selected.filter(([table]) => table === "tracker_jobs").length, 2);
  assert.equal(railData.jobs[0].candidateCount, null);
  assert.deepEqual(railData.jobs[0].stageCounts, {});
  assert.equal(processData.jobs[0].candidateCount, 1);
  assert.equal(processData.jobs[0].stageCounts.Applied, 1);
  const rail = fs.readFileSync(path.resolve(root, "src/features/workbench/JobRail.jsx"), "utf8");
  const page = fs.readFileSync(path.resolve(root, "src/features/recruiting/ProcessPage.jsx"), "utf8");
  assert.match(rail, /loadJobRailData\(/);
  assert.match(page, /loadProcessData\(/);
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
