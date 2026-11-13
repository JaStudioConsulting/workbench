import assert from "node:assert/strict";
import test from "node:test";
import {
  BoardAutosaveRequestSchema,
  BoardCreateRequestSchema,
  BoardDeleteResponseSchema,
  BoardListQuerySchema,
  BoardRecordSchema,
  BoardSceneSchema,
  BoardUpdateRequestSchema,
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
  MAX_BOARD_ELEMENTS,
  MAX_BOARD_SCENE_BYTES,
  MAX_NOTE_BODY_BYTES,
  ManualCandidateEditsSchema,
  McpDiscoverySchema,
  NoteAutosaveRequestSchema,
  NoteBodySchema,
  NoteCreateRequestSchema,
  NoteDeleteResponseSchema,
  NoteListQuerySchema,
  NoteRecordSchema,
  NoteUpdateRequestSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  SearchResultItemSchema,
  TrackerCandidateEditsSchema,
  WorkbenchSubjectLinkSchema,
  parseCandidateSourceKey,
  parseWorkbenchSubjectLink,
} from "../src/index.js";

test("shared contracts reject unsupported workflow input and standalone skills", () => {
  assert.throws(() => CandidateInputSchema.parse({ name: "A", title: "B", resumeText: "", jobDescription: "C" }));
  assert.equal(CandidateInputSchema.safeParse({ candidateId: "sourcing:1", name: "A", resumeText: "r".repeat(500_000), jobDescription: "J".repeat(500_000), transcriptText: "t".repeat(500_000), callNotes: "n".repeat(300_000) }).success, true);
  const overLimit = CandidateInputSchema.safeParse({ candidateId: "sourcing:1", name: "A", resumeText: "r".repeat(1_100_000), jobDescription: "J".repeat(1_100_000) });
  assert.equal(overLimit.success, false);
  assert.match(overLimit.error.issues[0].message, /shorten the resume, transcript/i);
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

test("Workbench subject links allow candidate, job, meeting, or unlinked (null) exactly as migration 020 permits", () => {
  assert.deepEqual(parseWorkbenchSubjectLink({ subject_type: null, subject_id: null }), {
    subject_type: null,
    subject_id: null,
  });
  assert.deepEqual(
    WorkbenchSubjectLinkSchema.parse({
      subject_type: "candidate",
      subject_id: "manual:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    }),
    {
      subject_type: "candidate",
      subject_id: "manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  );
  assert.deepEqual(
    WorkbenchSubjectLinkSchema.parse({
      subject_type: "candidate",
      subject_id: "sourcing:12",
    }),
    {
      subject_type: "candidate",
      subject_id: "sourcing:12",
    },
  );
  assert.deepEqual(
    WorkbenchSubjectLinkSchema.parse({
      subject_type: "job",
      subject_id: "501",
    }),
    {
      subject_type: "job",
      subject_id: "501",
    },
  );
  assert.deepEqual(
    WorkbenchSubjectLinkSchema.parse({
      subject_type: "meeting",
      subject_id: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    }),
    {
      subject_type: "meeting",
      subject_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    },
  );

  // Reject half-links, unsupported subject_type values, and malformed subject_ids
  assert.equal(parseWorkbenchSubjectLink({ subject_type: "candidate", subject_id: null }), null);
  assert.equal(parseWorkbenchSubjectLink({ subject_type: null, subject_id: "sourcing:1" }), null);
  assert.equal(parseWorkbenchSubjectLink({ subject_type: "none", subject_id: null }), null);
  assert.equal(parseWorkbenchSubjectLink({ subject_type: "lead", subject_id: "11111111-1111-4111-8111-111111111111" }), null);
  assert.equal(parseWorkbenchSubjectLink({ subject_type: "candidate", subject_id: "invalid:1" }), null);
  assert.equal(parseWorkbenchSubjectLink({ subject_type: "job", subject_id: "0" }), null);
  assert.equal(parseWorkbenchSubjectLink({ subject_type: "job", subject_id: "job-501" }), null);
  assert.equal(parseWorkbenchSubjectLink({ subject_type: "meeting", subject_id: "not-a-uuid" }), null);
  assert.throws(() => WorkbenchSubjectLinkSchema.parse({ subject_type: "candidate", subject_id: null }));
  assert.throws(() => WorkbenchSubjectLinkSchema.parse({ subject_type: null, subject_id: "501" }));
});

test("editor JSON contracts validate in browser runtimes without Node Buffer", () => {
  const originalBuffer = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    assert.deepEqual(NoteBodySchema.parse({ type: "doc", content: [] }), { type: "doc", content: [] });
    assert.deepEqual(BoardSceneSchema.parse({}), {});
  } finally {
    globalThis.Buffer = originalBuffer;
  }
});

test("NoteBodySchema validates Novel/Tiptap editor JSON structure and enforces size and depth bounds", () => {
  assert.deepEqual(NoteBodySchema.parse({}), {});

  const validDoc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Candidate Screen" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", marks: [{ type: "bold" }], text: "Strong launch experience" },
          { type: "text", text: " across automotive tier-1 plants in Ontario." },
        ],
      },
    ],
  };
  assert.deepEqual(NoteBodySchema.parse(validDoc), validDoc);

  // Reject non-objects, non-doc roots, malformed nodes/marks, and oversized payloads
  assert.throws(() => NoteBodySchema.parse(null));
  assert.throws(() => NoteBodySchema.parse([]));
  assert.throws(() => NoteBodySchema.parse("plain string"));
  assert.throws(() => NoteBodySchema.parse({ type: "paragraph", content: [] }));
  assert.throws(() => NoteBodySchema.parse({ type: "doc", content: "not-an-array" }));
  assert.throws(() => NoteBodySchema.parse({ type: "doc", unknownKey: true }));
  assert.throws(() => NoteBodySchema.parse({ type: "doc", content: [{ type: "" }] }));
  assert.throws(() =>
    NoteBodySchema.parse({
      type: "doc",
      content: [{ type: "text", text: "leaf", content: [{ type: "text", text: "nested" }] }],
    }),
  );
  assert.throws(() =>
    NoteBodySchema.parse({
      type: "doc",
      content: [{ type: "text", text: "bad mark", marks: [{ type: "" }] }],
    }),
  );

  const oversizedDoc = {
    type: "doc",
    content: Array.from({ length: 8 }, () => ({
      type: "paragraph",
      content: [{ type: "text", text: "x".repeat(Math.ceil(MAX_NOTE_BODY_BYTES / 6)) }],
    })),
  };
  assert.throws(() => NoteBodySchema.parse(oversizedDoc), /exceeds maximum size/);
});

test("BoardSceneSchema validates Excalidraw scene JSON, elements, appState, files, and size bounds", () => {
  assert.deepEqual(BoardSceneSchema.parse({}), {});

  const validScene = {
    type: "excalidraw",
    version: 2,
    source: "https://console.test",
    elements: [
      {
        id: "rect-1",
        type: "rectangle",
        x: 120,
        y: 80,
        width: 240,
        height: 120,
        angle: 0,
        strokeColor: "#1e293b",
        backgroundColor: "transparent",
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        seed: 42,
        version: 1,
        versionNonce: 1001,
        isDeleted: false,
        locked: false,
        groupIds: [],
      },
      {
        id: "text-1",
        type: "text",
        x: 140,
        y: 110,
        width: 200,
        height: 30,
        text: "Reporting line to VP Ops",
        fontSize: 20,
      },
    ],
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: 20,
    },
    files: {
      "file-1": {
        id: "file-1",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,iVBORw0KGgo=",
        created: 1762646400000,
      },
    },
  };
  assert.deepEqual(BoardSceneSchema.parse(validScene), validScene);

  // Reject invalid root types, missing elements on non-empty scene, invalid element coordinates, and oversized scenes
  assert.throws(() => BoardSceneSchema.parse(null));
  assert.throws(() => BoardSceneSchema.parse([]));
  assert.throws(() => BoardSceneSchema.parse({ appState: { viewBackgroundColor: "#ffffff" } }));
  assert.throws(() => BoardSceneSchema.parse({ type: "other", elements: [] }));
  assert.throws(() => BoardSceneSchema.parse({ elements: [{ id: "", type: "rectangle" }] }));
  assert.throws(() => BoardSceneSchema.parse({ elements: [{ id: "el-1", type: "rectangle", x: "not-a-number" }] }));
  assert.throws(() => BoardSceneSchema.parse({ elements: [], appState: [] }));
  assert.throws(() => BoardSceneSchema.parse({ elements: [], files: "invalid" }));

  const tooManyElements = {
    elements: Array.from({ length: MAX_BOARD_ELEMENTS + 1 }, (_, idx) => ({
      id: `el-${idx}`,
      type: "rectangle",
    })),
  };
  assert.throws(() => BoardSceneSchema.parse(tooManyElements), /cannot exceed/);

  const oversizedScene = {
    elements: [
      {
        id: "huge-text",
        type: "text",
        text: "diagram",
      },
    ],
    files: {
      "file-huge": {
        id: "file-huge",
        mimeType: "image/png",
        dataURL: `data:image/png;base64,${"A".repeat(MAX_BOARD_SCENE_BYTES)}`,
      },
    },
  };
  assert.throws(() => BoardSceneSchema.parse(oversizedScene), /exceeds maximum size/);
});

test("notes and boards create, autosave update, list query, record, and delete contracts enforce owner and subject invariants", () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const noteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const boardId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  // Create defaults suitable for immediate autosave
  const defaultNoteCreate = NoteCreateRequestSchema.parse({});
  assert.deepEqual(defaultNoteCreate, {
    title: "",
    subject_type: null,
    subject_id: null,
    body: {},
    origin_key: null,
  });

  const candidateBoardCreate = BoardCreateRequestSchema.parse({
    title: "  Plant Org Chart  ",
    subject_type: "candidate",
    subject_id: "manual:CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
    scene: { elements: [{ id: "node-1", type: "rectangle", x: 0, y: 0, width: 100, height: 60 }] },
  });
  assert.equal(candidateBoardCreate.title, "Plant Org Chart");
  assert.equal(candidateBoardCreate.subject_type, "candidate");
  assert.equal(candidateBoardCreate.subject_id, "manual:cccccccc-cccc-4ccc-8ccc-cccccccccccc");

  // Forbid owner_id or id on create/update
  assert.throws(() => NoteCreateRequestSchema.parse({ title: "Spoof", owner_id: ownerId }));
  assert.throws(() => BoardCreateRequestSchema.parse({ title: "Spoof", id: boardId }));

  // Update / autosave schemas require at least one mutable field and paired subject links
  assert.throws(() => NoteUpdateRequestSchema.parse({}));
  assert.throws(() => NoteUpdateRequestSchema.parse({ expected_updated_at: "2026-11-09T01:00:00.000Z" }));
  assert.throws(() => NoteUpdateRequestSchema.parse({ subject_type: "job" }));
  assert.throws(() => BoardUpdateRequestSchema.parse({ subject_id: "501" }));

  const autosaveNotePatch = NoteAutosaveRequestSchema.parse({
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Autosaved line" }] }] },
    expected_updated_at: "2026-11-09T01:00:00.000Z",
  });
  assert.equal(autosaveNotePatch.expected_updated_at, "2026-11-09T01:00:00.000Z");

  const unlinkBoardPatch = BoardAutosaveRequestSchema.parse({
    subject_type: null,
    subject_id: null,
  });
  assert.deepEqual(unlinkBoardPatch, { subject_type: null, subject_id: null });

  // List query validation
  assert.deepEqual(
    NoteListQuerySchema.parse({ subject_type: "candidate", subject_id: "sourcing:2", limit: "25" }),
    { subject_type: "candidate", subject_id: "sourcing:2", limit: 25, offset: 0 },
  );
  const cursorQuery = NoteListQuerySchema.parse({
    after_updated_at: "2026-11-09T01:00:00.000Z",
    after_created_at: "2026-11-08T01:00:00.000Z",
    after_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    limit: "100",
  });
  assert.equal(cursorQuery.after_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.throws(() => NoteListQuerySchema.parse({ after_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
  assert.throws(() => NoteListQuerySchema.parse({
    after_updated_at: "2026-11-09T01:00:00.000Z",
    after_created_at: "2026-11-08T01:00:00.000Z",
    after_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    offset: "10",
  }));
  assert.deepEqual(
    BoardListQuerySchema.parse({ unlinked: "true" }),
    { unlinked: true, limit: 50, offset: 0 },
  );
  assert.throws(() => NoteListQuerySchema.parse({ subject_id: "sourcing:2" }));
  assert.throws(() => NoteListQuerySchema.parse({ unlinked: "true", subject_type: "job" }));
  assert.throws(() => BoardListQuerySchema.parse({ subject_type: "job", subject_id: "not-an-int" }));

  // Full records and delete responses
  const validNoteRecord = NoteRecordSchema.parse({
    id: noteId,
    owner_id: ownerId,
    title: "Screen notes",
    subject_type: "job",
    subject_id: "501",
    body: { type: "doc", content: [] },
    created_at: "2026-11-09T01:00:00.000Z",
    updated_at: "2026-11-09T01:05:00.000Z",
  });
  assert.equal(validNoteRecord.id, noteId);

  const validBoardRecord = BoardRecordSchema.parse({
    id: boardId,
    owner_id: ownerId,
    title: "Org map",
    subject_type: null,
    subject_id: null,
    scene: { elements: [] },
    created_at: "2026-11-09T01:00:00.000Z",
    updated_at: "2026-11-09T01:05:00.000Z",
  });
  assert.equal(validBoardRecord.id, boardId);

  assert.deepEqual(NoteDeleteResponseSchema.parse({ deleted: true, id: noteId.toUpperCase() }), {
    deleted: true,
    id: noteId,
  });
  assert.deepEqual(BoardDeleteResponseSchema.parse({ deleted: true, id: boardId.toUpperCase() }), {
    deleted: true,
    id: boardId,
  });
});

test("SearchQuerySchema validates query length and result limits across limit and max_per_group", () => {
  assert.deepEqual(SearchQuerySchema.parse({ q: "  program manager  " }), {
    q: "program manager",
    limit: 20,
    max_per_group: 20,
  });
  assert.deepEqual(SearchQuerySchema.parse({ q: "plant", limit: "12" }), {
    q: "plant",
    limit: 12,
    max_per_group: 12,
  });
  assert.deepEqual(SearchQuerySchema.parse({ q: "plant", max_per_group: "15" }), {
    q: "plant",
    limit: 15,
    max_per_group: 15,
  });
  assert.deepEqual(SearchQuerySchema.parse({ q: "plant", limit: "10", max_per_group: 10 }), {
    q: "plant",
    limit: 10,
    max_per_group: 10,
  });

  // Reject blank, missing, overlong, or control-character queries
  assert.throws(() => SearchQuerySchema.parse({}));
  assert.throws(() => SearchQuerySchema.parse({ q: "" }));
  assert.throws(() => SearchQuerySchema.parse({ q: "   " }));
  assert.throws(() => SearchQuerySchema.parse({ q: "x".repeat(201) }));
  assert.throws(() => SearchQuerySchema.parse({ q: "program\nmanager" }));

  // Reject out-of-range or mismatched limits and unknown params
  assert.throws(() => SearchQuerySchema.parse({ q: "plant", limit: 0 }));
  assert.throws(() => SearchQuerySchema.parse({ q: "plant", limit: -5 }));
  assert.throws(() => SearchQuerySchema.parse({ q: "plant", limit: 101 }));
  assert.throws(() => SearchQuerySchema.parse({ q: "plant", max_per_group: 0 }));
  assert.throws(() => SearchQuerySchema.parse({ q: "plant", max_per_group: 101 }));
  assert.throws(() => SearchQuerySchema.parse({ q: "plant", limit: "abc" }));
  assert.throws(() => SearchQuerySchema.parse({ q: "plant", limit: 10, max_per_group: 20 }));
  assert.throws(() => SearchQuerySchema.parse({ q: "plant", extra: "forbidden" }));
});

test("SearchResultItemSchema and SearchResponseSchema preserve source IDs, nulls, and per-group invariants", () => {
  const candidateItem = SearchResultItemSchema.parse({
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
    snippet: "Strong tier-1 background",
    updated_at: "2026-11-08T17:00:00.000Z",
    rank: 0.75,
  });
  assert.equal(candidateItem.title, null);
  assert.equal(candidateItem.entity_id, "sourcing:20");

  const leadItem = SearchResultItemSchema.parse({
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
    snippet: "Need program manager for EV line",
    updated_at: "2026-11-08T17:05:00.000Z",
    rank: 0.65,
  });

  const jobItem = SearchResultItemSchema.parse({
    id: "job:501",
    entity_type: "job",
    entity_id: "501",
    title: "Program Manager",
    subtitle: "Apex Tooling",
    company: "Apex Tooling",
    location: "Guelph, ON",
    status: "Active",
    subject_type: null,
    subject_id: null,
    snippet: null,
    updated_at: null,
    rank: 0.6,
  });

  const clientItem = SearchResultItemSchema.parse({
    id: "client:apex tooling",
    entity_type: "client",
    entity_id: "Apex Tooling",
    title: "Apex Tooling",
    subtitle: "Program Manager · Quality Manager",
    company: "Apex Tooling",
    location: "Guelph, ON",
    status: "Active",
    subject_type: null,
    subject_id: null,
    snippet: "Jordan Lee",
    updated_at: "2026-11-08T17:10:00.000Z",
    rank: 0.55,
  });

  const noteItem = SearchResultItemSchema.parse({
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
    updated_at: "2026-11-08T17:15:00.000Z",
    rank: 0.5,
  });

  const parsedResponse = SearchResponseSchema.parse({
    query: "program manager",
    limit: 5,
    results: [candidateItem, leadItem, jobItem, clientItem, noteItem],
    groups: {
      candidates: [candidateItem],
      leads: [leadItem],
      jobs: [jobItem],
      clients: [clientItem],
      notes: [noteItem],
    },
    candidates: [candidateItem],
    leads: [leadItem],
    jobs: [jobItem],
    clients: [clientItem],
    notes: [noteItem],
  });
  assert.equal(parsedResponse.results.length, 5);
  assert.equal(parsedResponse.groups.candidates[0].id, "candidate:sourcing:20");

  // Reject mismatched id prefix or invalid candidate source key
  assert.throws(() =>
    SearchResultItemSchema.parse({
      ...candidateItem,
      id: "candidate:tracker_candidates:20",
    }),
  );
  assert.throws(() =>
    SearchResultItemSchema.parse({
      ...candidateItem,
      status: "manual",
    }),
  );
  assert.throws(() =>
    SearchResultItemSchema.parse({
      ...noteItem,
      subject_id: "invalid-candidate-id",
    }),
  );
  assert.throws(() =>
    SearchResultItemSchema.parse({
      ...noteItem,
      subject_type: "candidate",
      subject_id: null,
    }),
  );

  // Reject response where group array does not match results or exceeds limit
  assert.throws(() =>
    SearchResponseSchema.parse({
      ...parsedResponse,
      candidates: [],
    }),
  );
});
