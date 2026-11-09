import assert from "node:assert/strict";
import test from "node:test";
import {
  createSubjectNote,
  listSubjectNotes,
  normalizeNoteSubject,
  saveSubjectNote,
} from "../src/features/notes/notesClient.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const NOTE_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDATE_ID = "manual:33333333-3333-4333-8333-333333333333";

test("Novel notes create, autosave, and reload by exact candidate source ID", async () => {
  let stored = null;
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "test-session" } }, error: null }) } };
  const fetchImpl = async (path, options) => {
    assert.equal(options.headers.Authorization, "Bearer test-session");
    const url = new URL(path, "https://workbench.example.invalid");
    if (options.method === "GET") {
      assert.equal(url.searchParams.get("subject_type"), "candidate");
      assert.equal(url.searchParams.get("subject_id"), CANDIDATE_ID);
      return Response.json({ notes: stored ? [stored] : [] });
    }
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.subject_id, CANDIDATE_ID);
      stored = {
        id: NOTE_ID,
        owner_id: OWNER,
        title: body.title,
        subject_type: body.subject_type,
        subject_id: body.subject_id,
        body: body.body,
        created_at: "2026-11-09T00:00:00.000Z",
        updated_at: "2026-11-09T00:00:00.000Z",
      };
      return Response.json({ note: stored }, { status: 201 });
    }
    assert.equal(options.method, "PATCH");
    assert.equal(url.pathname, `/api/notes/${NOTE_ID}`);
    const patch = JSON.parse(options.body);
    assert.equal(patch.expected_updated_at, stored.updated_at);
    stored = { ...stored, title: patch.title, body: patch.body, updated_at: "2026-11-09T00:00:01.000Z" };
    return Response.json({ note: stored });
  };

  assert.deepEqual(await listSubjectNotes("candidate", CANDIDATE_ID, { client, fetchImpl }), []);
  const created = await createSubjectNote("candidate", CANDIDATE_ID, "Call notes", { client, fetchImpl });
  assert.equal(created.subject_id, CANDIDATE_ID);
  const saved = await saveSubjectNote(NOTE_ID, {
    title: "Verified call notes",
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Source-backed detail" }] }] },
    expected_updated_at: created.updated_at,
  }, { client, fetchImpl });
  assert.equal(saved.body.content[0].content[0].text, "Source-backed detail");
  const reloaded = await listSubjectNotes("candidate", CANDIDATE_ID, { client, fetchImpl });
  assert.equal(reloaded[0].title, "Verified call notes");
  assert.equal(reloaded[0].updated_at, saved.updated_at);
});

test("notes require a verified subject and a Supabase session", async () => {
  assert.equal(normalizeNoteSubject("candidate", "manual:bad"), null);
  await assert.rejects(() => listSubjectNotes("candidate", "manual:bad"), /verified/);
  const client = { auth: { getSession: async () => ({ data: { session: null }, error: null }) } };
  await assert.rejects(() => listSubjectNotes("job", "1", { client, fetchImpl: () => { throw new Error("should not fetch"); } }), /Sign in/);
});
