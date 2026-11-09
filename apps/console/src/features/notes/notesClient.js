import {
  NoteCreateRequestSchema,
  NoteListResponseSchema,
  NoteResponseSchema,
  NoteUpdateRequestSchema,
  parseWorkbenchSubjectLink,
} from "@ja/shared-types";
import { supabase } from "../../supabase-client.js";

export class NotesClientError extends Error {
  constructor(message, status = 0, code = "NOTES_UNAVAILABLE") {
    super(message);
    this.name = "NotesClientError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeNoteSubject(subjectType, subjectId) {
  return parseWorkbenchSubjectLink({ subject_type: subjectType, subject_id: subjectId });
}

async function accessToken(client = supabase) {
  const { data, error } = await client.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new NotesClientError("Sign in to save notes.", 401, "UNAUTHORIZED");
  return token;
}

async function request(path, { method = "GET", body, client = supabase, fetchImpl = globalThis.fetch } = {}) {
  const token = await accessToken(client);
  let response;
  try {
    response = await fetchImpl(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      cache: "no-store",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new NotesClientError("Notes could not reach Workbench.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new NotesClientError(
      payload?.error?.message || "Notes could not be saved.",
      response.status,
      payload?.error?.code || "NOTES_UNAVAILABLE",
    );
  }
  return payload;
}

export async function listSubjectNotes(subjectType, subjectId, options = {}) {
  const subject = normalizeNoteSubject(subjectType, subjectId);
  if (!subject || subject.subject_type === null) throw new NotesClientError("This record has no verified notes link.", 400, "INVALID_SUBJECT");
  const notes = [];
  for (let offset = 0; ; offset += 100) {
    const query = new URLSearchParams({
      subject_type: subject.subject_type,
      subject_id: subject.subject_id,
      limit: "100",
      offset: String(offset),
    });
    const payload = NoteListResponseSchema.parse(await request(`/api/notes?${query}`, options));
    notes.push(...payload.notes);
    if (payload.notes.length < 100) return notes;
  }
}

// Gateway list limits: `limit` 1..200 and `offset` 0..10000 (see NoteListQuerySchema).
export const NOTE_DIRECTORY_PAGE_SIZE = 100;
export const NOTE_DIRECTORY_MAX_OFFSET = 10_000;

// Loads every note the signed-in owner can see through GET /api/notes pages.
// Returns truncated: true when the offset ceiling is reached before a short page.
export async function listAllOwnerNotes(options = {}) {
  const pageSize = options.pageSize ?? NOTE_DIRECTORY_PAGE_SIZE;
  const byId = new Map();
  let truncated = false;
  for (let offset = 0; ; offset += pageSize) {
    if (offset > NOTE_DIRECTORY_MAX_OFFSET) {
      truncated = true;
      break;
    }
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    const payload = NoteListResponseSchema.parse(await request(`/api/notes?${query}`, options));
    for (const note of payload.notes) {
      if (!byId.has(note.id)) byId.set(note.id, note);
    }
    if (payload.notes.length < pageSize) break;
  }
  return { notes: [...byId.values()], truncated };
}

export async function createSubjectNote(subjectType, subjectId, title = "", options = {}) {
  const { originKey = null, body: noteBody = null, ...requestOptions } = options;
  const subject = normalizeNoteSubject(subjectType, subjectId);
  if (!subject || subject.subject_type === null) throw new NotesClientError("This record has no verified notes link.", 400, "INVALID_SUBJECT");
  const body = NoteCreateRequestSchema.parse({
    title,
    subject_type: subject.subject_type,
    subject_id: subject.subject_id,
    body: noteBody || { type: "doc", content: [{ type: "paragraph" }] },
    origin_key: originKey,
  });
  const payload = await request("/api/notes", { ...requestOptions, method: "POST", body });
  return NoteResponseSchema.parse(payload).note;
}

export async function saveSubjectNote(id, patch, options = {}) {
  const body = NoteUpdateRequestSchema.parse(patch);
  const payload = await request(`/api/notes/${encodeURIComponent(id)}`, { ...options, method: "PATCH", body });
  return NoteResponseSchema.parse(payload).note;
}
