import { MAX_NOTE_BODY_DEPTH, parseWorkbenchSubjectLink } from "@ja/shared-types";

export const NOTE_SNIPPET_LENGTH = 160;
export const NOTE_SEARCH_MAX_TOKENS = 12;

function isJsonObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInlineNode(node) {
  return node.type === "text" || node.type === "hardBreak";
}

// Collects only visible text: text leaves and hard breaks. Node type names, attrs,
// and marks never reach the output, so a query such as "paragraph" cannot match
// the editor structure. Blocks are separated by newlines.
function ensureLineBreak(out) {
  if (out.length > 0 && !out[out.length - 1].endsWith("\n")) out.push("\n");
}

function collectText(node, depth, out) {
  if (!isJsonObject(node) || depth > MAX_NOTE_BODY_DEPTH) return;
  if (node.type === "text") {
    if (typeof node.text === "string") out.push(node.text);
    return;
  }
  if (node.type === "hardBreak") {
    out.push("\n");
    return;
  }
  if (!Array.isArray(node.content)) return;
  for (const child of node.content) {
    if (!isJsonObject(child)) continue;
    if (isInlineNode(child)) {
      collectText(child, depth + 1, out);
      continue;
    }
    ensureLineBreak(out);
    collectText(child, depth + 1, out);
    ensureLineBreak(out);
  }
}

export function extractNotePlainText(body) {
  const parts = [];
  collectText(body, 0, parts);
  return parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function previewSnippet(text, maxLength = NOTE_SNIPPET_LENGTH) {
  const collapsed = String(text ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

function timestampValue(value) {
  if (typeof value !== "string" || !value.trim()) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

// Same order as the gateway list query (updated_at desc, created_at desc, id asc),
// re-applied on the client because pages loaded with offsets can shift while the
// owner is editing. Notes with unreadable timestamps sink to the bottom.
export function compareNotesNewestFirst(a, b) {
  const byUpdated = timestampValue(b.updated_at) - timestampValue(a.updated_at);
  if (byUpdated !== 0 && !Number.isNaN(byUpdated)) return byUpdated;
  const byCreated = timestampValue(b.created_at) - timestampValue(a.created_at);
  if (byCreated !== 0 && !Number.isNaN(byCreated)) return byCreated;
  return String(a.id).localeCompare(String(b.id));
}

// Describes the record a note is attached to, using only the stored subject type and ID.
// No name, company, or status is invented: a link is offered only when the stored
// subject passes the shared subject-link rules.
export function describeNoteSubject(note) {
  const hasSubjectFields = isJsonObject(note)
    && Object.prototype.hasOwnProperty.call(note, "subject_type")
    && Object.prototype.hasOwnProperty.call(note, "subject_id");
  if (!hasSubjectFields) {
    return Object.freeze({ kind: "unavailable", label: "Linked record unavailable", link: null, actionLabel: null });
  }
  const rawType = note.subject_type;
  const rawId = note.subject_id;
  if (rawType == null && rawId == null) {
    return Object.freeze({ kind: "unlinked", label: "Unlinked note", link: null, actionLabel: null });
  }
  const parsed = parseWorkbenchSubjectLink({ subject_type: rawType, subject_id: rawId });
  if (!parsed || parsed.subject_type == null) {
    return Object.freeze({ kind: "unavailable", label: "Linked record unavailable", link: null, actionLabel: null });
  }
  if (parsed.subject_type === "candidate") {
    return Object.freeze({
      kind: "linked",
      label: "Candidate record",
      link: Object.freeze({ type: "candidate", page: "Candidates", id: parsed.subject_id }),
      actionLabel: "Open candidate",
    });
  }
  if (parsed.subject_type === "job") {
    return Object.freeze({
      kind: "linked",
      label: `Job ${parsed.subject_id}`,
      link: Object.freeze({ type: "job", page: "Jobs", id: parsed.subject_id }),
      actionLabel: "Open job",
    });
  }
  return Object.freeze({
    kind: "linked",
    label: "Meeting record",
    link: Object.freeze({ type: "meeting", page: "Meetings", id: parsed.subject_id }),
    actionLabel: "Open meeting",
  });
}

// Builds the directory rows: newest first, each with its plain text and subject description
// precomputed once so typing in the search box does not re-walk every note body.
export function buildNoteDirectoryEntries(notes) {
  const seen = new Set();
  const entries = [];
  for (const note of Array.isArray(notes) ? notes : []) {
    if (!isJsonObject(note) || typeof note.id !== "string" || seen.has(note.id)) continue;
    seen.add(note.id);
    const title = typeof note.title === "string" ? note.title.trim() : "";
    const plainText = extractNotePlainText(note.body);
    entries.push(Object.freeze({
      id: note.id,
      note,
      title,
      displayTitle: title || "Untitled note",
      plainText,
      snippet: previewSnippet(plainText),
      updatedAt: typeof note.updated_at === "string" ? note.updated_at : null,
      subject: describeNoteSubject(note),
      haystack: `${title}\n${plainText}`.toLowerCase(),
    }));
  }
  return entries.sort((a, b) => compareNotesNewestFirst(a.note, b.note));
}

export function normalizeNoteSearchTokens(query) {
  return String(query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, NOTE_SEARCH_MAX_TOKENS);
}

// Every typed word must appear somewhere in the title or the plain body text (case-insensitive).
export function filterNoteEntries(entries, query) {
  const tokens = normalizeNoteSearchTokens(query);
  if (tokens.length === 0) return entries;
  return entries.filter((entry) => tokens.every((token) => entry.haystack.includes(token)));
}

export function findFocusedNoteIndex(entries, focusNoteId) {
  const wanted = String(focusNoteId ?? "").trim().toLowerCase();
  if (!wanted) return -1;
  return entries.findIndex((entry) => entry.id.toLowerCase() === wanted);
}

export const INITIAL_DIRECTORY_STATE = Object.freeze({
  phase: "loading",
  notes: Object.freeze([]),
  truncated: false,
  error: "",
  query: "",
  selectedId: "",
  focusedId: "",
});

// Pure state for the Notes directory. Focus from a search hit clears the query and selects the note,
// so the exact note is visible even when the previous search would have hidden it.
export function directoryReducer(state, action) {
  switch (action?.type) {
    case "load":
      return { ...state, phase: "loading", error: "" };
    case "loaded":
      return {
        ...state,
        phase: "ready",
        notes: Array.isArray(action.notes) ? action.notes : [],
        truncated: Boolean(action.truncated),
        error: "",
      };
    case "failed":
      return { ...state, phase: "error", error: String(action.message || "Notes could not be loaded.") };
    case "query":
      return { ...state, query: String(action.value ?? "") };
    case "select":
      return { ...state, selectedId: String(action.id ?? ""), focusedId: "" };
    case "focus": {
      const noteId = String(action.noteId ?? "").trim().toLowerCase();
      return { ...state, query: "", selectedId: noteId, focusedId: noteId };
    }
    default:
      return state;
  }
}

// Derives what the page shows from the reducer state. Kept separate so each state is testable without React.
export function resolveDirectoryView(state, entries = buildNoteDirectoryEntries(state.notes)) {
  const visible = filterNoteEntries(entries, state.query);
  const focusMissing = Boolean(state.focusedId)
    && state.phase === "ready"
    && findFocusedNoteIndex(entries, state.focusedId) < 0;
  const wanted = String(state.selectedId || "").toLowerCase();
  const selectedEntry = focusMissing
    ? null
    : visible.find((entry) => entry.id.toLowerCase() === wanted) ?? visible[0] ?? null;
  let emptyKind = "list";
  if (entries.length === 0) emptyKind = "empty";
  else if (visible.length === 0) emptyKind = "no-match";
  return Object.freeze({ entries, visible, focusMissing, selectedEntry, emptyKind });
}

export function formatNoteTimestamp(value) {
  if (typeof value !== "string") return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}
