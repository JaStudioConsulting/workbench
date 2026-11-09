import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCandidateSearchEvidence,
  loadSearchEvidence,
} from "../src/features/search/searchEvidence.js";

const sameNameItems = [
  { entityType: "candidate", entityId: "submission:30", displayTitle: "Synthetic Same Name" },
  { entityType: "candidate", entityId: "sourcing:20", displayTitle: "Synthetic Same Name" },
  { entityType: "candidate", entityId: "manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayTitle: "Synthetic Manual" },
];
const candidateRows = [
  { id: "submission:30", current_title: "Senior Program Manager", role_context: null, location: "Toronto, ON", industry: "Manufacturing", notes: null },
  { id: "sourcing:20", current_title: "Project Coordinator", role_context: null, location: "Toronto, ON", industry: null, notes: null },
  { id: "manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", current_title: "Senior Program Manager", role_context: null, location: "Toronto, ON", industry: null, notes: null },
];
const presentationRows = [
  {
    id: "tracker_submissions:30", presentation_state: "confirmed", source: "tracker_submissions",
    source_id: 30, candidate_source: "submission", candidate_source_id: 30,
    client_name: "Synthetic Client A", job_id: null, job_title: "Program Manager",
    presented_on: "2026-11-05", queued_at: null, source_status: "Submitted",
  },
  {
    id: "candidate_review_actions:201", presentation_state: "pending", source: "candidate_review_actions",
    source_id: 201, candidate_source: "sourcing", candidate_source_id: 20,
    client_name: "Synthetic Client B", job_id: 501, job_title: "Program Manager",
    presented_on: null, queued_at: "2026-11-06T12:00:00Z", source_status: "Waiting for Loxo",
  },
  {
    id: "tracker_submissions:999", presentation_state: "confirmed", source: "tracker_submissions",
    source_id: 999, candidate_source: "submission", candidate_source_id: 999,
    candidate_name: "Synthetic Same Name", client_name: "Wrong Client", job_id: null,
    job_title: "Program Manager", presented_on: "2026-11-05", queued_at: null,
    source_status: "Hired",
  },
];
const jobRows = [
  { job_id: 501, job_title: "Senior Program Manager", company: "Synthetic Client A", location: "Toronto, ON", status: "Active" },
  { job_id: 502, job_title: "Senior Program Manager", company: "Closed Client", location: "Toronto, ON", status: "Closed" },
  { job_id: 503, job_title: "Senior Program Manager", company: "Outside Canada", location: "Chicago, IL", status: "Active" },
];

test("search evidence keeps same-name source IDs separate, pending actions unconfirmed, and open Canadian job reasons", () => {
  const confirmed = buildCandidateSearchEvidence(sameNameItems[0], { candidateRows, presentationRows, jobRows });
  assert.equal(confirmed.presentationStatus, "presented");
  assert.equal(confirmed.presentationLabel, "Presented to: Synthetic Client A");
  assert.equal(confirmed.pendingLabel, null);
  assert.equal(confirmed.matchesStatus, "loaded");
  assert.equal(confirmed.matches.length, 1);
  assert.equal(confirmed.matches[0].jobId, "501");
  assert.ok(["strong", "possible"].includes(confirmed.matches[0].level));
  assert.ok(confirmed.matches[0].reasons.length > 0);
  assert.equal(Object.hasOwn(confirmed.matches[0], "score"), false);

  const pending = buildCandidateSearchEvidence(sameNameItems[1], { candidateRows, presentationRows, jobRows });
  assert.equal(pending.presentationStatus, "pending");
  assert.equal(pending.presentationLabel, "No confirmed presentation on record");
  assert.equal(pending.pendingLabel, "Pending confirmation");
  assert.doesNotMatch(pending.presentationLabel, /Wrong Client|Synthetic Client A/);

  const manual = buildCandidateSearchEvidence(sameNameItems[2], { candidateRows, presentationRows, jobRows });
  assert.equal(manual.presentationStatus, "none");
  assert.equal(manual.presentationLabel, "No confirmed presentation on record");
});

test("missing candidate or failed source reads remain unavailable instead of claiming not presented", () => {
  const missing = buildCandidateSearchEvidence(sameNameItems[0], {
    candidateRows: [], presentationRows, jobRows,
  });
  assert.equal(missing.presentationStatus, "unavailable");
  assert.equal(missing.matchesStatus, "unavailable");

  const failedPresentations = buildCandidateSearchEvidence(sameNameItems[0], {
    candidateRows, presentationRows: [], jobRows, presentationsAvailable: false,
  });
  assert.equal(failedPresentations.presentationLabel, "Presentation history unavailable");
  assert.equal(failedPresentations.matchesStatus, "loaded");

  const failedJobs = buildCandidateSearchEvidence(sameNameItems[0], {
    candidateRows, presentationRows, jobRows: [], jobsAvailable: false,
  });
  assert.equal(failedJobs.matchesStatus, "unavailable");
  assert.equal(failedJobs.presentationStatus, "presented");
});

function fakeClient({ failTable = null } = {}) {
  const calls = [];
  const tables = {
    candidates_all: candidateRows,
    presentations: presentationRows,
    tracker_jobs: jobRows,
  };
  return {
    calls,
    from(table) {
      const filters = [];
      const query = {
        select(columns) { calls.push({ table, operation: "select", columns }); return this; },
        in(column, values) { filters.push([column, values]); calls.push({ table, operation: "in", column, values }); return this; },
        order() { return this; },
        limit() { return this; },
        range() { return this; },
        then(resolve, reject) {
          let rows = tables[table];
          for (const [column, values] of filters) rows = rows.filter((row) => values.map(String).includes(String(row[column])));
          return Promise.resolve(failTable === table
            ? { data: null, error: new Error("Unavailable") }
            : { data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test("evidence loader queries exact candidate IDs, filters source IDs, and isolates a failed view", async () => {
  const searchState = { groups: [{ key: "candidates", items: sameNameItems }] };
  const client = fakeClient();
  const evidence = await loadSearchEvidence(searchState, { client });
  assert.deepEqual(Object.keys(evidence).sort(), sameNameItems.map((item) => item.entityId).sort());
  assert.equal(evidence["submission:30"].presentationStatus, "presented");
  assert.equal(evidence["sourcing:20"].presentationStatus, "pending");
  assert.equal(evidence[sameNameItems[2].entityId].presentationStatus, "none");
  assert.deepEqual(
    client.calls.find((call) => call.table === "candidates_all" && call.column === "id").values,
    sameNameItems.map((item) => item.entityId),
  );
  assert.deepEqual(
    client.calls.find((call) => call.table === "presentations" && call.column === "candidate_source_id").values,
    [30, 20],
  );

  const failedView = await loadSearchEvidence(searchState, { client: fakeClient({ failTable: "presentations" }) });
  assert.equal(failedView["submission:30"].presentationStatus, "unavailable");
  assert.equal(failedView["submission:30"].matchesStatus, "loaded");
});
