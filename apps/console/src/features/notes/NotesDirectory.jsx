import { useEffect, useMemo, useReducer, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { listAllOwnerNotes } from "./notesClient.js";
import {
  buildNoteDirectoryEntries,
  directoryReducer,
  formatNoteTimestamp,
  INITIAL_DIRECTORY_STATE,
  resolveDirectoryView,
} from "./notesDirectory.js";

function countLabel(count) {
  return count === 1 ? "1 note" : `${count} notes`;
}

export default function NotesDirectory({ focusRequest = null, onOpenSubject, loader = listAllOwnerNotes }) {
  const [state, dispatch] = useReducer(directoryReducer, INITIAL_DIRECTORY_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    dispatch({ type: "load" });
    Promise.resolve()
      .then(() => loader())
      .then((result) => {
        if (active) dispatch({ type: "loaded", notes: result.notes, truncated: result.truncated });
      })
      .catch((cause) => {
        if (active) dispatch({ type: "failed", message: cause?.message });
      });
    return () => {
      active = false;
    };
  }, [loader, attempt]);

  // A new focusRequest object comes from each search selection, so re-selecting the same note still focuses it.
  useEffect(() => {
    if (focusRequest?.noteId) dispatch({ type: "focus", noteId: focusRequest.noteId });
  }, [focusRequest]);

  const entries = useMemo(() => buildNoteDirectoryEntries(state.notes), [state.notes]);
  const view = useMemo(() => resolveDirectoryView(state, entries), [state, entries]);

  if (state.phase === "loading") {
    return (
      <section className="flex items-center gap-2 rounded-xl border p-6 text-sm" role="status" aria-label="Loading notes">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading notes...
      </section>
    );
  }

  if (state.phase === "error") {
    return (
      <section className="flex flex-col items-start gap-3 rounded-xl border p-6 text-sm" role="alert">
        <p>{state.error || "Notes could not be loaded."}</p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          <RefreshCw aria-hidden="true" /> Retry
        </Button>
      </section>
    );
  }

  const trimmedQuery = state.query.trim();
  const { visible, selectedEntry, focusMissing, emptyKind } = view;

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Notes directory" data-testid="notes-directory">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="notes-directory-search" className="sr-only">Search notes</label>
        <div className="relative min-w-0 flex-1 max-w-xl">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            id="notes-directory-search"
            type="search"
            value={state.query}
            onChange={(event) => dispatch({ type: "query", value: event.target.value })}
            placeholder="Search note titles and text"
            className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
          />
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {trimmedQuery ? `${visible.length} of ${countLabel(view.entries.length)}` : countLabel(view.entries.length)}
        </p>
      </div>

      {focusMissing ? (
        <p className="rounded-lg border p-3 text-sm" role="alert">That note is no longer in your notes.</p>
      ) : null}

      {emptyKind === "empty" ? (
        <div className="rounded-xl border p-6 text-sm" data-testid="notes-empty">No notes yet.</div>
      ) : emptyKind === "no-match" ? (
        <div className="rounded-xl border p-6 text-sm" data-testid="notes-no-match">No notes match “{trimmedQuery}”.</div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <ul aria-label="Notes, newest first" className="flex min-w-0 flex-col divide-y rounded-xl border">
            {visible.map((entry) => {
              const isSelected = selectedEntry?.id === entry.id;
              const updated = formatNoteTimestamp(entry.updatedAt);
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    data-note-id={entry.id}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => dispatch({ type: "select", id: entry.id })}
                    className={`flex w-full min-w-0 flex-col gap-1 p-3 text-left hover:bg-muted ${isSelected ? "bg-muted" : ""}`}
                  >
                    <span className="truncate text-sm font-medium">{entry.displayTitle}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {entry.subject.label}{updated ? ` · ${updated}` : ""}
                    </span>
                    {entry.snippet ? <span className="line-clamp-2 text-sm text-muted-foreground">{entry.snippet}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <article aria-label="Note preview" data-testid="note-preview" className="min-w-0 rounded-xl border p-4">
            {selectedEntry ? (
              <>
                <h2 className="break-words text-lg font-semibold">{selectedEntry.displayTitle}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedEntry.subject.label}
                  {formatNoteTimestamp(selectedEntry.updatedAt) ? ` · Updated ${formatNoteTimestamp(selectedEntry.updatedAt)}` : ""}
                </p>
                {selectedEntry.subject.link && typeof onOpenSubject === "function" ? (
                  <Button className="mt-3" variant="outline" size="sm" onClick={() => onOpenSubject(selectedEntry.subject.link)}>
                    {selectedEntry.subject.actionLabel}
                  </Button>
                ) : null}
                <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                  {selectedEntry.plainText || "This note has no text yet."}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a note to preview it.</p>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
