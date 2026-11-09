import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NOTES_SEARCH_GROUP,
  PRIMARY_SEARCH_GROUPS,
  buildDisplayGroups,
  formatResultMetadata,
  formatSearchResultItem,
  getCallerSearchAccessToken,
  isDisallowedSearchToken,
  resolveSearchNavigation,
  runWorkbenchSearch,
  searchWorkbench,
} from "../src/features/search/searchClient.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const consoleRoot = path.resolve(here, "..");

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createMockSupabaseClient({ accessToken = "supabase-access-token-123", error = null } = {}) {
  return {
    auth: {
      async getSession() {
        if (error) return { data: { session: null }, error };
        if (!accessToken) return { data: { session: null }, error: null };
        return {
          data: {
            session: {
              access_token: accessToken,
            },
          },
          error: null,
        };
      },
    },
  };
}

const SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES = {
  query: "program manager",
  limit: 20,
  results: [
    {
      id: "candidate:tracker_candidates:10",
      entity_type: "candidate",
      entity_id: "tracker_candidates:10",
      title: "Synthetic Candidate Alpha",
      subtitle: "Senior Program Manager",
      company: "Northwind Parts",
      location: "Guelph, ON",
      status: "tracker_candidates",
      subject_type: null,
      subject_id: null,
      snippet: "Automotive launches",
      updated_at: "2026-11-08T12:00:00.000Z",
      rank: 0.9,
    },
    {
      id: "candidate:sourcing:20",
      entity_type: "candidate",
      entity_id: "sourcing:20",
      title: null,
      subtitle: "Program Manager",
      company: null,
      location: null,
      status: "sourcing",
      subject_type: null,
      subject_id: null,
      snippet: null,
      updated_at: "2026-11-08T11:00:00.000Z",
      rank: 0.85,
    },
    {
      id: "candidate:submission:30",
      entity_type: "candidate",
      entity_id: "submission:30",
      title: "Synthetic Submitted Epsilon",
      subtitle: "Engineering Lead",
      company: "Adventure Works",
      location: "Hamilton, ON",
      status: "submission",
      subject_type: null,
      subject_id: null,
      snippet: "Presented for launch role",
      updated_at: "2026-11-08T10:30:00.000Z",
      rank: 0.82,
    },
    {
      id: "candidate:manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      entity_type: "candidate",
      entity_id: "manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Synthetic Manual Delta",
      subtitle: "Technical Program Manager",
      company: "Boreal Systems",
      location: "Waterloo, ON",
      status: "manual",
      subject_type: null,
      subject_id: null,
      snippet: "Added in Workbench",
      updated_at: "2026-11-08T10:00:00.000Z",
      rank: 0.8,
    },
    {
      id: "lead:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      entity_type: "lead",
      entity_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Huron Mobility",
      subtitle: "Program Manager",
      company: "Huron Mobility",
      location: null,
      status: "Warm",
      subject_type: null,
      subject_id: null,
      snippet: "Send terms",
      updated_at: "2026-11-08T09:00:00.000Z",
      rank: 0.75,
    },
    {
      id: "job:501",
      entity_type: "job",
      entity_id: "501",
      title: "Program Manager",
      subtitle: null,
      company: null,
      location: null,
      status: null,
      subject_type: null,
      subject_id: null,
      snippet: null,
      updated_at: "2026-11-08T08:00:00.000Z",
      rank: 0.7,
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
      rank: 0.65,
    },
  ],
  groups: {
    candidates: [],
    leads: [],
    jobs: [],
    clients: [],
    notes: [],
  },
  candidates: [],
  leads: [],
  jobs: [],
  clients: [],
  notes: [],
};

for (const key of ["candidates", "leads", "jobs", "clients", "notes"]) {
  const entityType = key.slice(0, -1);
  const matching = SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES.results.filter(
    (item) => item.entity_type === entityType,
  );
  SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES[key] = matching;
  SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES.groups[key] = matching;
}

test("searchWorkbench forwards caller Supabase access token to GET /api/search and validates SearchResponseSchema", async () => {
  const calls = [];
  const client = createMockSupabaseClient({ accessToken: "caller-jwt-token-abc" });
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse(200, SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES);
  };

  const result = await searchWorkbench("  program manager  ", {
    limit: 20,
    client,
    fetchImpl,
    baseURL: "https://workbench.test",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://workbench.test/api/search?q=program+manager&limit=20");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer caller-jwt-token-abc");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.equal(result.query, "program manager");
  assert.equal(result.candidates.length, 4);
  assert.equal(result.leads.length, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.clients.length, 1);
  assert.equal(result.notes.length, 0);
});

test("runWorkbenchSearch returns idle for blank queries without making network calls", async () => {
  let called = false;
  const state = await runWorkbenchSearch("   ", {
    fetchImpl: async () => {
      called = true;
      throw new Error("Should not be called");
    },
  });
  assert.equal(called, false);
  assert.equal(state.phase, "idle");
  assert.equal(state.query, "");
  assert.equal(state.totalCount, 0);
  assert.deepEqual(state.groups, []);
});

test("runWorkbenchSearch surfaces auth_error when signed out or when gateway returns 401/403, and blocks privileged tokens", async () => {
  let networkCalls = 0;
  const signedOutClient = createMockSupabaseClient({ accessToken: null });
  const signedOutState = await runWorkbenchSearch("program manager", {
    client: signedOutClient,
    fetchImpl: async () => {
      networkCalls += 1;
      return jsonResponse(200, SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES);
    },
  });
  assert.equal(networkCalls, 0);
  assert.equal(signedOutState.phase, "auth_error");
  assert.equal(signedOutState.error.code, "UNAUTHORIZED");

  // Disallowed privileged key is rejected before network call
  const privilegedJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ role: "supabase_admin" })).toString("base64url")}.sig`;
  assert.equal(isDisallowedSearchToken(privilegedJwt), true);
  await assert.rejects(
    () => getCallerSearchAccessToken({ client: createMockSupabaseClient({ accessToken: privilegedJwt }) }),
    (error) => error.phase === "auth_error" && error.code === "FORBIDDEN",
  );

  // Gateway 401 UNAUTHORIZED
  const unauthorizedState = await runWorkbenchSearch("program manager", {
    client: createMockSupabaseClient({ accessToken: "expired-token" }),
    fetchImpl: async () =>
      jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Supabase session is invalid or expired" },
      }),
    baseURL: "https://workbench.test",
  });
  assert.equal(unauthorizedState.phase, "auth_error");
  assert.equal(unauthorizedState.error.code, "UNAUTHORIZED");
  assert.match(unauthorizedState.error.message, /invalid or expired/i);

  // Gateway 403 FORBIDDEN
  const forbiddenState = await runWorkbenchSearch("program manager", {
    client: createMockSupabaseClient({ accessToken: "unapproved-user-token" }),
    fetchImpl: async () =>
      jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "This account is not authorized for Workbench search" },
      }),
    baseURL: "https://workbench.test",
  });
  assert.equal(forbiddenState.phase, "auth_error");
  assert.equal(forbiddenState.error.code, "FORBIDDEN");
  assert.match(forbiddenState.error.message, /not authorized/i);
});

test("runWorkbenchSearch surfaces migration_required state when gateway returns 503 SEARCH_MIGRATION_REQUIRED", async () => {
  const migrationState = await runWorkbenchSearch("program manager", {
    client: createMockSupabaseClient({ accessToken: "valid-token" }),
    fetchImpl: async () =>
      jsonResponse(503, {
        error: {
          code: "SEARCH_MIGRATION_REQUIRED",
          message: "Full-text search migration 021_fulltext_search.sql is not applied (missing public.search_workbench)",
        },
      }),
    baseURL: "https://workbench.test",
  });

  assert.equal(migrationState.phase, "migration_required");
  assert.equal(migrationState.error.code, "SEARCH_MIGRATION_REQUIRED");
  assert.equal(migrationState.error.status, 503);
  assert.match(migrationState.error.message, /021_fulltext_search\.sql|search_workbench/);
});

test("runWorkbenchSearch returns honest empty state with all four primary groups when zero matches exist", async () => {
  const emptyPayload = {
    query: "nonexistent role",
    limit: 20,
    results: [],
    groups: {
      candidates: [],
      leads: [],
      jobs: [],
      clients: [],
      notes: [],
    },
    candidates: [],
    leads: [],
    jobs: [],
    clients: [],
    notes: [],
  };

  const emptyState = await runWorkbenchSearch("nonexistent role", {
    client: createMockSupabaseClient({ accessToken: "valid-token" }),
    fetchImpl: async () => jsonResponse(200, emptyPayload),
    baseURL: "https://workbench.test",
  });

  assert.equal(emptyState.phase, "empty");
  assert.equal(emptyState.totalCount, 0);
  assert.deepEqual(
    emptyState.groups.map((group) => group.label),
    ["Candidates", "Leads", "Jobs", "Clients"],
  );
  for (const group of emptyState.groups) {
    assert.equal(group.items.length, 0);
  }
});

test("buildDisplayGroups always includes Candidates, Leads, Jobs, Clients and includes Notes only when note results exist", () => {
  assert.equal(PRIMARY_SEARCH_GROUPS.length, 4);
  assert.equal(NOTES_SEARCH_GROUP.key, "notes");

  const withoutNotes = buildDisplayGroups(SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES);
  assert.deepEqual(
    withoutNotes.map((group) => group.key),
    ["candidates", "leads", "jobs", "clients"],
  );

  const noteItem = {
    id: "note:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    entity_type: "note",
    entity_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    title: null,
    subtitle: "candidate",
    company: null,
    location: null,
    status: null,
    subject_type: "candidate",
    subject_id: "tracker_candidates:10",
    snippet: "Program manager candidate ready for client presentation.",
    updated_at: "2026-11-08T12:30:00.000Z",
    rank: 0.95,
  };

  const withNotes = buildDisplayGroups({
    ...SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES,
    results: [...SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES.results, noteItem],
    notes: [noteItem],
    groups: {
      ...SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES.groups,
      notes: [noteItem],
    },
  });

  assert.deepEqual(
    withNotes.map((group) => group.key),
    ["candidates", "leads", "jobs", "clients", "notes"],
  );
  assert.equal(withNotes[4].items[0].entityId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  assert.equal(withNotes[4].items[0].subjectType, "candidate");
  assert.equal(withNotes[4].items[0].subjectId, "tracker_candidates:10");
});

test("formatSearchResultItem and resolveSearchNavigation preserve source IDs and keep unknown client/job fields null", () => {
  // 1. Candidate across all 4 source kinds
  const sourcedRaw = SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES.candidates.find(
    (item) => item.entity_id === "sourcing:20",
  );
  const sourcedFormatted = formatSearchResultItem(sourcedRaw);
  assert.equal(sourcedFormatted.id, "candidate:sourcing:20");
  assert.equal(sourcedFormatted.entityId, "sourcing:20");
  assert.equal(sourcedFormatted.candidateSource, "sourcing");
  assert.equal(sourcedFormatted.candidateSourceId, "20");
  assert.equal(sourcedFormatted.sourceLabel, "Sourcing");
  assert.equal(sourcedFormatted.title, null);
  assert.equal(sourcedFormatted.displayTitle, "Unnamed candidate");
  assert.equal(sourcedFormatted.company, null);
  assert.equal(sourcedFormatted.location, null);

  const sourcedNav = resolveSearchNavigation(sourcedRaw);
  assert.deepEqual(sourcedNav, {
    page: "Candidates",
    entityType: "candidate",
    id: "candidate:sourcing:20",
    entityId: "sourcing:20",
    candidateSource: "sourcing",
    candidateSourceId: "20",
    trackerSource: "tracker_sourcing",
    isManual: false,
    focusCandidateId: "sourcing:20",
  });

  const manualRaw = SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES.candidates.find(
    (item) => item.entity_id === "manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  const manualNav = resolveSearchNavigation(manualRaw);
  assert.equal(manualNav.page, "Candidates");
  assert.equal(manualNav.focusCandidateId, "manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(manualNav.isManual, true);
  assert.equal(manualNav.trackerSource, null);

  // 2. Job with unknown (null) company, location, status, and description
  const jobRaw = SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES.jobs[0];
  const jobFormatted = formatSearchResultItem(jobRaw);
  assert.equal(jobFormatted.entityId, "501");
  assert.equal(jobFormatted.company, null);
  assert.equal(jobFormatted.location, null);
  assert.equal(jobFormatted.status, null);
  assert.equal(jobFormatted.snippet, null);
  assert.equal(formatResultMetadata(jobFormatted), "Company unknown · Location unknown");

  const jobNav = resolveSearchNavigation(jobRaw);
  assert.deepEqual(jobNav, {
    page: "Jobs",
    entityType: "job",
    id: "job:501",
    entityId: "501",
    focusJobId: "501",
    job: {
      id: "501",
      loxoJobId: "501",
      title: "Program Manager",
      company: null,
      location: null,
      status: null,
      description: null,
    },
  });

  // 3. Client with unknown (null) job titles, location, status, and client contact
  const clientRaw = SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES.clients[0];
  const clientFormatted = formatSearchResultItem(clientRaw);
  assert.equal(clientFormatted.id, "client:apex tooling");
  assert.equal(clientFormatted.entityId, "Apex Tooling");
  assert.equal(clientFormatted.subtitle, null);
  assert.equal(clientFormatted.location, null);
  assert.equal(clientFormatted.status, null);
  assert.equal(clientFormatted.snippet, null);
  assert.equal(formatResultMetadata(clientFormatted), "Roles unknown · Location unknown");

  const clientNav = resolveSearchNavigation(clientRaw);
  assert.deepEqual(clientNav, {
    page: "Leads",
    entityType: "client",
    id: "client:apex tooling",
    entityId: "Apex Tooling",
    focusClientId: "Apex Tooling",
    client: {
      id: "client:apex tooling",
      entityId: "Apex Tooling",
      company: "Apex Tooling",
      jobTitles: null,
      location: null,
      status: null,
      clientContact: null,
    },
  });

  // 4. Lead navigation
  const leadRaw = SAMPLE_SEARCH_RESPONSE_WITHOUT_NOTES.leads[0];
  const leadNav = resolveSearchNavigation(leadRaw);
  assert.deepEqual(leadNav, {
    page: "Leads",
    entityType: "lead",
    id: "lead:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    entityId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    focusLeadId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });

  // 5. Note navigation to linked candidate, job, meeting, or unlinked
  assert.deepEqual(
    resolveSearchNavigation({
      id: "note:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      entity_type: "note",
      entity_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      subject_type: "candidate",
      subject_id: "tracker_candidates:10",
    }),
    {
      page: "Candidates",
      entityType: "note",
      id: "note:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      entityId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      subjectType: "candidate",
      subjectId: "tracker_candidates:10",
      focusCandidateId: "tracker_candidates:10",
      focusNoteId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    },
  );

  assert.deepEqual(
    resolveSearchNavigation({
      id: "note:11111111-2222-4333-8444-555555555555",
      entity_type: "note",
      entity_id: "11111111-2222-4333-8444-555555555555",
      subject_type: null,
      subject_id: null,
    }),
    {
      page: null,
      entityType: "note",
      id: "note:11111111-2222-4333-8444-555555555555",
      entityId: "11111111-2222-4333-8444-555555555555",
      subjectType: null,
      subjectId: null,
      focusNoteId: "11111111-2222-4333-8444-555555555555",
    },
  );
});

test("HeaderSearch and App wire Cmd+K, cmdk groups, accessible states, responsive layout, and zero-purple design", () => {
  const appSource = fs.readFileSync(path.join(consoleRoot, "src/App.jsx"), "utf8");
  const headerSearchSource = fs.readFileSync(
    path.join(consoleRoot, "src/features/search/HeaderSearch.jsx"),
    "utf8",
  );
  const searchClientSource = fs.readFileSync(
    path.join(consoleRoot, "src/features/search/searchClient.js"),
    "utf8",
  );
  const combinedSearchSource = `${headerSearchSource}\n${searchClientSource}`;

  // App header mounts HeaderSearch and wires navigation
  assert.match(appSource, /<HeaderSearch onSelectResult=\{navigateFromSearch\} onNavigatePage=\{selectPage\} \/>/);
  assert.match(appSource, /focusLeadId=\{focusLeadId\} focusClient=\{focusClient\}/);

  // Uses cmdk primitives with shouldFilter={false} and Cmd+K / Ctrl+K shortcut
  assert.match(headerSearchSource, /shouldFilter=\{false\}/);
  assert.match(headerSearchSource, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(headerSearchSource, /⌘K/);
  assert.match(headerSearchSource, /CommandGroup/);
  assert.match(headerSearchSource, /CommandItem/);
  assert.match(headerSearchSource, /CommandInput/);
  assert.match(headerSearchSource, /CommandList/);

  // Includes loading, empty, auth_error, migration_required, and error states with ARIA roles
  assert.match(headerSearchSource, /data-testid="search-loading-state"/);
  assert.match(headerSearchSource, /data-testid="search-empty-state"/);
  assert.match(headerSearchSource, /data-testid="search-auth-error"/);
  assert.match(headerSearchSource, /data-testid="search-migration-required"/);
  assert.match(headerSearchSource, /data-testid="search-error"/);
  assert.match(headerSearchSource, /role="search"/);

  // Small screen responsiveness
  assert.match(headerSearchSource, /w-full min-w-0 sm:w-64/);
  assert.match(headerSearchSource, /max-w-\[calc\(100vw-2rem\)\]/);

  // Zero purple, zero forbidden punctuation, zero browser storage or fake fallback data
  assert.doesNotMatch(combinedSearchSource, /purple|violet|indigo|fuchsia|#6b4ea8/i);
  assert.doesNotMatch(combinedSearchSource, /—|–|~/);
  assert.doesNotMatch(combinedSearchSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(combinedSearchSource, /SAMPLE_JOBS|SAMPLE_CANDIDATES|INITIAL_JOBS_DATA/);
});
