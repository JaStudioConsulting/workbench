import test from "node:test";
import assert from "node:assert/strict";
import { businessDaysSince, followUpsDue, groupWaitingActions, listMpcCandidates, waitingAgeLabel } from "../src/features/home/homeService.js";
import { candidateReviewIdFromHomeItem } from "../src/features/home/homeNavigation.js";

test("business-day age excludes weekends", () => {
  assert.equal(businessDaysSince("2026-11-06T14:00:00Z", new Date("2026-11-11T14:00:00Z")), 3);
});

test("follow-ups require known reply status and three business days", () => {
  const outreach = [{ candidateEmail: "person@example.invalid", createdAt: "2026-11-02T14:00:00Z" }];
  assert.equal(followUpsDue(outreach, { available: false, latestByEmail: {} }, new Date("2026-11-06T14:00:00Z")).length, 0);
  assert.equal(followUpsDue(outreach, { available: true, latestByEmail: {} }, new Date("2026-11-06T14:00:00Z")).length, 1);
  assert.equal(followUpsDue(outreach, { available: true, latestByEmail: { "person@example.invalid": "2026-11-03T14:00:00Z" } }, new Date("2026-11-06T14:00:00Z")).length, 0);
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
