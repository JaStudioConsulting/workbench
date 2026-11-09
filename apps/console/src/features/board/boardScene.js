// Converts Excalidraw state to the JSON scene shape the gateway accepts
// (BoardSceneSchema in @ja/shared-types) and back. Excalidraw's live appState
// holds non-JSON values such as a Map of collaborators, so only a small set of
// view keys is persisted. Deleted elements are dropped to stay under the
// element and byte limits.

export const BOARD_SCENE_VERSION = 1;
export const BOARD_SCENE_SOURCE = "workbench-board";

const PERSISTED_VIEW_KEYS = Object.freeze(["viewBackgroundColor", "gridSize", "zoom", "scrollX", "scrollY"]);
// Changes that only move the viewport are saved with the next content change
// but do not on their own mark the board as having unsaved work.
const CONTENT_VIEW_KEYS = Object.freeze(["viewBackgroundColor", "gridSize"]);

export function serializeBoardScene(elements, appState, files) {
  const liveElements = Array.from(elements || []).filter((element) => element && !element.isDeleted);
  const view = {};
  for (const key of PERSISTED_VIEW_KEYS) {
    if (appState && appState[key] !== undefined) view[key] = appState[key];
  }
  const scene = {
    type: "excalidraw",
    version: BOARD_SCENE_VERSION,
    source: BOARD_SCENE_SOURCE,
    elements: liveElements,
    appState: view,
  };
  const referencedFileIds = new Set(liveElements
    .filter((element) => element.type === "image" && typeof element.fileId === "string")
    .map((element) => element.fileId));
  const fileEntries = files ? Object.entries(files).filter(([id]) => referencedFileIds.has(id)) : [];
  if (fileEntries.length > 0) scene.files = Object.fromEntries(fileEntries);
  // JSON round-trip removes undefined, functions, and class instances so the
  // stored value is plain JSON and compares stably.
  return JSON.parse(JSON.stringify(scene));
}

export function initialDataFromScene(scene) {
  if (!scene || typeof scene !== "object" || !Array.isArray(scene.elements)) return null;
  return {
    elements: scene.elements,
    appState: scene.appState && typeof scene.appState === "object" ? scene.appState : {},
    files: scene.files && typeof scene.files === "object" ? scene.files : {},
  };
}

export function sameSceneContent(a, b) {
  if (!a || !b) return a === b;
  const pick = (scene) => ({
    elements: scene.elements ?? [],
    view: Object.fromEntries(CONTENT_VIEW_KEYS.map((key) => [key, scene.appState?.[key] ?? null])),
    files: scene.files ?? null,
  });
  return JSON.stringify(pick(a)) === JSON.stringify(pick(b));
}
