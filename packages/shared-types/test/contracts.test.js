import assert from "node:assert/strict";
import test from "node:test";
import {
  CandidateCreateRequestSchema,
  CandidateEditRequestSchema,
  CandidateIdSchema,
  CandidateInputSchema,
  CandidateListQuerySchema,
  CandidateRecordSchema,
  ErrorEnvelopeSchema,
  GoogleCalendarUpcomingSchema,
  GoogleWorkspaceStartSchema,
  GoogleWorkspaceStatusSchema,
  GoogleWorkspaceSyncResponseSchema,
  ManualCandidateEditsSchema,
  McpDiscoverySchema,
  TrackerCandidateEditsSchema,
  parseCandidateSourceKey,
} from "../src/index.js";

test("shared contracts reject unsupported workflow input and standalone skills", () => {
  assert.throws(() => CandidateInputSchema.parse({ name: "A", title: "B", resumeText: "", jobDescription: "C" }));
  assert.throws(() => McpDiscoverySchema.parse({ frontDoor: "resume", tools: [] }));
  assert.deepEqual(ErrorEnvelopeSchema.parse({ error: { code: "UNAVAILABLE", message: "Not configured" } }).error.code, "UNAVAILABLE");
});

test("Google Workspace contracts expose connection state but reject credentials", () => {
  assert.equal(GoogleWorkspaceStartSchema.parse({ authorizationUrl: "https://accounts.example/authorize", expiresAt: "2026-08-31T12:00:00.000Z" }).authorizationUrl, "https://accounts.example/authorize");
  assert.deepEqual(GoogleWorkspaceStatusSchema.parse({ connected: false }), { connected: false });
  assert.deepEqual(GoogleWorkspaceStatusSchema.parse({ connected: true, account: { email: "review@example.invalid" }, scopes: ["https://www.googleapis.com/auth/calendar.readonly"] }).connected, true);
  assert.throws(() => GoogleWorkspaceStatusSchema.parse({ connected: true, account: { email: "review@example.invalid" }, scopes: [], refreshToken: "forbidden" }));
  assert.deepEqual(GoogleCalendarUpcomingSchema.parse({ connected: true, range: { from: "2026-08-31T12:00:00.000Z", to: "2026-09-30T12:00:00.000Z" }, events: [] }).events, []);
  assert.throws(() => GoogleCalendarUpcomingSchema.parse({ connected: true, range: { from: "2026-08-31T12:00:00.000Z", to: "2026-09-30T12:00:00.000Z" }, events: [], refreshToken: "forbidden" }));
});

test("Google sync contract bounds Sheets rows to 50 cells", () => {
  const row = Array.from({ length: 50 }, (_, index) => String(index));
  assert.equal(GoogleWorkspaceSyncResponseSchema.parse({ service: "sheets", spreadsheetId: "tracker", range: "A1:AX1", rows: [row] }).rows[0].length, 50);
  assert.throws(() => GoogleWorkspaceSyncResponseSchema.parse({ service: "sheets", spreadsheetId: "tracker", range: "A1:AY1", rows: [[...row, "51"]] }));
});

test("candidate source keys enforce documented source prefixes and IDs", () => {
  assert.equal(CandidateIdSchema.parse("tracker_candidates:1"), "tracker_candidates:1");
  assert.equal(CandidateIdSchema.parse("sourcing:42"), "sourcing:42");
  assert.equal(CandidateIdSchema.parse("submission:109"), "submission:109");
  assert.equal(
    CandidateIdSchema.parse("manual:11111111-1111-4111-8111-111111111111"),
    "manual:11111111-1111-4111-8111-111111111111",
  );
  assert.equal(parseCandidateSourceKey("sourcing:42")?.tracker_source, "tracker_sourcing");
  assert.equal(parseCandidateSourceKey("submission:42")?.tracker_source, "tracker_submissions");
  assert.equal(parseCandidateSourceKey("tracker_candidates:42")?.tracker_source, "tracker_candidates");
  assert.equal(parseCandidateSourceKey("manual:11111111-1111-4111-8111-111111111111")?.tracker_source, null);

  assert.throws(() => CandidateIdSchema.parse("unknown:1"));
  assert.throws(() => CandidateIdSchema.parse("tracker_sourcing:1"));
  assert.throws(() => CandidateIdSchema.parse("sourcing:0"));
  assert.throws(() => CandidateIdSchema.parse("sourcing:-4"));
  assert.throws(() => CandidateIdSchema.parse("sourcing:not-a-number"));
  assert.throws(() => CandidateIdSchema.parse("manual:123"));
  assert.throws(() => CandidateIdSchema.parse("manual:synthetic-better-auth-id"));
});

test("candidate create and edit contracts validate fields and forbid owner/provenance overrides", () => {
  const created = CandidateCreateRequestSchema.parse({
    candidate_name: "  Alex Martin  ",
    current_title: " Plant Manager ",
    email: "  ALEX@EXAMPLE.INVALID ",
    notes: null,
  });
  assert.equal(created.candidate_name, "Alex Martin");
  assert.equal(created.current_title, "Plant Manager");
  assert.equal(created.email, "alex@example.invalid");
  assert.equal(created.notes, null);

  assert.throws(() => CandidateCreateRequestSchema.parse({ candidate_name: "   " }));
  assert.throws(() => CandidateCreateRequestSchema.parse({ candidate_name: "Alex", owner_id: "11111111-1111-4111-8111-111111111111" }));
  assert.throws(() => CandidateCreateRequestSchema.parse({ candidate_name: "Alex", profile_url: "https://example.com" }));

  assert.throws(() => ManualCandidateEditsSchema.parse({}));
  assert.throws(() => ManualCandidateEditsSchema.parse({ candidate_name: null }));
  assert.throws(() => ManualCandidateEditsSchema.parse({ compensation_context: "$150k" }));
  assert.deepEqual(ManualCandidateEditsSchema.parse({ current_title: "Director", notes: null }), {
    current_title: "Director",
    notes: null,
  });

  assert.throws(() => TrackerCandidateEditsSchema.parse({}));
  assert.throws(() => TrackerCandidateEditsSchema.parse({ profile_url: "javascript:alert(1)" }));
  assert.deepEqual(
    CandidateEditRequestSchema.parse({
      edits: { compensation_context: "$140k base", notes: null, profile_url: "https://example.com/in/alex" },
      tracker_source: "tracker_submissions",
      tracker_row: 12,
    }).edits.notes,
    null,
  );
});

test("CandidateRecordSchema enforces provenance invariants between manual and Tracker sources", () => {
  const trackerRow = CandidateRecordSchema.parse({
    id: "submission:8",
    candidate_source: "submission",
    tracker_source: "tracker_submissions",
    candidate_source_id: "8",
    tracker_row: 14,
    candidate_name: "Taylor Reed",
    current_title: "Operations Manager",
    current_company: "Northwind",
    location: "Toronto, ON",
    industry: "Manufacturing",
    shift: null,
    email: null,
    phone: null,
    compensation_target: null,
    current_compensation: null,
    compensation_context: "$135k",
    notes: "Strong plant turnaround background",
    profile_url: null,
    role_context: "Plant Manager",
    client_context: "Acme",
    source_candidate_key: "cand-8",
    source_updated_at: "2026-11-08T15:00:00.000Z",
    edited_at: null,
    is_manual: false,
  });
  assert.equal(trackerRow.id, "submission:8");

  assert.throws(() =>
    CandidateRecordSchema.parse({
      ...trackerRow,
      tracker_source: "tracker_candidates",
    }),
  );

  const manualUuid = "11111111-1111-4111-8111-111111111111";
  const manualRow = CandidateRecordSchema.parse({
    id: `manual:${manualUuid}`,
    candidate_source: "manual",
    tracker_source: null,
    candidate_source_id: manualUuid,
    tracker_row: null,
    candidate_name: "Jordan Lee",
    current_title: "Maintenance Manager",
    current_company: null,
    location: "Mississauga, ON",
    industry: null,
    shift: "Days",
    email: "jordan@example.invalid",
    phone: null,
    compensation_target: "$130k",
    current_compensation: null,
    compensation_context: null,
    notes: null,
    profile_url: null,
    role_context: null,
    client_context: null,
    source_candidate_key: null,
    source_updated_at: "2026-11-08T16:00:00.000Z",
    edited_at: "2026-11-08T16:00:00.000Z",
    is_manual: true,
  });
  assert.equal(manualRow.is_manual, true);

  assert.throws(() =>
    CandidateRecordSchema.parse({
      ...manualRow,
      tracker_row: 3,
    }),
  );

  assert.deepEqual(CandidateListQuerySchema.parse({ source: "sourcing", limit: "25" }), {
    source: "sourcing",
    limit: 25,
    offset: 0,
  });
});
