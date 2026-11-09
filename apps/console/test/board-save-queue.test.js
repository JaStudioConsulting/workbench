import assert from "node:assert/strict";
import test from "node:test";
import { saveSubjectBoard } from "../src/features/board/boardClient.js";
import { createNoteSaveQueue, createNoteSession, hasUnsavedChanges } from "../src/features/notes/noteSaveQueue.js";

// The board panel uses the shared note save queue with saveSubjectBoard as the writer.
// These tests drive that real client through a fake gateway that enforces the
// revision check the way PATCH /api/boards/:id does.

const OWNER = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CANDIDATE_ID = "manual:33333333-3333-4333-8333-333333333333";
const T0 = "2026-11-09T00:00:00.000Z";
const T1 = "2026-11-09T00:00:01.000Z";
const T2 = "2026-11-09T00:00:02.000Z";

const client = { auth: { getSession: async () => ({ data: { session: { access_token: "t" } }, error: null }) } };

function scene(text) {
  return { type: "excalidraw", version: 1, source: "workbench-board", elements: [{ id: "n", type: "text", text }], appState: {} };
}

function fakeGateway({ updated_at = T0 } = {}) {
  const state = { board: { id: BOARD_ID, owner_id: OWNER, title: "Org", subject_type: "candidate", subject_id: CANDIDATE_ID, scene: scene(""), created_at: T0, updated_at } };
  const patches = [];
  let revisions = 0;
  let gate = null;
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = async (path, options) => {
    assert.equal(options.method, "PATCH");
    assert.equal(options.headers.Authorization, "Bearer t");
    const body = JSON.parse(options.body);
    patches.push(body);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (gate) await gate;
      if (body.expected_updated_at !== state.board.updated_at) {
        return Response.json({ error: { code: "AUTOSAVE_CONFLICT", message: "Board was modified by a newer save" } }, { status: 409 });
      }
      revisions += 1;
      state.board = { ...state.board, title: body.title ?? state.board.title, scene: body.scene ?? state.board.scene, updated_at: `2026-11-09T00:00:0${revisions}.000Z` };
      return Response.json({ board: state.board });
    } finally {
      inFlight -= 1;
    }
  };
  return {
    state,
    patches,
    fetchImpl,
    get maxInFlight() { return maxInFlight; },
    hold() { let release; gate = new Promise((resolve) => { release = resolve; }); return () => { gate = null; release(); }; },
  };
}

// Same field mapping as BoardPanel: the queue snapshot's `body` is the gateway's `scene`.
function boardSave(gateway) {
  return (id, patch) => saveSubjectBoard(id, {
    title: patch.title,
    scene: patch.body,
    expected_updated_at: patch.expected_updated_at,
  }, { client, fetchImpl: gateway.fetchImpl });
}

function boardSession(text, updated_at = T0) {
  const session = createNoteSession({ id: BOARD_ID, title: "Org", body: scene(text), updated_at });
  return session;
}

function edit(session, text) {
  session.body = scene(text);
  session.version += 1;
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

test("a flush during an in-flight board save reuses the returned revision and never sends a stale PATCH", async () => {
  const gateway = fakeGateway();
  const enqueue = createNoteSaveQueue(boardSave(gateway));
  const session = boardSession("");
  edit(session, "first sketch");
  const release = gateway.hold();
  const first = enqueue(session);
  await nextTick();
  edit(session, "first sketch plus arrow");
  const second = enqueue(session);
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(a.ok, true);
  assert.equal(b.ok, true, "the follow-up save must not conflict with its own predecessor");
  assert.equal(gateway.maxInFlight, 1, "board saves for one panel never overlap");
  assert.equal(gateway.patches.length, 2);
  assert.equal(gateway.patches[1].expected_updated_at, T1);
  assert.equal(gateway.state.board.scene.elements[0].text, "first sketch plus arrow");
  assert.equal(session.revision, gateway.state.board.updated_at);
  assert.equal(hasUnsavedChanges(session), false);
});

test("a board saved elsewhere is reported as a 409 and the local draft stays recoverable", async () => {
  const gateway = fakeGateway();
  const enqueue = createNoteSaveQueue(boardSave(gateway));
  const session = boardSession("");
  // Another tab saved first, moving the server revision past this session's.
  gateway.state.board.updated_at = T2;
  edit(session, "my offline edit");

  const result = await enqueue(session);

  assert.equal(result.ok, false);
  assert.equal(result.error.status, 409);
  assert.equal(result.error.code, "AUTOSAVE_CONFLICT");
  assert.equal(hasUnsavedChanges(session), true, "a conflict must keep the drawing as an unsaved draft");
  assert.equal(session.revision, T0, "a conflict must not advance the revision");
  assert.equal(gateway.state.board.scene.elements[0].text, "", "the conflicting save must not overwrite the other tab");
});

test("saves for two boards queued on one panel reach their own IDs in queue order", async () => {
  const OTHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const writes = [];
  const gateway = fakeGateway();
  const enqueue = createNoteSaveQueue((id, patch) => {
    writes.push(id);
    return boardSave(gateway)(id, patch);
  });
  const session = boardSession("");
  const other = createNoteSession({ id: OTHER_ID, title: "Other", body: scene(""), updated_at: T0 });
  edit(session, "board A");
  edit(other, "board B");
  const first = enqueue(session);
  const second = enqueue(other);
  await Promise.all([first, second]);

  assert.deepEqual(writes, [BOARD_ID, OTHER_ID], "each draft writes to its own board, in order");
});

test("a discarded board session is skipped before its queued PATCH begins", async () => {
  const writes = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const enqueue = createNoteSaveQueue(async (id) => {
    writes.push(id);
    if (writes.length === 1) await firstGate;
    return { id, updated_at: T1 };
  });
  const first = boardSession("");
  const discarded = createNoteSession({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Discard", body: scene(""), updated_at: T0 });
  edit(first, "save this");
  edit(discarded, "discard this");
  const firstSave = enqueue(first);
  await nextTick();
  const queuedSave = enqueue(discarded);
  discarded.discarded = true;
  releaseFirst();
  const [saved, skipped] = await Promise.all([firstSave, queuedSave]);
  assert.equal(saved.ok, true);
  assert.deepEqual(skipped, { ok: true, saved: null });
  assert.deepEqual(writes, [BOARD_ID]);
});
