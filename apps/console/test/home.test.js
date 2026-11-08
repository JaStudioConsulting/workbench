import test from "node:test";
import assert from "node:assert/strict";
import { businessDaysSince, followUpsDue, groupWaitingActions } from "../src/features/home/homeService.js";

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
    { job_id: 1, candidate_source: "sourcing", candidate_source_id: 9, created_at: "2026-11-01" },
    { job_id: 1, candidate_source: "sourcing", candidate_source_id: 9, created_at: "2026-11-02" },
  ], [{ candidate_source: "sourcing", candidate_source_id: 9, candidate_name: "Candidate Example" }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].candidateName, "Candidate Example");
  assert.equal(groups[0].count, 2);
});

test("recent meetings label session-only drafts", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/features/home/HomePage.jsx", import.meta.url), "utf8");
  assert.match(source, /item\.persistence === "session_only"/);
  assert.match(source, /Session only - not synced/);
});
