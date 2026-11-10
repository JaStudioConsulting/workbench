import assert from "node:assert/strict";
import test from "node:test";
import { createSubjectNote } from "../src/features/notes/notesClient.js";
import { loadMeetingTranscriptPreview } from "../src/features/notes/meetingTranscriptPreview.js";
import {
  buildMeetingNoteDoc,
  MEETING_NOTES_FAILED_WARNING,
  MEETING_NOTES_STALE_WARNING,
  meetingDraftOriginKey,
  syncMeetingDraftNotes,
} from "../src/features/meetings/meetingNotesSync.js";

const DRAFT_ID = "44444444-4444-4444-8444-444444444444";
const CANDIDATE_ID = "sourcing:12";
const OWNER = "11111111-1111-4111-8111-111111111111";
const client = { auth: { getSession: async () => ({ data: { session: { access_token: "test-session" } }, error: null }) } };

// Mirrors the gateway contract: one note per owner and origin_key; a replay returns the existing note with 200.
function fakeNotesGateway() {
  const byOriginKey = new Map();
  const posts = [];
  let counter = 0;
  const fetchImpl = async (path, options) => {
    assert.equal(options.method, "POST");
    assert.equal(new URL(path, "https://workbench.example.invalid").pathname, "/api/notes");
    const body = JSON.parse(options.body);
    posts.push(body);
    const existing = byOriginKey.get(body.origin_key);
    if (existing) return Response.json({ note: existing }, { status: 200 });
    counter += 1;
    const note = {
      id: `55555555-5555-4555-8555-${String(counter).padStart(12, "0")}`,
      owner_id: OWNER,
      title: body.title,
      subject_type: body.subject_type,
      subject_id: body.subject_id,
      origin_key: body.origin_key,
      body: body.body,
      created_at: "2026-11-09T00:00:00.000Z",
      updated_at: "2026-11-09T00:00:00.000Z",
    };
    byOriginKey.set(body.origin_key, note);
    return Response.json({ note }, { status: 201 });
  };
  return { fetchImpl, posts, byOriginKey };
}

function createNoteWith(fetchImpl) {
  return (subjectType, subjectId, title, options) => createSubjectNote(subjectType, subjectId, title, { ...options, client, fetchImpl });
}

function paragraphTexts(doc) {
  return doc.content.map((node) => (node.content || []).map((child) => child.text).join(""));
}

test("durable-only: session-only or missing draft saves never call the Notes gateway", async () => {
  const gateway = fakeNotesGateway();
  const createNote = createNoteWith(gateway.fetchImpl);
  const sessionOnly = await syncMeetingDraftNotes({ persistence: "session_only", draftId: DRAFT_ID, candidateId: CANDIDATE_ID, transcript: "Hello", createNote });
  const noDraft = await syncMeetingDraftNotes({ persistence: "durable", draftId: null, candidateId: CANDIDATE_ID, transcript: "Hello", createNote });
  assert.deepEqual(sessionOnly, { status: "skipped", warning: "" });
  assert.deepEqual(noDraft, { status: "skipped", warning: "" });
  assert.equal(gateway.posts.length, 0);
});

test("exact candidate: the note links to the candidate source key unchanged and uses the deterministic meeting origin key", async () => {
  const gateway = fakeNotesGateway();
  const result = await syncMeetingDraftNotes({
    persistence: "durable",
    draftId: DRAFT_ID,
    candidateId: "submission:77",
    label: "Screen call",
    transcript: "Recruiter: Tell me about the press line.",
    notes: "Strong on changeovers.",
    createNote: createNoteWith(gateway.fetchImpl),
  });
  assert.equal(result.status, "synced");
  assert.equal(gateway.posts.length, 1);
  assert.equal(gateway.posts[0].subject_type, "candidate");
  assert.equal(gateway.posts[0].subject_id, "submission:77");
  assert.equal(gateway.posts[0].origin_key, `meeting_draft:${DRAFT_ID}`);
  assert.equal(meetingDraftOriginKey(DRAFT_ID), `meeting_draft:${DRAFT_ID}`);
  assert.equal(gateway.posts[0].title, "Call notes - Screen call");
  assert.equal(JSON.stringify(gateway.posts[0].body).includes("Recruiter: Tell me about the press line."), false);
  assert.equal(JSON.stringify(gateway.posts[0].body).includes("Strong on changeovers."), true);
  assert.equal(gateway.posts[0].origin_key, `meeting_draft:${DRAFT_ID}`);
});

test("retention-safe linkage: only verbatim call notes enter durable Note; transcript remains linked by meeting origin", async () => {
  const transcript = "Private transcript that must expire";
  const notes = "  Recruiter note with spaces  \n\tSecond note";
  const doc = buildMeetingNoteDoc({ transcript, notes });
  const headings = doc.content.filter((node) => node.type === "heading").map((node) => node.content[0].text);
  assert.deepEqual(headings, ["Call notes"]);
  assert.deepEqual(paragraphTexts(doc), ["Call notes", "  Recruiter note with spaces  ", "\tSecond note"]);
  assert.equal(JSON.stringify(doc).includes(transcript), false);

  const transcriptOnly = buildMeetingNoteDoc({ transcript });
  assert.deepEqual(transcriptOnly, { type: "doc", content: [{ type: "paragraph" }] });

  const notesOnly = buildMeetingNoteDoc({ notes });
  assert.deepEqual(paragraphTexts(notesOnly), ["Call notes", "  Recruiter note with spaces  ", "\tSecond note"]);
});

test("after-call Notes view links call notes to a live transcript preview without copying transcript into durable Note", async () => {
  const gateway = fakeNotesGateway();
  const transcript = "Candidate described the press line handoff.";
  const callNotes = "Follow up on shift preference.";
  const saved = await syncMeetingDraftNotes({
    persistence: "durable", draftId: DRAFT_ID, candidateId: CANDIDATE_ID,
    transcript, notes: callNotes, createNote: createNoteWith(gateway.fetchImpl),
  });
  assert.equal(saved.status, "synced");
  assert.equal(saved.note.origin_key, `meeting_draft:${DRAFT_ID}`);
  assert.equal(JSON.stringify(saved.note.body).includes(transcript), false);
  assert.equal(JSON.stringify(saved.note.body).includes(callNotes), true);

  const meetingClient = {
    auth: { getSession: async () => ({ data: { session: { user: { id: OWNER } } }, error: null }) },
    from(table) {
      assert.equal(table, "meeting_drafts");
      return {
        select(columns) {
          assert.equal(columns, "id,owner_id,candidate_source,candidate_source_id,transcript");
          return this;
        },
        eq(column, value) { assert.equal(column, "id"); assert.equal(value, DRAFT_ID); return this; },
        maybeSingle: async () => ({ data: {
          id: DRAFT_ID, owner_id: OWNER, candidate_source: "sourcing", candidate_source_id: 12, transcript,
        }, error: null }),
      };
    },
  };
  const preview = await loadMeetingTranscriptPreview({
    originKey: saved.note.origin_key, candidateId: CANDIDATE_ID, client: meetingClient,
  });
  assert.deepEqual(preview, { status: "available", transcript });
});

test("blank input: whitespace-only transcript and notes send no note; notes-only sends only the notes section", async () => {
  const gateway = fakeNotesGateway();
  const createNote = createNoteWith(gateway.fetchImpl);
  const blank = await syncMeetingDraftNotes({ persistence: "durable", draftId: DRAFT_ID, candidateId: CANDIDATE_ID, transcript: "  \n\t", notes: "", createNote });
  assert.deepEqual(blank, { status: "skipped", warning: "" });
  assert.equal(gateway.posts.length, 0);

  const notesOnly = await syncMeetingDraftNotes({ persistence: "durable", draftId: DRAFT_ID, candidateId: CANDIDATE_ID, transcript: "   ", notes: "Call went well", createNote });
  assert.equal(notesOnly.status, "synced");
  assert.deepEqual(gateway.posts[0].body.content.map((node) => node.type), ["heading", "paragraph"]);
  assert.equal(gateway.posts[0].body.content[0].content[0].text, "Call notes");
  assert.equal(gateway.posts[0].body.content[1].content[0].text, "Call went well");
});

test("idempotent retry: a repeat save returns the existing note and never duplicates it", async () => {
  const gateway = fakeNotesGateway();
  const createNote = createNoteWith(gateway.fetchImpl);
  const first = await syncMeetingDraftNotes({ persistence: "durable", draftId: DRAFT_ID, candidateId: CANDIDATE_ID, transcript: "Original transcript", notes: "Original", createNote });
  const second = await syncMeetingDraftNotes({ persistence: "durable", draftId: DRAFT_ID, candidateId: CANDIDATE_ID, transcript: "Edited transcript", notes: "Edited", createNote });
  assert.equal(first.status, "synced");
  assert.equal(second.status, "stale");
  assert.equal(second.warning, MEETING_NOTES_STALE_WARNING);
  assert.equal(second.note.id, first.note.id);
  assert.equal(gateway.posts.length, 2);
  assert.equal(gateway.byOriginKey.size, 1);
  assert.equal(JSON.stringify(second.note.body).includes("Original transcript"), false);
  assert.equal(second.note.body.content[1].content[0].text, "Original");
});

test("failure: a Notes error returns a separate warning and leaves the saved meeting result intact", async () => {
  const savedResult = { ok: true, persistence: "durable", draft: { id: DRAFT_ID, transcript: "Saved transcript" } };
  const failingFetch = async () => Response.json({ error: { code: "NOTE_STORAGE_FAILED", message: "Note could not be created" } }, { status: 500 });
  const outcome = await syncMeetingDraftNotes({
    persistence: savedResult.persistence,
    draftId: savedResult.draft.id,
    candidateId: CANDIDATE_ID,
    transcript: savedResult.draft.transcript,
    createNote: createNoteWith(failingFetch),
  });
  assert.equal(outcome.status, "failed");
  assert.ok(outcome.warning.startsWith(MEETING_NOTES_FAILED_WARNING));
  assert.match(outcome.warning, /Note could not be created/);
  assert.equal(outcome.note, undefined);
  assert.deepEqual(savedResult, { ok: true, persistence: "durable", draft: { id: DRAFT_ID, transcript: "Saved transcript" } });
});

test("failure: an unreachable gateway is reported as a Notes failure, not a thrown save error", async () => {
  const unreachable = async () => { throw new Error("network down"); };
  const outcome = await syncMeetingDraftNotes({
    persistence: "durable",
    draftId: DRAFT_ID,
    candidateId: CANDIDATE_ID,
    notes: "Still here",
    createNote: createNoteWith(unreachable),
  });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.warning, /Notes could not reach Workbench/);
});
