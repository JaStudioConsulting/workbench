import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { parseWorkbenchSubjectLink } from "@ja/shared-types";
import {
  listAllOwnerNotes,
  NOTE_DIRECTORY_PAGE_SIZE,
} from "../src/features/notes/notesClient.js";
import {
  buildNoteDirectoryEntries,
  compareNotesNewestFirst,
  describeNoteSubject,
  directoryReducer,
  extractNotePlainText,
  INITIAL_DIRECTORY_STATE,
  filterNoteEntries,
  findFocusedNoteIndex,
  formatNoteTimestamp,
  previewSnippet,
  resolveDirectoryView,
} from "../src/features/notes/notesDirectory.js";
import { resolveSearchNavigation } from "../src/features/search/searchClient.js";

const consoleRoot = fileURLToPath(new URL("../", import.meta.url));
const OWNER = "11111111-1111-4111-8111-111111111111";
const TOKEN = "synthetic-session-token";
const CANDIDATE_SUBJECT = "manual:33333333-3333-4333-8333-333333333333";
const MEETING_SUBJECT = "44444444-4444-4444-8444-444444444444";

function uuid(index) {
  return `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
}

function paragraph(text) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function syntheticNote(index, overrides = {}) {
  return {
    id: uuid(index),
    owner_id: OWNER,
    title: `Synthetic note ${index}`,
    subject_type: null,
    subject_id: null,
    body: { type: "doc", content: [paragraph(`Synthetic body ${index}`)] },
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function syntheticSession(token = TOKEN) {
  return { auth: { getSession: async () => ({ data: { session: { access_token: token } }, error: null }) } };
}

// Fake GET /api/notes. Validates bounded page sizes and exercises stable keyset cursors.
function pagedFetch(notes, { requests = [], shift = 0 } = {}) {
  return async (requestPath, options) => {
    requests.push({ path: requestPath, options });
    const url = new URL(requestPath, "https://workbench.example.invalid");
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    const afterUpdated = url.searchParams.get("after_updated_at");
    const afterCreated = url.searchParams.get("after_created_at");
    const afterId = url.searchParams.get("after_id");
    if (!(limit >= 1 && limit <= 200) || !(offset >= 0 && offset <= 10_000) || Boolean(afterUpdated) !== Boolean(afterCreated) || Boolean(afterUpdated) !== Boolean(afterId)) {
      return Response.json({ error: { code: "INVALID_INPUT", message: "Invalid notes query" } }, { status: 400 });
    }
    let remaining = notes;
    if (afterId) {
      const cursorIndex = notes.findIndex((note) => note.id === afterId);
      remaining = cursorIndex < 0 ? [] : notes.slice(cursorIndex + 1);
    } else if (offset > 0) {
      remaining = notes.slice(offset);
    }
    if (shift && afterId && remaining.length) remaining = [notes[notes.findIndex((note) => note.id === afterId)], ...remaining];
    return Response.json({ notes: remaining.slice(0, limit) });
  };
}

test("extractNotePlainText returns only visible text from a Tiptap document in reading order", () => {
  const body = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Salary", marks: [{ type: "bold" }] }] },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Line one" }, { type: "hardBreak" }, { type: "text", text: "Line two" }],
      },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph("Relocation package")] },
          { type: "listItem", content: [paragraph("Start date")] },
        ],
      },
      { type: "paragraph" },
    ],
  };
  assert.equal(extractNotePlainText(body), "Salary\nLine one\nLine two\nRelocation package\nStart date");
});

test("extractNotePlainText tolerates missing, malformed, and unknown bodies without throwing", () => {
  assert.equal(extractNotePlainText(null), "");
  assert.equal(extractNotePlainText(undefined), "");
  assert.equal(extractNotePlainText("plain string"), "");
  assert.equal(extractNotePlainText({ type: "doc" }), "");
  assert.equal(
    extractNotePlainText({ type: "doc", content: [{ type: "image", attrs: { src: "https://example.invalid/x.png" } }, { type: "custom", content: [{ type: "text", text: "Unknown block text" }] }, null, 7] }),
    "Unknown block text",
  );
});

test("search matches the title and plain body text, case-insensitively, and never matches editor structure", () => {
  const notes = [
    syntheticNote(1, {
      title: "Interview prep",
      subject_type: "candidate",
      subject_id: CANDIDATE_SUBJECT,
      body: { type: "doc", content: [paragraph("Discussed relocation timeline with the candidate")] },
    }),
    syntheticNote(2, {
      title: "",
      body: { type: "doc", content: [paragraph("Quarterly plan for Ontario expansion")] },
    }),
    syntheticNote(3, {
      title: "Offer follow-up",
      body: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Salary expectations" }] },
          { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Relocation package")] }] },
        ],
      },
    }),
    syntheticNote(4, { title: "Other", body: { type: "doc", content: [paragraph("Hello")] } }),
  ];
  const entries = buildNoteDirectoryEntries(notes);
  const idsFor = (query) => filterNoteEntries(entries, query).map((entry) => entry.id).sort();

  assert.deepEqual(idsFor("RELOCATION"), [uuid(1), uuid(3)], "body text in a list item and a paragraph both match");
  assert.deepEqual(idsFor("interview"), [uuid(1)], "title text matches");
  assert.deepEqual(idsFor("ontario"), [uuid(2)], "unlinked note with no title is found by body text");
  assert.deepEqual(idsFor("relocation timeline"), [uuid(1)], "every typed word must match somewhere");
  assert.deepEqual(idsFor("salary"), [uuid(3)], "heading text is searchable");
  assert.deepEqual(idsFor("paragraph"), [], "node type names are not searchable");
  assert.deepEqual(idsFor("listitem"), [], "node type names are not searchable");
  assert.deepEqual(idsFor("zzz-no-match"), []);
  assert.equal(filterNoteEntries(entries, "   ").length, entries.length, "blank query shows everything");
});

test("notes order newest first with stable tie-breaks, unreadable timestamps last, and duplicate IDs removed", () => {
  const notes = [
    syntheticNote(1, { updated_at: "2026-11-01T10:00:00.000Z", created_at: "2026-10-01T00:00:00.000Z" }),
    syntheticNote(2, { updated_at: "2026-11-05T09:00:00.000Z", created_at: "2026-10-02T00:00:00.000Z" }),
    syntheticNote(3, { updated_at: "2026-11-01T10:00:00.000Z", created_at: "2026-10-09T00:00:00.000Z" }),
    syntheticNote(4, { updated_at: null, created_at: "2026-11-20T00:00:00.000Z" }),
    syntheticNote(5, { updated_at: "not-a-date", created_at: "2026-11-21T00:00:00.000Z" }),
    syntheticNote(2, { title: "Duplicate of note 2", updated_at: "2026-01-01T00:00:00.000Z" }),
  ];
  const ordered = buildNoteDirectoryEntries(notes).map((entry) => entry.id);
  // Unreadable updated_at sorts below every readable date; within that group created_at decides (newer first).
  assert.deepEqual(ordered, [uuid(2), uuid(3), uuid(1), uuid(5), uuid(4)]);

  const first = buildNoteDirectoryEntries(notes).find((entry) => entry.id === uuid(2));
  assert.equal(first.title, "Synthetic note 2", "the first copy of a duplicated ID wins");

  assert.ok(compareNotesNewestFirst(notes[1], notes[0]) < 0, "later updated_at sorts first");
  assert.ok(compareNotesNewestFirst(notes[2], notes[0]) < 0, "equal updated_at falls back to created_at, newer first");
});

test("listAllOwnerNotes walks bounded keyset pages, stopping at the first short page", async () => {
  const notes = Array.from({ length: 250 }, (_, index) => syntheticNote(index));
  const requests = [];
  const result = await listAllOwnerNotes({ client: syntheticSession(), fetchImpl: pagedFetch(notes, { requests }) });

  assert.equal(result.truncated, false);
  assert.deepEqual(result.notes.map((note) => note.id), notes.map((note) => note.id));
  assert.deepEqual(requests.map((request) => new URL(request.path, "https://workbench.example.invalid").searchParams.get("offset")), ["0", "0", "0"]);
  assert.equal(new URL(requests[1].path, "https://workbench.example.invalid").searchParams.get("after_id"), notes[99].id);
  assert.equal(new URL(requests[2].path, "https://workbench.example.invalid").searchParams.get("after_id"), notes[199].id);
  for (const request of requests) {
    const url = new URL(request.path, "https://workbench.example.invalid");
    assert.equal(url.pathname, "/api/notes");
    assert.equal(url.searchParams.get("limit"), String(NOTE_DIRECTORY_PAGE_SIZE));
    assert.equal(url.searchParams.get("subject_type"), null, "directory lists every owner note, not one subject");
    assert.equal(url.searchParams.get("q"), null, "text search runs on the client over the full plain text");
    assert.equal(request.options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(request.options.method, "GET");
  }
});

test("listAllOwnerNotes requests one more empty page when the total is an exact multiple of the page size", async () => {
  const notes = Array.from({ length: 200 }, (_, index) => syntheticNote(index));
  const requests = [];
  const result = await listAllOwnerNotes({ client: syntheticSession(), fetchImpl: pagedFetch(notes, { requests }) });
  assert.equal(result.notes.length, 200);
  assert.equal(requests.length, 3, "two full cursor pages, then an empty cursor page");
});

test("listAllOwnerNotes de-duplicates notes that shift across page boundaries while the owner edits", async () => {
  const notes = Array.from({ length: 150 }, (_, index) => syntheticNote(index));
  // Repeated boundary rows are safely deduplicated during cursor paging.
  const result = await listAllOwnerNotes({ client: syntheticSession(), fetchImpl: pagedFetch(notes, { shift: 1 }) });
  assert.equal(result.notes.length, 150);
  assert.equal(new Set(result.notes.map((note) => note.id)).size, 150);
});

test("listAllOwnerNotes keyset pagination reaches and searches notes beyond the former 10,100-note ceiling", async () => {
  const notes = Array.from({ length: 10_350 }, (_, index) => syntheticNote(index));
  notes[10_299] = syntheticNote(10_299, { title: "Older unique search phrase" });
  const requests = [];
  const result = await listAllOwnerNotes({ client: syntheticSession(), fetchImpl: pagedFetch(notes, { requests }) });
  assert.equal(result.truncated, false);
  assert.equal(result.notes.length, notes.length);
  assert.equal(result.notes.at(-1).id, notes.at(-1).id);
  const olderMatch = filterNoteEntries(buildNoteDirectoryEntries(result.notes), "older unique search phrase");
  assert.equal(olderMatch.length, 1);
  assert.equal(requests.length, Math.ceil(notes.length / NOTE_DIRECTORY_PAGE_SIZE));
  assert.ok(requests.slice(1).every((request) => new URL(request.path, "https://workbench.example.invalid").searchParams.has("after_id")));
});

test("listAllOwnerNotes needs a Supabase session and surfaces gateway auth failures without fetching", async () => {
  let fetched = false;
  const signedOut = { auth: { getSession: async () => ({ data: { session: null }, error: null }) } };
  await assert.rejects(
    () => listAllOwnerNotes({ client: signedOut, fetchImpl: () => { fetched = true; return Response.json({}); } }),
    /Sign in/,
  );
  assert.equal(fetched, false);

  const rejected = async () => Response.json({ error: { code: "UNAUTHORIZED", message: "Supabase session is invalid or expired" } }, { status: 401 });
  await assert.rejects(
    () => listAllOwnerNotes({ client: syntheticSession(), fetchImpl: rejected }),
    (error) => error.status === 401 && error.code === "UNAUTHORIZED",
  );
});

test("subject links open only verified candidate, job, and meeting records and never invent facts", () => {
  const unlinked = describeNoteSubject({ subject_type: null, subject_id: null });
  assert.equal(unlinked.kind, "unlinked");
  assert.equal(unlinked.label, "Unlinked note");
  assert.equal(unlinked.link, null);

  const candidate = describeNoteSubject({ subject_type: "candidate", subject_id: CANDIDATE_SUBJECT });
  const expectedCandidateId = parseWorkbenchSubjectLink({ subject_type: "candidate", subject_id: CANDIDATE_SUBJECT }).subject_id;
  assert.equal(candidate.kind, "linked");
  assert.deepEqual(candidate.link, { type: "candidate", page: "Candidates", id: expectedCandidateId });
  assert.equal(candidate.actionLabel, "Open candidate");

  const job = describeNoteSubject({ subject_type: "job", subject_id: "4821" });
  assert.deepEqual(job.link, { type: "job", page: "Jobs", id: "4821" });
  assert.equal(job.label, "Job 4821");

  const meeting = describeNoteSubject({ subject_type: "meeting", subject_id: MEETING_SUBJECT });
  assert.deepEqual(meeting.link, { type: "meeting", page: "Meetings", id: MEETING_SUBJECT });
  assert.equal(meeting.label, "Meeting record");
});

test("unknown or incomplete subject fields show an unavailable label with no link", () => {
  const cases = [
    { subject_type: "deal", subject_id: "9" },
    { subject_type: "job", subject_id: "not-a-number" },
    { subject_type: "job", subject_id: "0" },
    { subject_type: "candidate", subject_id: null },
    { subject_type: null, subject_id: "4821" },
    { subject_type: "meeting", subject_id: "not-a-uuid" },
    { subject_type: 42, subject_id: "4821" },
    {},
  ];
  for (const subject of cases) {
    const described = describeNoteSubject(subject);
    assert.equal(described.link, null, JSON.stringify(subject));
    assert.equal(described.kind, "unavailable", JSON.stringify(subject));
    assert.equal(described.label, "Linked record unavailable", JSON.stringify(subject));
  }
});

test("a note with no title or body still renders honestly: Untitled note and empty preview text", () => {
  const [entry] = buildNoteDirectoryEntries([{ id: uuid(9), owner_id: OWNER, title: "", subject_type: null, subject_id: null, body: undefined }]);
  assert.equal(entry.displayTitle, "Untitled note");
  assert.equal(entry.plainText, "");
  assert.equal(entry.snippet, "");
  assert.equal(entry.updatedAt, null);
});

test("previewSnippet collapses whitespace and truncates long text with an ellipsis", () => {
  assert.equal(previewSnippet("  one \n\n two\tthree  "), "one two three");
  const long = previewSnippet("word ".repeat(80), 40);
  assert.ok(long.endsWith("…"));
  assert.ok(long.length <= 41);
  assert.equal(formatNoteTimestamp("not-a-date"), "");
  assert.notEqual(formatNoteTimestamp("2026-11-09T12:00:00.000Z"), "");
});

test("directory state: focusing a note clears a hiding search, selects it, and reports a missing note honestly", () => {
  const notes = [
    syntheticNote(1, { title: "Alpha", subject_type: "job", subject_id: "4821" }),
    syntheticNote(2, { title: "Beta unlinked", subject_type: null, subject_id: null }),
  ];
  let state = directoryReducer(INITIAL_DIRECTORY_STATE, { type: "loaded", notes, truncated: false });
  assert.equal(state.phase, "ready");

  state = directoryReducer(state, { type: "query", value: "alpha" });
  assert.equal(resolveDirectoryView(state).visible.length, 1);

  // A search hit for the unlinked note must show it even though the active query hides it.
  state = directoryReducer(state, { type: "focus", noteId: uuid(2).toUpperCase() });
  let view = resolveDirectoryView(state);
  assert.equal(state.query, "", "focus resets the query so the exact note is visible");
  assert.equal(view.selectedEntry.id, uuid(2));
  assert.equal(view.selectedEntry.subject.kind, "unlinked");
  assert.equal(view.focusMissing, false);

  // Clicking another row releases the focus and selects that row.
  state = directoryReducer(state, { type: "select", id: uuid(1) });
  view = resolveDirectoryView(state);
  assert.equal(view.selectedEntry.id, uuid(1));
  assert.equal(view.selectedEntry.subject.link.page, "Jobs");

  // A focused ID that is no longer among the owner's notes is reported, not silently replaced.
  state = directoryReducer(state, { type: "focus", noteId: uuid(77) });
  view = resolveDirectoryView(state);
  assert.equal(view.focusMissing, true);
  assert.equal(view.selectedEntry, null);
  assert.equal(findFocusedNoteIndex(view.entries, uuid(77)), -1);
});

test("directory state: loading, error, empty, and no-match states are explicit", () => {
  const loading = directoryReducer(INITIAL_DIRECTORY_STATE, { type: "load" });
  assert.equal(loading.phase, "loading");

  const failed = directoryReducer(loading, { type: "failed", message: "" });
  assert.equal(failed.phase, "error");
  assert.equal(failed.error, "Notes could not be loaded.");

  const retried = directoryReducer(failed, { type: "load" });
  assert.equal(retried.phase, "loading");
  assert.equal(retried.error, "");

  const empty = directoryReducer(INITIAL_DIRECTORY_STATE, { type: "loaded", notes: [], truncated: false });
  assert.equal(resolveDirectoryView(empty).emptyKind, "empty");
  assert.equal(resolveDirectoryView(empty).selectedEntry, null);

  const withNotes = directoryReducer(empty, { type: "loaded", notes: [syntheticNote(1, { title: "Only" })], truncated: true });
  assert.equal(withNotes.truncated, true);
  const searched = directoryReducer(withNotes, { type: "query", value: "absent" });
  assert.equal(resolveDirectoryView(searched).emptyKind, "no-match");
  assert.equal(resolveDirectoryView(searched).entries.length, 1);
});

test("a search hit on any note opens the Notes page with that note focused, while candidate, job, and client hits keep their pages", () => {
  const noteHit = (subjectType, subjectId) => ({
    id: `note:${uuid(5)}`,
    entity_type: "note",
    entity_id: uuid(5),
    subject_type: subjectType,
    subject_id: subjectId,
  });
  for (const hit of [noteHit("candidate", CANDIDATE_SUBJECT), noteHit("job", "4821"), noteHit("meeting", MEETING_SUBJECT), noteHit(null, null)]) {
    const target = resolveSearchNavigation(hit);
    assert.equal(target.page, "Notes");
    assert.equal(target.entityType, "note");
    assert.equal(target.focusNoteId, uuid(5));
    assert.equal(target.focusCandidateId, undefined);
    assert.equal(target.focusMeetingId, undefined);
  }

  const candidateHit = resolveSearchNavigation({
    id: "candidate:submission:30",
    entity_type: "candidate",
    entity_id: "submission:30",
  });
  assert.equal(candidateHit.page, "Candidates");
  assert.equal(candidateHit.focusCandidateId, "submission:30");

  const clientHit = resolveSearchNavigation({ id: "client:acme", entity_type: "client", entity_id: "acme", company: "Synthetic Client" });
  assert.equal(clientHit.page, "Leads");
  assert.ok(clientHit.client);
});

test("App mounts the Notes directory in the sidebar, routes note hits to it, and keeps browser storage out of the page", () => {
  const app = fs.readFileSync(path.join(consoleRoot, "src/App.jsx"), "utf8");
  assert.match(app, /\["Notes", StickyNote\]/);
  assert.match(app, /const NotesDirectory = lazy\(\(\) => import\("\.\/features\/notes\/NotesDirectory\.jsx"\)\);/);
  assert.match(app, /case "Notes": return <NotesDirectory focusRequest=\{focusNote\} onOpenSubject=\{openNoteSubject\} \/>;/);
  assert.match(app, /if \(target\.entityType === "note"\) \{[\s\S]*?setPage\("Notes"\);/);
  assert.match(app, /const selectPage = \(next\) => \{[\s\S]*?setFocusNote\(null\);/);

  const sources = [
    "src/features/notes/NotesDirectory.jsx",
    "src/features/notes/notesDirectory.js",
    "src/features/notes/notesClient.js",
  ].map((file) => fs.readFileSync(path.join(consoleRoot, file), "utf8")).join("\n");
  assert.doesNotMatch(sources, /localStorage|sessionStorage|indexedDB/);
});

test("the Notes directory renders its loading state on first paint without a live Supabase call", async () => {
  const vite = await createServer({
    root: consoleRoot,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  try {
    const { default: NotesDirectory } = await vite.ssrLoadModule("/src/features/notes/NotesDirectory.jsx");
    const html = renderToStaticMarkup(React.createElement(NotesDirectory, { loader: () => new Promise(() => {}) }));
    assert.match(html, /aria-label="Loading notes"/);
    assert.doesNotMatch(html, /data-testid="notes-directory"/);
  } finally {
    await vite.close();
  }
});
