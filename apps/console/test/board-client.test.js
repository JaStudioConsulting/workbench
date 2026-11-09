import assert from "node:assert/strict";
import test from "node:test";
import {
  createSubjectBoard,
  listSubjectBoards,
  normalizeBoardSubject,
  saveSubjectBoard,
} from "../src/features/board/boardClient.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDATE_ID = "manual:33333333-3333-4333-8333-333333333333";
const JOB_ID = "501";
const T0 = "2026-11-09T00:00:00.000Z";
const T1 = "2026-11-09T00:00:01.000Z";

function clientWithToken(token = "test-session") {
  return { auth: { getSession: async () => ({ data: { session: { access_token: token } }, error: null }) } };
}

function scene(elements = []) {
  return { type: "excalidraw", version: 1, source: "workbench-board", elements, appState: { viewBackgroundColor: "#ffffff" } };
}

test("candidate board creates, saves, and reloads under the exact subject ID with bearer auth", async () => {
  let stored = null;
  const seenAuth = [];
  const client = clientWithToken("candidate-token");
  const fetchImpl = async (path, options) => {
    seenAuth.push(options.headers.Authorization);
    const url = new URL(path, "https://workbench.example.invalid");
    if (options.method === "GET") {
      assert.equal(url.pathname, "/api/boards");
      assert.equal(url.searchParams.get("subject_type"), "candidate");
      assert.equal(url.searchParams.get("subject_id"), CANDIDATE_ID);
      return Response.json({ boards: stored ? [stored] : [] });
    }
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.subject_type, "candidate");
      assert.equal(body.subject_id, CANDIDATE_ID);
      assert.deepEqual(body.scene, {});
      stored = {
        id: BOARD_ID, owner_id: OWNER, title: body.title, subject_type: body.subject_type,
        subject_id: body.subject_id, scene: body.scene, created_at: T0, updated_at: T0,
      };
      return Response.json({ board: stored }, { status: 201 });
    }
    assert.equal(options.method, "PATCH");
    assert.equal(url.pathname, `/api/boards/${BOARD_ID}`);
    const patch = JSON.parse(options.body);
    assert.equal(patch.expected_updated_at, stored.updated_at);
    stored = { ...stored, title: patch.title, scene: patch.scene, updated_at: T1 };
    return Response.json({ board: stored });
  };

  assert.deepEqual(await listSubjectBoards("candidate", CANDIDATE_ID, { client, fetchImpl }), []);
  const created = await createSubjectBoard("candidate", CANDIDATE_ID, "Plant org chart", { client, fetchImpl });
  assert.equal(created.subject_id, CANDIDATE_ID);
  const drawing = scene([{ id: "node-1", type: "rectangle", x: 0, y: 0, width: 100, height: 60 }]);
  const saved = await saveSubjectBoard(BOARD_ID, { title: "Plant org chart v2", scene: drawing, expected_updated_at: created.updated_at }, { client, fetchImpl });
  assert.equal(saved.updated_at, T1);
  const reloaded = await listSubjectBoards("candidate", CANDIDATE_ID, { client, fetchImpl });
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].title, "Plant org chart v2");
  assert.deepEqual(reloaded[0].scene.elements, drawing.elements);
  assert.equal(reloaded[0].updated_at, saved.updated_at);
  assert.ok(seenAuth.length >= 4);
  assert.ok(seenAuth.every((header) => header === "Bearer candidate-token"));
});

test("job subject IDs stay exact numeric strings on list and create", async () => {
  const urls = [];
  const client = clientWithToken();
  const fetchImpl = async (path, options) => {
    urls.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (options.method === "POST") {
      return Response.json({
        board: { id: BOARD_ID, owner_id: OWNER, title: "", subject_type: "job", subject_id: JOB_ID, scene: {}, created_at: T0, updated_at: T0 },
      }, { status: 201 });
    }
    return Response.json({ boards: [] });
  };
  await listSubjectBoards("job", JOB_ID, { client, fetchImpl });
  const created = await createSubjectBoard("job", JOB_ID, "", { client, fetchImpl });
  assert.equal(created.subject_id, JOB_ID);
  assert.equal(new URL(urls[0].path, "https://workbench.example.invalid").searchParams.get("subject_id"), JOB_ID);
  assert.equal(urls[1].body.subject_id, JOB_ID);
  assert.equal(urls[1].body.subject_type, "job");
});

test("a stale autosave surfaces the gateway 409 so the draft is not reported as saved", async () => {
  const client = clientWithToken();
  const fetchImpl = async () => Response.json(
    { error: { code: "AUTOSAVE_CONFLICT", message: "Board was modified by a newer save" } },
    { status: 409 },
  );
  await assert.rejects(
    () => saveSubjectBoard(BOARD_ID, { scene: scene(), expected_updated_at: T0 }, { client, fetchImpl }),
    (error) => error.status === 409 && error.code === "AUTOSAVE_CONFLICT" && /newer save/.test(error.message),
  );
});

test("boards require a verified subject and a Supabase session before any request", async () => {
  assert.equal(normalizeBoardSubject("candidate", "manual:not-a-uuid"), null);
  await assert.rejects(() => listSubjectBoards("candidate", "manual:not-a-uuid"), /verified/);
  await assert.rejects(() => createSubjectBoard("job", "abc", "x"), /verified/);

  const signedOut = { auth: { getSession: async () => ({ data: { session: null }, error: null }) } };
  const fetchImpl = () => { throw new Error("should not fetch"); };
  await assert.rejects(() => listSubjectBoards("job", JOB_ID, { client: signedOut, fetchImpl }), /Sign in/);
});

test("an over-limit scene is rejected on the client without a network request", async () => {
  const fetchImpl = () => { throw new Error("should not fetch"); };
  const huge = scene(Array.from({ length: 1001 }, (_, idx) => ({ id: `el-${idx}`, type: "rectangle" })));
  await assert.rejects(
    () => saveSubjectBoard(BOARD_ID, { scene: huge, expected_updated_at: T0 }, { client: clientWithToken(), fetchImpl }),
    (error) => error.code === "INVALID_INPUT" && error.status === 400,
  );
});
