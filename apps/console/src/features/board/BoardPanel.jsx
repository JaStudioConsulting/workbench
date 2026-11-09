import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Button } from "../../components/ui/button.tsx";
import { createNoteSaveQueue, createNoteSession, hasUnsavedChanges } from "../notes/noteSaveQueue.js";
import {
  createSubjectBoard,
  listSubjectBoards,
  normalizeBoardSubject,
  saveSubjectBoard,
} from "./boardClient.js";
import { initialDataFromScene, sameSceneContent, serializeBoardScene } from "./boardScene.js";

const AUTOSAVE_DELAY_MS = 700;
// Export, load, save-as, and theme actions write files or change the look outside
// the gateway, so they stay off. Changes persist only through the autosave path.
const UI_OPTIONS = Object.freeze({
  canvasActions: { export: false, loadScene: false, saveAsImage: false, saveToActiveFile: false, toggleTheme: false },
});

// Boards whose save failed or conflicted. Kept in memory only, not localStorage,
// because drawings can hold candidate detail. Subject switches and remounts keep
// them, and the next visit retries them instead of dropping the work.
const unsavedDrafts = new Map();

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (unsavedDrafts.size === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

const UNSAVED_NOTICE = "Some board changes are not saved yet. Retry save to keep them.";

function saveFailureMessage(cause) {
  return cause?.status === 409
    ? "This board changed elsewhere. Reload the saved board before editing again."
    : cause?.message || "Board could not be saved.";
}

// The note save queue is generic over {id, title, body, revision}. For boards the
// body is the Excalidraw scene and the gateway field is `scene`.
function boardSession(board) {
  return createNoteSession({ id: board.id, title: board.title, body: board.scene, updated_at: board.updated_at });
}

export default function BoardPanel({ subjectType, subjectId, defaultTitle = "" }) {
  const subject = normalizeBoardSubject(subjectType, subjectId);
  const subjectKey = subject ? `${subject.subject_type}:${subject.subject_id}` : "invalid";
  const [boards, setBoards] = useState([]);
  const [view, setView] = useState(null);
  const [mount, setMount] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState(() => (unsavedDrafts.size > 0 ? UNSAVED_NOTICE : ""));
  const sessionRef = useRef(null);
  const mountKeyRef = useRef(0);
  const timerRef = useRef(null);
  const subjectKeyRef = useRef(subjectKey);
  subjectKeyRef.current = subjectKey;
  const queueRef = useRef(null);
  if (!queueRef.current) {
    queueRef.current = createNoteSaveQueue((id, patch) => saveSubjectBoard(id, {
      title: patch.title,
      scene: patch.body,
      expected_updated_at: patch.expected_updated_at,
    }));
  }

  const persist = useCallback(async (session) => {
    // A discarded session was dropped on purpose. A save that was already in flight
    // must not bring its edits back into the drafts or the error text.
    if (session.discarded) return true;
    const onScreen = sessionRef.current === session;
    if (onScreen) setPhase("saving");
    const result = await queueRef.current(session);
    if (session.discarded) return true;
    const stillOnScreen = sessionRef.current === session;
    if (result.ok) {
      if (result.saved) {
        setBoards((current) => current.map((board) => (board.id === result.saved.id ? result.saved : board)));
      }
      if (hasUnsavedChanges(session)) {
        unsavedDrafts.set(session.id, session);
      } else if (unsavedDrafts.get(session.id) === session) {
        unsavedDrafts.delete(session.id);
      }
      // A save that succeeded on screen must not leave its own conflict or failure text up
      // while other boards still have unsaved drafts.
      if (unsavedDrafts.size === 0) setError("");
      else if (stillOnScreen) setError(UNSAVED_NOTICE);
      if (stillOnScreen) setPhase(hasUnsavedChanges(session) ? "editing" : "saved");
      return true;
    }
    unsavedDrafts.set(session.id, session);
    const message = saveFailureMessage(result.error);
    if (stillOnScreen) {
      setPhase("error");
      setError(message);
    } else {
      setError(`Changes to "${session.title || "Untitled board"}" were not saved. ${message}`);
    }
    return false;
  }, []);

  // Detaches the on-screen session. Unsaved work is saved against its own board id,
  // so a switch or unmount never sends a drawing to another record.
  const retire = useCallback(() => {
    const previous = sessionRef.current;
    sessionRef.current = null;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (hasUnsavedChanges(previous)) {
      unsavedDrafts.set(previous.id, previous);
      void persist(previous);
    }
  }, [persist]);

  const adopt = useCallback((board) => {
    const stashed = board ? unsavedDrafts.get(board.id) : null;
    const session = board ? (stashed ?? boardSession(board)) : null;
    sessionRef.current = session;
    mountKeyRef.current += 1;
    setMount(session ? { key: mountKeyRef.current, initialData: initialDataFromScene(session.body) } : null);
    setView(session ? { id: session.id, title: session.title } : null);
    setPhase(hasUnsavedChanges(session) ? "editing" : "ready");
  }, []);

  useEffect(() => {
    let active = true;
    retire();
    setBoards([]);
    setView(null);
    setMount(null);
    if (unsavedDrafts.size === 0) setError("");
    if (!subject || subject.subject_type === null) {
      setPhase("unavailable");
      return () => { active = false; };
    }
    setPhase("loading");
    listSubjectBoards(subject.subject_type, subject.subject_id).then((loaded) => {
      if (!active) return;
      setBoards(loaded);
      adopt(loaded[0] || null);
    }).catch((cause) => {
      if (!active) return;
      setPhase("error");
      setError(cause?.message || "Boards could not be loaded.");
    });
    return () => { active = false; };
  }, [subjectKey, reloadToken, adopt, retire]);

  useEffect(() => () => { retire(); }, [retire]);

  const scheduleAutosave = useCallback((session) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void persist(session);
    }, AUTOSAVE_DELAY_MS);
  }, [persist]);

  const flush = useCallback(() => {
    const session = sessionRef.current;
    if (!hasUnsavedChanges(session)) return Promise.resolve(true);
    clearTimeout(timerRef.current);
    timerRef.current = null;
    return persist(session);
  }, [persist]);

  // Excalidraw reports every change, including viewport moves. Only content changes
  // mark the board dirty. Mount keys stop a late callback from an old canvas writing
  // into the board that replaced it.
  const handleScene = useCallback((mountKey, elements, appState, files) => {
    if (mountKey !== mountKeyRef.current) return;
    const session = sessionRef.current;
    if (!session) return;
    const scene = serializeBoardScene(elements, appState, files);
    const changed = !sameSceneContent(session.body, scene);
    session.body = scene;
    if (!changed) return;
    session.version += 1;
    unsavedDrafts.set(session.id, session);
    setPhase("editing");
    scheduleAutosave(session);
  }, [scheduleAutosave]);

  const editTitle = (title) => {
    const session = sessionRef.current;
    if (!session) return;
    session.title = title;
    session.version += 1;
    unsavedDrafts.set(session.id, session);
    setView({ id: session.id, title });
    setPhase("editing");
    scheduleAutosave(session);
  };

  const retryUnsaved = () => {
    for (const session of [...unsavedDrafts.values()]) void persist(session);
  };

  // Drops the unsaved edits to the on-screen board after an explicit confirmation and
  // reloads the saved version. Nothing is dropped silently.
  const discardAndReload = () => {
    const session = sessionRef.current;
    if (!session || !unsavedDrafts.has(session.id)) return;
    if (!window.confirm("Discard unsaved changes to this board and reload the saved version?")) return;
    unsavedDrafts.delete(session.id);
    // The discarded session is dead; queued saves skip it at send time.
    session.discarded = true;
    sessionRef.current = null;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    setReloadToken((value) => value + 1);
  };

  const create = async () => {
    const requestKey = subjectKey;
    setPhase("saving");
    try {
      const created = await createSubjectBoard(subject.subject_type, subject.subject_id, String(defaultTitle).slice(0, 160));
      // The record changed while the request was in flight. The board is saved on its
      // own record and appears when that record is opened again.
      if (subjectKeyRef.current !== requestKey) return;
      setBoards((current) => [created, ...current]);
      retire();
      adopt(created);
    } catch (cause) {
      if (subjectKeyRef.current !== requestKey) return;
      setPhase("error");
      setError(cause?.message || "Board could not be created.");
    }
  };

  const choose = (board) => {
    if (board.id === view?.id) return;
    retire();
    adopt(board);
  };

  if (!subject || subject.subject_type === null) {
    return <p className="text-sm text-muted-foreground">Boards need a verified candidate, job, or saved meeting ID.</p>;
  }

  const statusText = {
    saving: "Saving…",
    saved: "Saved",
    editing: "Unsaved changes",
    error: "Not saved",
  }[phase] || "Ready";
  const onScreenUnsaved = Boolean(view && unsavedDrafts.has(view.id));

  return (
    <section className="workbench-board-panel min-w-0 space-y-3 rounded-lg border bg-card p-3" aria-label="Board">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Board</h3>
        <Button type="button" size="sm" variant="outline" onClick={create} disabled={phase === "loading" || phase === "saving"}>Add board</Button>
      </div>
      {error ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          {unsavedDrafts.size > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={retryUnsaved}>Retry save</Button>
          ) : null}
          {phase === "error" && onScreenUnsaved ? (
            <Button type="button" size="sm" variant="outline" onClick={discardAndReload}>Discard and reload saved board</Button>
          ) : null}
        </div>
      ) : null}
      {phase === "loading" ? <p role="status" className="text-sm text-muted-foreground">Loading boards…</p> : null}
      {phase !== "loading" && boards.length > 1 ? (
        <div className="flex flex-wrap gap-2" aria-label="Boards on this record">
          {boards.map((board) => (
            <button key={board.id} type="button" aria-pressed={view?.id === board.id} onClick={() => choose(board)} className="min-h-10 rounded-md border px-3 text-sm aria-pressed:border-foreground aria-pressed:bg-muted">
              {board.title || "Untitled board"}
            </button>
          ))}
        </div>
      ) : null}
      {view && mount ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium" htmlFor={`board-title-${view.id}`}>Title</label>
          <input id={`board-title-${view.id}`} value={view.title} maxLength={200} onChange={(event) => editTitle(event.target.value)} onBlur={() => { void flush(); }} className="h-11 w-full rounded-md border bg-background px-3 text-sm" />
          <div className="h-[32rem] min-w-0 overflow-hidden rounded-md border bg-background">
            <Excalidraw
              key={mount.key}
              initialData={mount.initialData}
              onChange={(elements, appState, files) => handleScene(mount.key, elements, appState, files)}
              theme="light"
              UIOptions={UI_OPTIONS}
            />
          </div>
          <p aria-live="polite" className="text-xs text-muted-foreground">{statusText}</p>
        </div>
      ) : phase !== "loading" ? <p className="text-sm text-muted-foreground">No board yet. Add one to start.</p> : null}
    </section>
  );
}
