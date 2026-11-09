import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDisplayGroups,
  formatSearchResultItem,
  resolveSearchNavigation,
} from "../src/features/search/searchClient.js";
import { loadSearchEvidence } from "../src/features/search/searchEvidence.js";

// Seeded page-level M3-06 fixtures. Every name, client, job and ID is synthetic.
const here = path.dirname(fileURLToPath(import.meta.url));
const consoleRoot = path.resolve(here, "..");

const SEEDED_SEARCH_RESPONSE = {
  query: "program manager",
  limit: 20,
  results: [
    {
      id: "candidate:submission:30",
      entity_type: "candidate",
      entity_id: "submission:30",
      title: "Synthetic Same Name",
      subtitle: "Senior Program Manager",
      company: "Adventure Works",
      location: "Toronto, ON",
      status: "submission",
      subject_type: null,
      subject_id: null,
      snippet: "Presented for launch role",
      updated_at: "2026-11-08T10:30:00.000Z",
      rank: 0.9,
    },
    {
      id: "candidate:sourcing:20",
      entity_type: "candidate",
      entity_id: "sourcing:20",
      title: "Synthetic Same Name",
      subtitle: "Project Coordinator",
      company: null,
      location: "Toronto, ON",
      status: "sourcing",
      subject_type: null,
      subject_id: null,
      snippet: null,
      updated_at: "2026-11-08T11:00:00.000Z",
      rank: 0.85,
    },
    {
      id: "client:apex tooling",
      entity_type: "client",
      entity_id: "Apex Tooling",
      title: "Apex Tooling",
      subtitle: null,
      company: "Apex Tooling",
      location: null,
      status: null,
      subject_type: null,
      subject_id: null,
      snippet: null,
      updated_at: "2026-11-08T07:00:00.000Z",
      rank: 0.7,
    },
    {
      id: "job:501",
      entity_type: "job",
      entity_id: "501",
      title: "Senior Program Manager",
      subtitle: null,
      company: null,
      location: null,
      status: null,
      subject_type: null,
      subject_id: null,
      snippet: null,
      updated_at: "2026-11-08T08:00:00.000Z",
      rank: 0.65,
    },
  ],
  groups: { candidates: [], leads: [], jobs: [], clients: [], notes: [] },
  candidates: [],
  leads: [],
  jobs: [],
  clients: [],
  notes: [],
};
SEEDED_SEARCH_RESPONSE.groups.candidates = SEEDED_SEARCH_RESPONSE.results.filter((item) => item.entity_type === "candidate");
SEEDED_SEARCH_RESPONSE.groups.clients = SEEDED_SEARCH_RESPONSE.results.filter((item) => item.entity_type === "client");
SEEDED_SEARCH_RESPONSE.groups.jobs = SEEDED_SEARCH_RESPONSE.results.filter((item) => item.entity_type === "job");
SEEDED_SEARCH_RESPONSE.candidates = SEEDED_SEARCH_RESPONSE.groups.candidates;
SEEDED_SEARCH_RESPONSE.clients = SEEDED_SEARCH_RESPONSE.groups.clients;
SEEDED_SEARCH_RESPONSE.jobs = SEEDED_SEARCH_RESPONSE.groups.jobs;

const CANDIDATE_ROWS = [
  { id: "submission:30", current_title: "Senior Program Manager", role_context: null, location: "Toronto, ON", industry: "Manufacturing", notes: null },
  { id: "sourcing:20", current_title: "Project Coordinator", role_context: null, location: "Toronto, ON", industry: null, notes: null },
  { id: "submission:31", current_title: "Senior Program Manager", role_context: null, location: "Hamilton, ON", industry: null, notes: null },
  { id: "submission:32", current_title: null, role_context: null, location: "Toronto, ON", industry: null, notes: null },
];

const PRESENTATION_ROWS = [
  // Confirmed presentation, exact source key submission:30.
  {
    id: "tracker_submissions:30", presentation_state: "confirmed", source: "tracker_submissions",
    source_id: 30, candidate_source: "submission", candidate_source_id: 30,
    client_name: "Synthetic Client A", job_id: null, job_title: "Senior Program Manager",
    presented_on: "2026-11-05", queued_at: null, source_status: "Submitted",
  },
  // Queued Workbench action waiting for Loxo, never a confirmed presentation.
  {
    id: "candidate_review_actions:201", presentation_state: "pending", source: "candidate_review_actions",
    source_id: 201, candidate_source: "sourcing", candidate_source_id: 20,
    client_name: "Synthetic Client B", job_id: 501, job_title: "Senior Program Manager",
    presented_on: null, queued_at: "2026-11-06T12:00:00Z", source_status: "Waiting for Loxo",
  },
  // Confirmed presentation with a blank client on the source record.
  {
    id: "tracker_submissions:31", presentation_state: "confirmed", source: "tracker_submissions",
    source_id: 31, candidate_source: "submission", candidate_source_id: 31,
    client_name: null, job_id: null, job_title: "Senior Program Manager",
    presented_on: "2026-11-04", queued_at: null, source_status: "Submitted",
  },
  // Decoy: same display name as submission:30 but a different source ID. Must never join.
  {
    id: "tracker_submissions:999", presentation_state: "confirmed", source: "tracker_submissions",
    source_id: 999, candidate_source: "submission", candidate_source_id: 999,
    candidate_name: "Synthetic Same Name", client_name: "Wrong Client", job_id: null,
    job_title: "Senior Program Manager", presented_on: "2026-11-05", queued_at: null,
    source_status: "Hired",
  },
];

const JOB_ROWS = [
  { job_id: 501, job_title: "Senior Program Manager", company: "Synthetic Client A", location: "Toronto, ON", status: "Active" },
  { job_id: 502, job_title: "Senior Program Manager", company: "Closed Client", location: "Toronto, ON", status: "Closed" },
  { job_id: 503, job_title: "Senior Program Manager", company: "Outside Canada", location: "Chicago, IL", status: "Active" },
];

function seededClient() {
  const tables = {
    candidates_all: CANDIDATE_ROWS,
    presentations: PRESENTATION_ROWS,
    tracker_jobs: JOB_ROWS,
  };
  return {
    from(table) {
      const filters = [];
      const query = {
        select() { return this; },
        in(column, values) { filters.push([column, values]); return this; },
        order() { return this; },
        limit() { return this; },
        range() { return this; },
        then(resolve, reject) {
          let rows = tables[table];
          for (const [column, values] of filters) {
            rows = rows.filter((row) => values.map(String).includes(String(row[column])));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function rawResult(entityType, entityId) {
  return SEEDED_SEARCH_RESPONSE.results.find(
    (item) => item.entity_type === entityType && item.entity_id === entityId,
  );
}

test("seeded search routes the person and company to their exact pages", () => {
  const groups = buildDisplayGroups(SEEDED_SEARCH_RESPONSE);
  assert.deepEqual(groups.map((group) => group.key), ["candidates", "leads", "jobs", "clients"]);

  // Person: two results share a display name, and each navigates by its own source key.
  const sameNameFirst = formatSearchResultItem(rawResult("candidate", "submission:30"));
  assert.equal(sameNameFirst.displayTitle, "Synthetic Same Name");
  const personNav = resolveSearchNavigation(rawResult("candidate", "submission:30"));
  assert.equal(personNav.page, "Candidates");
  assert.equal(personNav.focusCandidateId, "submission:30");
  assert.equal(personNav.candidateSource, "submission");
  assert.equal(personNav.candidateSourceId, "30");

  const samePersonNameOtherSource = resolveSearchNavigation(rawResult("candidate", "sourcing:20"));
  assert.equal(samePersonNameOtherSource.focusCandidateId, "sourcing:20");
  assert.notEqual(samePersonNameOtherSource.focusCandidateId, personNav.focusCandidateId);

  // Company: a client result lands on Leads with the client focus, and unknown fields stay null.
  const companyNav = resolveSearchNavigation(rawResult("client", "Apex Tooling"));
  assert.equal(companyNav.page, "Leads");
  assert.equal(companyNav.focusClientId, "Apex Tooling");
  assert.equal(companyNav.client.company, "Apex Tooling");
  assert.equal(companyNav.client.location, null);
  assert.equal(companyNav.client.clientContact, null);
});

test("seeded Leads page wires the focused company card and shows unknown fields as Not on file", () => {
  // LeadsPage server-renders its loading state before data loads, so the focus card is verified in source.
  const leadsSource = fs.readFileSync(
    path.join(consoleRoot, "src/features/leads/LeadsPage.jsx"),
    "utf8",
  );
  assert.match(leadsSource, /focusClient\?\.entityId && !state\.companies\.some/);
  assert.match(leadsSource, /focusClient\.jobTitles \|\| "Not on file"/);
  assert.match(leadsSource, /focusClient\.location \|\| "Not on file"/);
  assert.match(leadsSource, /focusClient\.clientContact \|\| "Not on file"/);

  const companyNav = resolveSearchNavigation(rawResult("client", "Apex Tooling"));
  assert.equal(companyNav.client.jobTitles, null);
  assert.equal(companyNav.client.clientContact, null);
  assert.doesNotMatch(JSON.stringify(companyNav), /Wrong Client|Synthetic Client A/);
});

test("seeded evidence separates confirmed presentations from queued actions and keeps blanks unknown", async () => {
  const searchState = {
    groups: [{
      key: "candidates",
      items: [
        { entityType: "candidate", entityId: "submission:30" },
        { entityType: "candidate", entityId: "sourcing:20" },
        { entityType: "candidate", entityId: "submission:31" },
        { entityType: "candidate", entityId: "submission:32" },
      ],
    }],
  };
  const evidence = await loadSearchEvidence(searchState, { client: seededClient() });

  // Confirmed presentation on the exact source key, with one top open Canadian job.
  const presented = evidence["submission:30"];
  assert.equal(presented.presentationStatus, "presented");
  assert.equal(presented.presentationLabel, "Presented to: Synthetic Client A");
  assert.equal(presented.pendingLabel, null);
  assert.equal(presented.matchesStatus, "loaded");
  assert.equal(presented.matches.length, 1);
  assert.equal(presented.matches[0].jobId, "501");
  assert.ok(presented.matches[0].reasons.length > 0);
  assert.equal(Object.hasOwn(presented.matches[0], "score"), false);
  assert.ok(!presented.matches.some((match) => match.jobId === "502" || match.jobId === "503"));

  // Queued Workbench action is pending, never reported as presented to Client B.
  const queued = evidence["sourcing:20"];
  assert.equal(queued.presentationStatus, "pending");
  assert.equal(queued.presentationLabel, "No confirmed presentation on record");
  assert.equal(queued.pendingLabel, "Pending confirmation");
  assert.doesNotMatch(queued.presentationLabel, /Synthetic Client B|Wrong Client/);

  // Confirmed presentation with a blank client stays unknown rather than naming a client.
  const blankClient = evidence["submission:31"];
  assert.equal(blankClient.presentationStatus, "presented");
  assert.equal(blankClient.presentationLabel, "Presented to: Client not recorded");
  assert.doesNotMatch(blankClient.presentationLabel, /Synthetic Client|Wrong Client/);

  // No title means the job match is ambiguous, so it stays unknown and is not shown as a match.
  const ambiguous = evidence["submission:32"];
  assert.equal(ambiguous.matchesStatus, "loaded");
  assert.deepEqual(ambiguous.matches, []);

  // Decoy row with the same display name never leaks into any candidate's evidence.
  assert.doesNotMatch(JSON.stringify(evidence), /Wrong Client/);
});

test("HeaderSearch source wires presentation, pending, and top match evidence into the candidate dropdown", () => {
  const headerSearchSource = fs.readFileSync(
    path.join(consoleRoot, "src/features/search/HeaderSearch.jsx"),
    "utf8",
  );
  assert.match(headerSearchSource, /candidateEvidence\.presentationLabel/);
  assert.match(headerSearchSource, /candidateEvidence\.pendingLabel/);
  assert.match(headerSearchSource, /candidateEvidence\.matches\.map/);
  assert.match(headerSearchSource, /data-testid="search-candidate-evidence"/);
});
