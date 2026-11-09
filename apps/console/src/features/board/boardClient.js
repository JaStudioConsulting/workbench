import {
  BoardCreateRequestSchema,
  BoardListResponseSchema,
  BoardResponseSchema,
  BoardUpdateRequestSchema,
  parseWorkbenchSubjectLink,
} from "@ja/shared-types";
import { supabase } from "../../supabase-client.js";

export class BoardClientError extends Error {
  constructor(message, status = 0, code = "BOARD_UNAVAILABLE") {
    super(message);
    this.name = "BoardClientError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeBoardSubject(subjectType, subjectId) {
  return parseWorkbenchSubjectLink({ subject_type: subjectType, subject_id: subjectId });
}

async function accessToken(client = supabase) {
  const { data, error } = await client.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new BoardClientError("Sign in to save boards.", 401, "UNAUTHORIZED");
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
    throw new BoardClientError("Board could not reach Workbench.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new BoardClientError(
      payload?.error?.message || "Board could not be saved.",
      response.status,
      payload?.error?.code || "BOARD_UNAVAILABLE",
    );
  }
  return payload;
}

// Client-side schema failures (for example a scene over the size limit) become a
// readable message and never reach the network.
function parseBoardInput(schema, value) {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new BoardClientError(error?.issues?.[0]?.message || "Board input is invalid.", 400, "INVALID_INPUT");
  }
}

export async function listSubjectBoards(subjectType, subjectId, options = {}) {
  const subject = normalizeBoardSubject(subjectType, subjectId);
  if (!subject || subject.subject_type === null) {
    throw new BoardClientError("This record has no verified board link.", 400, "INVALID_SUBJECT");
  }
  const boards = [];
  for (let offset = 0; ; offset += 100) {
    const query = new URLSearchParams({
      subject_type: subject.subject_type,
      subject_id: subject.subject_id,
      limit: "100",
      offset: String(offset),
    });
    const payload = BoardListResponseSchema.parse(await request(`/api/boards?${query}`, options));
    boards.push(...payload.boards);
    if (payload.boards.length < 100) return boards;
  }
}

export async function createSubjectBoard(subjectType, subjectId, title = "", options = {}) {
  const subject = normalizeBoardSubject(subjectType, subjectId);
  if (!subject || subject.subject_type === null) {
    throw new BoardClientError("This record has no verified board link.", 400, "INVALID_SUBJECT");
  }
  const body = parseBoardInput(BoardCreateRequestSchema, {
    title,
    subject_type: subject.subject_type,
    subject_id: subject.subject_id,
    scene: {},
  });
  const payload = await request("/api/boards", { ...options, method: "POST", body });
  return BoardResponseSchema.parse(payload).board;
}

// Autosave sends expected_updated_at so the gateway rejects a write made against an
// older revision (409 AUTOSAVE_CONFLICT) instead of overwriting another save.
export async function saveSubjectBoard(id, patch, options = {}) {
  const body = parseBoardInput(BoardUpdateRequestSchema, patch);
  const payload = await request(`/api/boards/${encodeURIComponent(id)}`, { ...options, method: "PATCH", body });
  return BoardResponseSchema.parse(payload).board;
}
