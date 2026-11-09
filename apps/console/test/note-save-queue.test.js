import assert from "node:assert/strict";
import test from "node:test";
import {
  createNoteSaveQueue,
  createNoteSession,
  hasUnsavedChanges,
} from "../src/features/notes/noteSaveQueue.js";

const NOTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T0 = "2026-11-09T00:00:00.000Z";
const T1 = "2026-11-09T00:00:01.000Z";
const T2 = "2026-11-09T00:00:02.000Z";

function doc(text) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

// Fake server that enforces optimistic concurrency the way the gateway does:
// a PATCH whose expected_updated_at is not the current revision gets a 409.
function fakeServer(initial) {
  const state = { ...initial };
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let gate = null;
  let failNext = null;
  const save = async (id, patch) => {
    calls.push({ id, patch });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (gate) await gate;
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      if (patch.expected_updated_at !== state.updated_at) {
        const error = new Error("conflict");
        error.status = 409;
        throw error;
      }
      state.title = patch.title;
      state.body = patch.body;
      state.updated_at = state.next_updated_at;
      return { id, title: state.title, body: state.body, updated_at: state.updated_at };
    } finally {
      inFlight -= 1;
    }
  };
  return {
    save,
    calls,
    get maxInFlight() { return maxInFlight; },
    holdSaves() { let release; gate = new Promise((resolve) => { release = resolve; }); return () => { gate = null; release(); }; },
    failNextWith(error) { failNext = error; },
    state,
  };
}

function nextTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function edit(session, title, text) {
  session.title = title;
  session.body = doc(text);
  session.version += 1;
}

test("two flushes for one edit send exactly one PATCH and both resolve", async () => {
  const server = fakeServer({ updated_at: T0, next_updated_at: T1 });
  const enqueue = createNoteSaveQueue(server.save);
  const session = createNoteSession({ id: NOTE_A, title: "Call", body: doc(""), updated_at: T0 });
  edit(session, "Call", "Spoke with candidate");

  const [first, second] = await Promise.all([enqueue(session), enqueue(session)]);

  assert.equal(server.calls.length, 1, "duplicate flush must not issue a second PATCH");
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(hasUnsavedChanges(session), false);
  assert.equal(session.revision, T1);
});

test("an edit made during an in-flight save is sent with the revision that save returned, not a 409", async () => {
  const server = fakeServer({ updated_at: T0, next_updated_at: T1 });
  const enqueue = createNoteSaveQueue(server.save);
  const session = createNoteSession({ id: NOTE_A, title: "Call", body: doc(""), updated_at: T0 });
  edit(session, "Call", "first pass");

  const release = server.holdSaves();
  const firstSave = enqueue(session);
  await nextTick(); // first PATCH is now in flight with "first pass" as its snapshot
  edit(session, "Call", "first pass plus more");
  const secondSave = enqueue(session);
  // Old code could issue this second PATCH concurrently with the first, reusing T0 and getting a 409.
  release();
  const [first, second] = await Promise.all([firstSave, secondSave]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true, "second save must not fail with a spurious conflict");
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[1].patch.expected_updated_at, T1);
  assert.equal(server.maxInFlight, 1, "saves for one panel must never overlap");
  assert.equal(server.state.title, "Call");
  assert.equal(hasUnsavedChanges(session), false);
});

test("a failed save keeps the draft unsaved and a retry sends the same revision with the latest text", async () => {
  const server = fakeServer({ updated_at: T0, next_updated_at: T1 });
  const enqueue = createNoteSaveQueue(server.save);
  const session = createNoteSession({ id: NOTE_A, title: "Call", body: doc(""), updated_at: T0 });
  edit(session, "Call", "keep me");
  server.failNextWith(Object.assign(new Error("Notes could not reach Workbench."), { status: 0 }));

  const failed = await enqueue(session);

  assert.equal(failed.ok, false);
  assert.equal(hasUnsavedChanges(session), true, "failed save must leave the draft recoverable");
  assert.equal(session.revision, T0, "failed save must not advance the revision");

  const retried = await enqueue(session);
  assert.equal(retried.ok, true);
  assert.equal(server.calls[1].patch.expected_updated_at, T0);
  assert.equal(server.state.body.content[0].content[0].text, "keep me");
  assert.equal(hasUnsavedChanges(session), false);
});

test("a retired session saves to its own note even after another note is on screen", async () => {
  const server = fakeServer({ updated_at: T0, next_updated_at: T1 });
  const enqueue = createNoteSaveQueue(server.save);
  const jobNote = createNoteSession({ id: NOTE_A, title: "Job A", body: doc(""), updated_at: T0 });
  edit(jobNote, "Job A", "pending edit from job A");
  // Subject switches here: the panel adopts a different note while jobNote is still unsaved.
  const otherNote = createNoteSession({ id: NOTE_B, title: "Job B", body: doc(""), updated_at: T0 });
  const retiredSave = enqueue(jobNote);
  const pendingOther = enqueue(otherNote);

  const [retired, other] = await Promise.all([retiredSave, pendingOther]);

  assert.equal(retired.ok, true);
  assert.equal(other.ok, true);
  assert.equal(server.calls[0].id, NOTE_A, "job A edit must not be written to job B's note");
  assert.equal(server.calls.length, 1, "clean session must not send a PATCH");
});

test("saves for a panel run one at a time in the order they were queued", async () => {
  const server = fakeServer({ updated_at: T0, next_updated_at: T1 });
  const enqueue = createNoteSaveQueue(server.save);
  const session = createNoteSession({ id: NOTE_A, title: "Call", body: doc(""), updated_at: T0 });
  const release = server.holdSaves();

  edit(session, "Call", "one");
  const one = enqueue(session);
  await nextTick();
  edit(session, "Call", "two");
  const two = enqueue(session);
  release();
  await Promise.all([one, two]);

  assert.equal(server.maxInFlight, 1);
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[0].patch.body.content[0].content[0].text, "one");
  assert.equal(server.calls[1].patch.body.content[0].content[0].text, "two");
});
