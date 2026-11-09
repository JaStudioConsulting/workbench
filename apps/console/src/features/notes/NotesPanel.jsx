import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, EditorRoot, StarterKit } from "novel";
import { Button } from "../../components/ui/button.tsx";
import {
  createSubjectNote,
  listSubjectNotes,
  normalizeNoteSubject,
  saveSubjectNote,
} from "./notesClient.js";
import { createNoteSaveQueue, createNoteSession, hasUnsavedChanges } from "./noteSaveQueue.js";
import MeetingTranscriptPreview from "./MeetingTranscriptPreview.jsx";

const EMPTY_DOCUMENT = { type: "doc", content: [{ type: "paragraph" }] };
const AUTOSAVE_DELAY_MS = 700;

// Sessions whose save failed (or that were retired before saving). Kept in memory,
// not localStorage, because notes hold candidate detail. Tab switches unmount the
// panel, so this survives remounts and lets the next visit retry instead of dropping text.
const unsavedDrafts = new Map();

// A failed save remains only in memory. Warn before a reload would discard it.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (unsavedDrafts.size === 0) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function saveFailureMessage(cause) {
  return cause?.status === 409
    ? "This note changed elsewhere. Reload notes before editing again."
    : cause?.message || "Note could not be saved.";
}

export default function NotesPanel({ subjectType, subjectId, defaultTitle = "" }) {
  const subject = normalizeNoteSubject(subjectType, subjectId);
  const subjectKey = subject ? `${subject.subject_type}:${subject.subject_id}` : "invalid";
  const [notes, setNotes] = useState([]);
  const [view, setView] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(() => (unsavedDrafts.size > 0
    ? "Some note changes are not saved yet. Retry save to keep them."
    : ""));
  const sessionRef = useRef(null);
  const timerRef = useRef(null);
  const subjectKeyRef = useRef(subjectKey);
  subjectKeyRef.current = subjectKey;
  const queueRef = useRef(null);
  if (!queueRef.current) queueRef.current = createNoteSaveQueue(saveSubjectNote);

  const persist = useCallback(async (session) => {
    const onScreen = sessionRef.current === session;
    if (onScreen) setPhase("saving");
    const result = await queueRef.current(session);
    const stillOnScreen = sessionRef.current === session;
    if (result.ok) {
      if (result.saved) {
        setNotes((current) => current.map((note) => (note.id === result.saved.id ? result.saved : note)));
      }
      if (hasUnsavedChanges(session)) {
        unsavedDrafts.set(session.id, session);
      } else if (unsavedDrafts.get(session.id) === session) {
        unsavedDrafts.delete(session.id);
      }
      if (unsavedDrafts.size === 0) setError("");
      if (stillOnScreen) setPhase(hasUnsavedChanges(session) ? "editing" : "saved");
      return true;
    }
    unsavedDrafts.set(session.id, session);
    const message = saveFailureMessage(result.error);
    if (stillOnScreen) {
      setPhase("error");
      setError(message);
    } else {
      setError(`Changes to "${session.title || "Untitled note"}" were not saved. ${message}`);
    }
    return false;
  }, []);

  // Detaches the current session from the screen. Unsaved edits are saved against
  // their own note id, so a switch or unmount never sends them to another record.
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

  const adopt = useCallback((note) => {
    const stashed = note ? unsavedDrafts.get(note.id) : null;
    const session = note ? (stashed ?? createNoteSession(note)) : null;
    sessionRef.current = session;
    setView(session ? { id: session.id, title: session.title, body: session.body } : null);
    setPhase(hasUnsavedChanges(session) ? "editing" : "ready");
  }, []);

  useEffect(() => {
    let active = true;
    retire();
    setNotes([]);
    setView(null);
    if (unsavedDrafts.size === 0) setError("");
    if (!subject || subject.subject_type === null) {
      setPhase("unavailable");
      return () => { active = false; };
    }
    setPhase("loading");
    listSubjectNotes(subject.subject_type, subject.subject_id).then((loaded) => {
      if (!active) return;
      setNotes(loaded);
      adopt(loaded[0] || null);
    }).catch((cause) => {
      if (!active) return;
      setPhase("error");
      setError(cause?.message || "Notes could not be loaded.");
    });
    return () => { active = false; };
  }, [subjectKey, adopt, retire]);

  useEffect(() => () => { retire(); }, [retire]);

  const flush = useCallback(() => {
    const session = sessionRef.current;
    if (!hasUnsavedChanges(session)) return Promise.resolve(true);
    clearTimeout(timerRef.current);
    timerRef.current = null;
    return persist(session);
  }, [persist]);

  const edit = (patch) => {
    const session = sessionRef.current;
    if (!session) return;
    Object.assign(session, patch);
    session.version += 1;
    unsavedDrafts.set(session.id, session);
    setView({ id: session.id, title: session.title, body: session.body });
    setPhase("editing");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void persist(session);
    }, AUTOSAVE_DELAY_MS);
  };

  const retryUnsaved = () => {
    for (const session of [...unsavedDrafts.values()]) void persist(session);
  };

  const create = async () => {
    const requestKey = subjectKey;
    setPhase("saving");
    try {
      const created = await createSubjectNote(subject.subject_type, subject.subject_id, String(defaultTitle).slice(0, 160));
      // The record changed while the request was in flight. The note is saved on its
      // own record and appears when that record is opened again; it is not shown here.
      if (subjectKeyRef.current !== requestKey) return;
      setNotes((current) => [created, ...current]);
      retire();
      adopt(created);
    } catch (cause) {
      if (subjectKeyRef.current !== requestKey) return;
      setPhase("error");
      setError(cause?.message || "Note could not be created.");
    }
  };

  const choose = (note) => {
    if (note.id === view?.id) return;
    retire();
    adopt(note);
  };

  if (!subject || subject.subject_type === null) {
    return <p className="text-sm text-muted-foreground">Notes need a verified candidate, job, or saved meeting ID.</p>;
  }

  const activeOriginKey = notes.find((note) => note.id === view?.id)?.origin_key;

  const statusText = {
    saving: "Saving…",
    saved: "Saved",
    editing: "Unsaved changes",
    error: "Not saved",
  }[phase] || "Ready";

  return (
    <section className="workbench-notes-panel min-w-0 space-y-3 rounded-lg border bg-card p-3" aria-label="Notes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Notes</h3>
        <Button type="button" size="sm" variant="outline" onClick={create} disabled={phase === "loading" || phase === "saving"}>Add note</Button>
      </div>
      {error ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          {unsavedDrafts.size > 0 ? (
            <Button type="button" size="sm" variant="outline" onClick={retryUnsaved}>Retry save</Button>
          ) : null}
        </div>
      ) : null}
      {phase === "loading" ? <p role="status" className="text-sm text-muted-foreground">Loading notes…</p> : null}
      {phase !== "loading" && notes.length > 1 ? (
        <div className="flex flex-wrap gap-2" aria-label="Notes on this record">
          {notes.map((note) => (
            <button key={note.id} type="button" aria-pressed={view?.id === note.id} onClick={() => choose(note)} className="min-h-10 rounded-md border px-3 text-sm aria-pressed:border-foreground aria-pressed:bg-muted">
              {note.title || "Untitled note"}
            </button>
          ))}
        </div>
      ) : null}
      {view ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium" htmlFor={`note-title-${view.id}`}>Title</label>
          <input id={`note-title-${view.id}`} value={view.title} maxLength={200} onChange={(event) => edit({ title: event.target.value })} onBlur={() => { void flush(); }} className="h-11 w-full rounded-md border bg-background px-3 text-sm" />
          <EditorRoot>
            <EditorContent
              key={view.id}
              initialContent={view.body?.type === "doc" ? view.body : EMPTY_DOCUMENT}
              extensions={[StarterKit]}
              className="workbench-note-editor min-h-40 rounded-md border bg-background p-3 text-sm"
              onUpdate={({ editor }) => edit({ body: editor.getJSON() })}
              onBlur={() => { void flush(); }}
            />
          </EditorRoot>
          {subject.subject_type === "candidate" && activeOriginKey?.startsWith("meeting_draft:") ? (
            <MeetingTranscriptPreview key={view.id} originKey={activeOriginKey} candidateId={subject.subject_id} />
          ) : null}
          <p aria-live="polite" className="text-xs text-muted-foreground">{statusText}</p>
        </div>
      ) : phase !== "loading" ? <p className="text-sm text-muted-foreground">No notes yet. Add one to start.</p> : null}
    </section>
  );
}
