import assert from "node:assert/strict";
import test from "node:test";
import { BoardSceneSchema } from "@ja/shared-types";
import {
  initialDataFromScene,
  sameSceneContent,
  serializeBoardScene,
} from "../src/features/board/boardScene.js";

const IMAGE_FILE = {
  id: "file-1",
  mimeType: "image/png",
  dataURL: "data:image/png;base64,iVBORw0KGgo=",
  created: 1_800_000_000_000,
};

function rect(id, overrides = {}) {
  return { id, type: "rectangle", x: 10, y: 20, width: 100, height: 60, isDeleted: false, ...overrides };
}

function image(id, fileId, overrides = {}) {
  return { id, type: "image", fileId, x: 0, y: 0, width: 50, height: 50, isDeleted: false, ...overrides };
}

test("serialized scene uses the gateway shape and passes BoardSceneSchema", () => {
  const scene = serializeBoardScene([rect("a")], { viewBackgroundColor: "#ffffff", zoom: { value: 1 }, scrollX: 4, scrollY: -8 }, {});
  assert.deepEqual(Object.keys(scene).sort(), ["appState", "elements", "source", "type", "version"]);
  assert.equal(scene.type, "excalidraw");
  assert.equal(scene.source, "workbench-board");
  assert.equal(scene.version, 1);
  assert.deepEqual(scene.appState, { viewBackgroundColor: "#ffffff", zoom: { value: 1 }, scrollX: 4, scrollY: -8 });
  assert.equal("files" in scene, false, "empty files map is omitted");
  assert.deepEqual(BoardSceneSchema.parse(scene), scene);
});

test("deleted elements are dropped and do not come back on reload", () => {
  const elements = [rect("keep-1"), rect("gone", { isDeleted: true }), rect("keep-2")];
  const saved = serializeBoardScene(elements, {}, {});
  assert.deepEqual(saved.elements.map((element) => element.id), ["keep-1", "keep-2"]);
  assert.ok(saved.elements.every((element) => element.isDeleted === false));

  const reloaded = initialDataFromScene(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reloaded.elements.map((element) => element.id), ["keep-1", "keep-2"]);
  assert.equal(reloaded.elements.some((element) => element.id === "gone"), false);
});

test("files referenced by live image elements survive a save and reload", () => {
  const saved = serializeBoardScene([image("img-1", "file-1")], {}, { "file-1": IMAGE_FILE });
  assert.deepEqual(saved.files, { "file-1": IMAGE_FILE });
  const reloaded = initialDataFromScene(JSON.parse(JSON.stringify(saved)));
  assert.equal(reloaded.files["file-1"].dataURL, IMAGE_FILE.dataURL);
  assert.equal(reloaded.elements[0].fileId, "file-1");
  assert.deepEqual(BoardSceneSchema.parse(saved), saved);
});

test("a file whose image was deleted in this session is dropped instead of kept forever", () => {
  const saved = serializeBoardScene([image("img-1", "file-1", { isDeleted: true })], {}, { "file-1": IMAGE_FILE });
  assert.equal(saved.files, undefined);
});

test("non-JSON appState values such as collaborator Maps are not persisted", () => {
  const appState = { viewBackgroundColor: "#ffffff", collaborators: new Map([["u", { name: "x" }]]), selectedElementIds: {} };
  const saved = serializeBoardScene([rect("a")], appState, {});
  assert.deepEqual(Object.keys(saved.appState), ["viewBackgroundColor"]);
  assert.doesNotThrow(() => BoardSceneSchema.parse(saved));
});

test("viewport-only moves are not content changes but element, color, and file changes are", () => {
  const base = serializeBoardScene([rect("a")], { viewBackgroundColor: "#ffffff", scrollX: 0, zoom: { value: 1 } }, {});
  const panned = serializeBoardScene([rect("a")], { viewBackgroundColor: "#ffffff", scrollX: 300, zoom: { value: 2 } }, {});
  assert.equal(sameSceneContent(base, panned), true);

  const moved = serializeBoardScene([rect("a", { x: 99 })], { viewBackgroundColor: "#ffffff" }, {});
  assert.equal(sameSceneContent(base, moved), false);
  const recolored = serializeBoardScene([rect("a")], { viewBackgroundColor: "#f5f5f5" }, {});
  assert.equal(sameSceneContent(base, recolored), false);
  const withFile = serializeBoardScene([image("img-1", "file-1")], { viewBackgroundColor: "#ffffff" }, { "file-1": IMAGE_FILE });
  assert.equal(sameSceneContent(base, withFile), false);
  const orphanFile = serializeBoardScene([rect("a")], { viewBackgroundColor: "#ffffff" }, { "file-1": IMAGE_FILE });
  assert.equal(sameSceneContent(base, orphanFile), true);
});

test("initialDataFromScene treats an empty or malformed saved scene as a blank canvas", () => {
  assert.equal(initialDataFromScene({}), null);
  assert.equal(initialDataFromScene(null), null);
  assert.deepEqual(initialDataFromScene({ elements: [] }).elements, []);
});
