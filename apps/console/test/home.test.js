import test from "node:test";
import assert from "node:assert/strict";
import { businessDaysSince, followUpsDue, groupWaitingActions, leadRemindersDue, latestReadyCaseDrafts, listMpcCandidates, loadHomeData, waitingAgeLabel } from "../src/features/home/homeService.js";
import { candidateReviewIdFromHomeItem } from "../src/features/home/homeNavigation.js";

test("business-day age excludes weekends", () => {
  assert.equal(businessDaysSince("2026-11-06T14:00:00Z", new Date("2026-11-11T14:00:00Z")), 3);
});

test("follow-ups remain due with unknown replies and still require three business days", () => {
  const outreach = [{ candidateEmail: "person@example.invalid", createdAt: "2026-11-02T14:00:00Z" }];
  const unknown = followUpsDue(outreach, { available: false, latestByEmail: {} }, new Date("2026-11-06T14:00:00Z"));
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].replyStatus, "unknown");
  assert.equal(followUpsDue(outreach, { available: false }, new Date("2026-11-04T14:00:00Z")).length, 0);
  assert.equal(followUpsDue(outreach, { available: true, latestByEmail: {} }, new Date("2026-11-06T14:00:00Z"))[0].replyStatus, "not_detected");
  assert.equal(followUpsDue(outreach, { available: true, latestByEmail: { "person@example.invalid": "2026-11-03T14:00:00Z" } }, new Date("2026-11-06T14:00:00Z")).length, 0);
});

test("outreach reminders do not treat old or unavailable reply data as a current reply", () => {
  const outreach = [{ candidateEmail: "Person@Example.Invalid", createdAt: "2026-11-02T14:00:00Z" }];
  const now = new Date("2026-11-06T14:00:00Z");
  const prior = { "person@example.invalid": "2026-10-30T14:00:00Z" };
  assert.equal(followUpsDue(outreach, { available: true, latestByEmail: prior }, now).length, 1);
  const stale = { "person@example.invalid": "2026-11-03T14:00:00Z" };
  assert.equal(followUpsDue(outreach, { available: false, latestByEmail: stale }, now)[0].replyStatus, "unknown");
  assert.equal(followUpsDue([{ ...outreach[0], candidateEmail: "" }], { available: true }, now)[0].replyStatus, "unknown");
});

test("business-day and lead due dates use Toronto calendar days across UTC and DST boundaries", () => {
  assert.equal(businessDaysSince("2026-10-30T23:00:00Z", new Date("2026-11-03T04:30:00Z")), 1);
  const leads = [
    { id: "tomorrow", next_date: "2026-11-07" },
    { id: "today", next_date: "2026-11-06" },
    { id: "past", next_date: "2026-11-05" },
    { id: "undated", next_date: null },
    { id: "invalid", next_date: "invalid" },
  ];
  assert.deepEqual(leadRemindersDue(leads, new Date("2026-11-07T02:00:00Z")).map((row) => row.id), ["past", "today"]);
  assert.deepEqual(leadRemindersDue(leads, new Date("2026-11-07T05:00:00Z")).map((row) => row.id), ["past", "today", "tomorrow"]);
});

test("ready outputs show latest human revisions without resurfacing superseded drafts", () => {
  const artifacts = [
    { id: "old-submission", case_id: "case-1", artifact_type: "candidate_submission", review_state: "draft", generated_by: "template_automation", created_at: "2026-11-05T12:00:00Z", content: { status: "ready" } },
    { id: "edited-submission", case_id: "case-1", artifact_type: "candidate_submission", review_state: "draft", generated_by: "human", created_at: "2026-11-06T12:00:00Z", content: { status: "ready" } },
    { id: "old-email", case_id: "case-1", artifact_type: "presentation_email", review_state: "draft", created_at: "2026-11-05T12:00:00Z" },
    { id: "approved-email", case_id: "case-1", artifact_type: "presentation_email", review_state: "approved", created_at: "2026-11-06T12:00:00Z" },
    { id: "missing-resume", case_id: "case-1", artifact_type: "branded_resume", review_state: "draft", created_at: "2026-11-06T12:00:00Z", content: { status: "needs_information" } },
    { id: "closed-case", case_id: "case-2", artifact_type: "candidate_submission", review_state: "draft", created_at: "2026-11-06T12:00:00Z" },
  ];
  const ready = latestReadyCaseDrafts(artifacts, [{ id: "case-1", title: "Saved candidate package" }]);
  assert.deepEqual(ready.map((row) => row.id), ["edited-submission"]);
  assert.equal(ready[0].title, "Saved candidate package");
});

test("Home loads saved outputs and reminders without contacting email services", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("External service must not be requested"); };
  const tables = [];
  const fixtures = {
    candidate_review_actions: [], candidate_review_feed: [],
    outreach_log: [{ id: "outreach-1", job_id: "job-1", person_id: "person-1", candidate_email: "person@example.invalid", created_at: "2026-11-02T14:00:00Z" }],
    operator_cases: [{ id: "case-1", title: "Saved candidate package", case_type: "automation", status: "ready_for_review" }],
    leads: [{ id: "lead-1", company: "Recorded company", next_date: "2026-11-06", next_action: "Call contact" }],
    case_artifacts: [{ id: "artifact-1", case_id: "case-1", artifact_type: "candidate_submission", review_state: "draft", created_at: "2026-11-06T12:00:00Z", status: "ready" }],
  };
  const client = {
    auth: { async getUser() { return { data: { user: { id: "owner-1" } }, error: null }; } },
    from(table) {
      tables.push(table);
      assert.ok(Object.hasOwn(fixtures, table), `Unexpected table ${table}`);
      const query = {
        select() { return this; }, eq() { return this; }, neq() { return this; }, order() { return this; }, limit() { return this; },
        lte(column, date) { assert.equal(column, "next_date"); assert.equal(date, "2026-11-06"); return this; },
        in(column, ids) { assert.equal(column, "case_id"); assert.deepEqual(ids, ["case-1"]); return this; },
        then(resolve) { resolve({ data: fixtures[table], error: null }); },
      };
      return query;
    },
  };
  try {
    const data = await loadHomeData({ client, now: new Date("2026-11-07T02:00:00Z") });
    assert.equal(fetchCalls, 0);
    assert.equal(data.followUps[0].replyStatus, "unknown");
    assert.equal(data.reminders[0].id, "lead-1");
    assert.equal(data.drafts[0].case_id, "case-1");
    assert.equal(tables.includes("review_drafts"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("waiting actions group by job and candidate", () => {
  const groups = groupWaitingActions([
    { id: 501, job_id: 1, candidate_source: "sourcing", candidate_source_id: 9, created_at: "2026-11-01", note: "First queued note" },
    { id: 502, job_id: 1, candidate_source: "sourcing", candidate_source_id: 9, created_at: "2026-11-02", note: "Second queued note" },
  ], [{ candidate_source: "sourcing", candidate_source_id: 9, candidate_name: "Candidate Example" }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].candidateName, "Candidate Example");
  assert.equal(groups[0].count, 2);
  assert.deepEqual(groups[0].actions.map((action) => action.id), [501, 502]);
  assert.equal(groups[0].actions[0].note, "First queued note");
});

test("waiting queue shows the age of the oldest exact action", () => {
  assert.equal(waitingAgeLabel("2026-11-10T12:00:00Z", new Date("2026-11-13T14:00:00Z")), "3d old");
});

test("Home candidate links use the Tracker source key before a different Loxo person ID", () => {
  assert.equal(candidateReviewIdFromHomeItem({ candidate_source: "sourcing", candidate_source_id: 9, person_id: 402 }), "sourcing:9");
  assert.equal(candidateReviewIdFromHomeItem({ person_id: 402 }), 402);
});

test("MPC candidate choices are unique source-linked live Tracker records", async () => {
  const query = {
    select(columns) { assert.match(columns, /candidate_source_id/); return this; },
    limit(count) { assert.equal(count, 5000); return this; },
    then(resolve) { resolve({ data: [
      { candidate_source: "sourcing", candidate_source_id: 17, candidate_name: "Candidate One" },
      { candidate_source: "sourcing", candidate_source_id: 17, candidate_name: "Candidate One", current_title: "Duplicated by another job" },
      { candidate_source: "legacy", candidate_source_id: 21, candidate_name: "Unsupported source" },
      { candidate_source: "submission", candidate_source_id: 0, candidate_name: "Invalid ID" },
      { candidate_source: "submission", candidate_source_id: 9007199254740992, candidate_name: "Unsafe ID" },
    ], error: null }); },
  };
  const candidates = await listMpcCandidates({ client: { from(table) { assert.equal(table, "candidate_review_feed"); return query; } } });
  assert.deepEqual(candidates.map((item) => item.id), ["sourcing:17"]);
  assert.equal(candidates[0].candidate_name, "Candidate One");
});

test("recent meetings label session-only drafts", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/features/home/HomePage.jsx", import.meta.url), "utf8");
  assert.match(source, /item\.persistence === "session_only"/);
  assert.match(source, /Session only - not synced/);
});

test("Home remains the only approval desk entry surface", async () => {
  const fs = await import("node:fs/promises");
  const [home, app] = await Promise.all([
    fs.readFile(new URL("../src/features/home/HomePage.jsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /Approval desk/);
  assert.match(home, /OperatorCaseWorkspace/);
  assert.match(home, /openDailyCaseFromReviewAction/);
  assert.match(home, /selectedWaiting\.actions\.map/);
  assert.doesNotMatch(app, /\["Approval desk"/);
});
