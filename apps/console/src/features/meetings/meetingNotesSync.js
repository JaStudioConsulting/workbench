import { createSubjectNote } from "../notes/notesClient.js";

export const MEETING_NOTE_TITLE_MAX_LENGTH = 120;
// Notes Tiptap text leaves are capped at 20,000 characters by the shared note schema.
const NOTE_TEXT_CHUNK_LENGTH = 20000;

export function meetingDraftOriginKey(draftId) {
  return `meeting_draft:${draftId}`;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function textParagraphs(value) {
  const paragraphs = [];
  for (const line of String(value).split("\n")) {
    if (line.length === 0) {
      paragraphs.push({ type: "paragraph" });
      continue;
    }
    const chunks = [];
    for (let start = 0; start < line.length; start += NOTE_TEXT_CHUNK_LENGTH) {
      chunks.push({ type: "paragraph", content: [{ type: "text", text: line.slice(start, start + NOTE_TEXT_CHUNK_LENGTH) }] });
    }
    paragraphs.push(...chunks);
  }
  return paragraphs;
}

function section(heading, value) {
  if (!hasText(value)) return [];
  return [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: heading }] },
    ...textParagraphs(value),
  ];
}

// Keep only recruiter-entered call notes in durable Notes. The transcript stays
// canonical in meeting_drafts and is shown through the linked read-only preview.
export function buildMeetingNoteDoc({ notes = "" } = {}) {
  const content = section("Call notes", notes);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function meetingNoteTitle(label) {
  const clean = String(label || "Meeting").replace(/[\r\n\0]/g, " ").trim() || "Meeting";
  return `Call notes - ${clean}`.slice(0, MEETING_NOTE_TITLE_MAX_LENGTH);
}

export const MEETING_NOTES_STALE_WARNING = "Meeting saved. The linked Note kept its existing text; review it if call notes changed.";

export const MEETING_NOTES_FAILED_WARNING = "Meeting draft is saved, but its call notes were not created. Save the meeting again to retry the notes.";

// Syncs call notes only after a durable meeting save. Idempotent: origin_key replays return the existing note.
export async function syncMeetingDraftNotes({
  persistence,
  draftId,
  candidateId,
  label,
  transcript = "",
  notes = "",
  createNote = createSubjectNote,
  options = {},
} = {}) {
  if (persistence !== "durable" || !draftId) return { status: "skipped", warning: "" };
  if (!hasText(transcript) && !hasText(notes)) return { status: "skipped", warning: "" };
  try {
    const body = buildMeetingNoteDoc({ notes });
    const note = await createNote("candidate", candidateId, meetingNoteTitle(label), {
      ...options,
      originKey: meetingDraftOriginKey(draftId),
      body,
    });
    if (JSON.stringify(note.body) !== JSON.stringify(body)) {
      return { status: "stale", note, warning: MEETING_NOTES_STALE_WARNING };
    }
    return { status: "synced", note, warning: "" };
  } catch (error) {
    const reason = error?.message ? ` ${error.message}` : "";
    return { status: "failed", warning: `${MEETING_NOTES_FAILED_WARNING}${reason}`.trim() };
  }
}
