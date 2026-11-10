import {
  BoardCreateRequestSchema,
  BoardDeleteResponseSchema,
  BoardIdSchema,
  BoardListQuerySchema,
  BoardListResponseSchema,
  BoardRecordSchema,
  BoardResponseSchema,
  BoardUpdateRequestSchema,
  NoteCreateRequestSchema,
  NoteDeleteResponseSchema,
  NoteIdSchema,
  NoteListQuerySchema,
  NoteListResponseSchema,
  NoteRecordSchema,
  NoteResponseSchema,
  NoteUpdateRequestSchema,
  SupabaseUserIdSchema,
  errorEnvelope,
  parseWorkbenchSubjectLink,
} from "@ja/shared-types";
import { parseAllowedGoogleEmails } from "./auth.js";
import { extractBearerToken, isPrivilegedSupabaseKey } from "./candidate-routes.js";

const DEFAULT_SUPABASE_URL = "https://abnfffkmxqixrwzackjf.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0";

const FORBIDDEN_WRITE_KEYS = new Set([
  "id",
  "owner_id",
  "ownerId",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
]);

function noStore(res) {
  res.set("Cache-Control", "private, no-store");
  return res;
}

function respondError(res, code, message, status) {
  return noStore(res).status(status).json(errorEnvelope(code, message));
}

function normalizeSupabaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !isLocalHttp) || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveNotesBoardsSupabaseConfig(env = process.env) {
  const hasExplicitServiceKey = Object.entries(env || {}).some(
    ([key, val]) => /^SUPABASE_(?:SERVICE|SECRET)/i.test(key) && typeof val === "string" && val.trim().length > 0,
  );
  if (hasExplicitServiceKey) {
    return {
      enabled: false,
      reason: "Notes and boards routes forbid Supabase service or secret keys and require end-user RLS",
    };
  }

  const rawUrl = Object.hasOwn(env, "SUPABASE_URL")
    ? env.SUPABASE_URL
    : Object.hasOwn(env, "VITE_SUPABASE_URL")
      ? env.VITE_SUPABASE_URL
      : DEFAULT_SUPABASE_URL;
  const rawKey = Object.hasOwn(env, "SUPABASE_PUBLISHABLE_KEY")
    ? env.SUPABASE_PUBLISHABLE_KEY
    : Object.hasOwn(env, "SUPABASE_ANON_KEY")
      ? env.SUPABASE_ANON_KEY
      : Object.hasOwn(env, "VITE_SUPABASE_PUBLISHABLE_KEY")
        ? env.VITE_SUPABASE_PUBLISHABLE_KEY
        : DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  const supabaseUrl = normalizeSupabaseUrl(rawUrl);
  const publishableKey = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!supabaseUrl || !publishableKey) {
    return { enabled: false, reason: "Supabase URL and publishable key are required" };
  }
  if (isPrivilegedSupabaseKey(publishableKey)) {
    return {
      enabled: false,
      reason: "Notes and boards routes require a publishable Supabase key, not a privileged key",
    };
  }
  return {
    enabled: true,
    supabaseUrl,
    publishableKey,
  };
}

function normalizeTimestamp(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return trimmed;
    return trimmed;
  }
  return null;
}

function sanitizeSearchTerm(value) {
  return String(value || "")
    .replace(/[(),*%\\]/g, " ")
    .trim();
}

function checkForbiddenWriteKeys(rawBody) {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw Object.assign(new Error("Request body must be a JSON object"), {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  for (const key of Object.keys(rawBody)) {
    if (FORBIDDEN_WRITE_KEYS.has(key)) {
      throw Object.assign(
        new Error(`${key} cannot be set by the client`),
        { status: 400, code: "INVALID_INPUT" },
      );
    }
  }
}

export function normalizeNoteRow(row) {
  if (!row || typeof row !== "object") {
    throw Object.assign(new Error("Note record is missing"), {
      status: 502,
      code: "NOTE_STORAGE_FAILED",
    });
  }
  const parsedLink = parseWorkbenchSubjectLink({
    subject_type: row.subject_type ?? null,
    subject_id: row.subject_id ?? null,
  });
  const normalized = {
    id: typeof row.id === "string" ? row.id.toLowerCase() : "",
    owner_id: typeof row.owner_id === "string" ? row.owner_id.toLowerCase() : "",
    title: typeof row.title === "string" ? row.title : "",
    subject_type: parsedLink ? parsedLink.subject_type : (row.subject_type ?? null),
    subject_id: parsedLink ? parsedLink.subject_id : (row.subject_id ?? null),
    body: row.body,
    origin_key: row.origin_key ?? null,
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
  return NoteRecordSchema.parse(normalized);
}

export function normalizeBoardRow(row) {
  if (!row || typeof row !== "object") {
    throw Object.assign(new Error("Board record is missing"), {
      status: 502,
      code: "BOARD_STORAGE_FAILED",
    });
  }
  const parsedLink = parseWorkbenchSubjectLink({
    subject_type: row.subject_type ?? null,
    subject_id: row.subject_id ?? null,
  });
  const normalized = {
    id: typeof row.id === "string" ? row.id.toLowerCase() : "",
    owner_id: typeof row.owner_id === "string" ? row.owner_id.toLowerCase() : "",
    title: typeof row.title === "string" ? row.title : "",
    subject_type: parsedLink ? parsedLink.subject_type : (row.subject_type ?? null),
    subject_id: parsedLink ? parsedLink.subject_id : (row.subject_id ?? null),
    scene: row.scene,
    created_at: normalizeTimestamp(row.created_at),
    updated_at: normalizeTimestamp(row.updated_at),
  };
  return BoardRecordSchema.parse(normalized);
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapPostgrestError(response, payload, fallbackMessage, storageCode = "WORKBENCH_STORAGE_FAILED") {
  const pgCode = payload?.code;
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (response.status === 401) {
    return Object.assign(new Error("Supabase rejected the bearer token"), {
      status: 401,
      code: "UNAUTHORIZED",
    });
  }
  if (
    response.status === 403
    || pgCode === "42501"
    || /row-level security|permission denied|insufficient_privilege/i.test(message)
  ) {
    return Object.assign(new Error("Access denied by Supabase row-level security"), {
      status: 403,
      code: "FORBIDDEN",
    });
  }
  if (response.status === 400 || response.status === 422 || pgCode === "23514" || pgCode === "22P02") {
    return Object.assign(new Error(fallbackMessage), {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  return Object.assign(new Error(fallbackMessage), {
    status: 502,
    code: storageCode,
  });
}

export function createSupabaseNotesBoardsStore({
  supabaseUrl,
  publishableKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!supabaseUrl || !publishableKey) {
    throw new TypeError("supabaseUrl and publishableKey are required");
  }
  if (isPrivilegedSupabaseKey(publishableKey)) {
    throw new Error("Privileged Supabase keys are forbidden in notes and boards store");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch implementation is required");
  }

  function rlsHeaders(accessToken, extra = {}) {
    if (!accessToken || isPrivilegedSupabaseKey(accessToken)) {
      throw Object.assign(new Error("Service role tokens are not allowed"), {
        status: 403,
        code: "FORBIDDEN",
      });
    }
    return {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...extra,
    };
  }

  async function verifySubject({ accessToken, ownerId, subject_type, subject_id }) {
    if (subject_type == null && subject_id == null) {
      return { subject_type: null, subject_id: null };
    }
    const parsedLink = parseWorkbenchSubjectLink({ subject_type, subject_id });
    if (!parsedLink) {
      throw Object.assign(new Error("Invalid subject_type or subject_id"), {
        status: 400,
        code: "INVALID_INPUT",
      });
    }
    const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();

    if (parsedLink.subject_type === "candidate") {
      const params = new URLSearchParams({
        select: "id",
        id: `eq.${parsedLink.subject_id}`,
        limit: "1",
      });
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/candidates_all?${params.toString()}`, {
        method: "GET",
        headers: rlsHeaders(accessToken),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        throw mapPostgrestError(response, payload, "Referenced candidate could not be verified");
      }
      const row = Array.isArray(payload) ? payload[0] : null;
      if (!row || String(row.id) !== parsedLink.subject_id) {
        throw Object.assign(new Error("Referenced candidate was not found"), {
          status: 404,
          code: "SUBJECT_NOT_FOUND",
        });
      }
      return parsedLink;
    }

    if (parsedLink.subject_type === "job") {
      const params = new URLSearchParams({
        select: "job_id",
        job_id: `eq.${parsedLink.subject_id}`,
        limit: "1",
      });
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/tracker_jobs?${params.toString()}`, {
        method: "GET",
        headers: rlsHeaders(accessToken),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        throw mapPostgrestError(response, payload, "Referenced job could not be verified");
      }
      const row = Array.isArray(payload) ? payload[0] : null;
      if (!row || String(row.job_id) !== parsedLink.subject_id) {
        throw Object.assign(new Error("Referenced job was not found"), {
          status: 404,
          code: "SUBJECT_NOT_FOUND",
        });
      }
      return parsedLink;
    }

    if (parsedLink.subject_type === "meeting") {
      const params = new URLSearchParams({
        select: "id,owner_id",
        id: `eq.${parsedLink.subject_id}`,
        owner_id: `eq.${checkedOwnerId}`,
        limit: "1",
      });
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/meeting_drafts?${params.toString()}`, {
        method: "GET",
        headers: rlsHeaders(accessToken),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        throw mapPostgrestError(response, payload, "Referenced meeting draft could not be verified");
      }
      const row = Array.isArray(payload) ? payload[0] : null;
      if (!row || String(row.id).toLowerCase() !== parsedLink.subject_id) {
        throw Object.assign(new Error("Referenced meeting draft was not found"), {
          status: 404,
          code: "SUBJECT_NOT_FOUND",
        });
      }
      if (row.owner_id && String(row.owner_id).toLowerCase() !== checkedOwnerId) {
        throw Object.assign(new Error("Referenced meeting draft owner mismatch"), {
          status: 403,
          code: "FORBIDDEN",
        });
      }
      return parsedLink;
    }

    throw Object.assign(new Error("Unsupported subject_type"), {
      status: 400,
      code: "INVALID_INPUT",
    });
  }

  async function selectSingleRowById({
    accessToken,
    ownerId,
    table,
    id,
    normalizeRow,
    storageCode,
  }) {
    const params = new URLSearchParams({
      select: "*",
      id: `eq.${id}`,
      owner_id: `eq.${ownerId}`,
      limit: "1",
    });
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/${table}?${params.toString()}`, {
      method: "GET",
      headers: rlsHeaders(accessToken),
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw mapPostgrestError(response, payload, `${table.slice(0, -1)} could not be loaded`, storageCode);
    }
    const row = Array.isArray(payload) ? payload[0] : null;
    if (!row) return null;
    if (row.owner_id && String(row.owner_id).toLowerCase() !== ownerId) {
      throw Object.assign(new Error("Record owner mismatch"), {
        status: 403,
        code: "FORBIDDEN",
      });
    }
    return normalizeRow(row);
  }

  async function findNoteByOriginKey({ accessToken, ownerId, originKey }) {
    const params = new URLSearchParams({
      select: "*",
      owner_id: `eq.${ownerId}`,
      origin_key: `eq.${originKey}`,
      limit: "1",
    });
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/notes?${params.toString()}`, {
      method: "GET",
      headers: rlsHeaders(accessToken),
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw mapPostgrestError(response, payload, "Note could not be loaded", "NOTE_STORAGE_FAILED");
    }
    const row = Array.isArray(payload) ? payload[0] : null;
    if (!row) return null;
    if (row.owner_id && String(row.owner_id).toLowerCase() !== ownerId) {
      throw Object.assign(new Error("Record owner mismatch"), { status: 403, code: "FORBIDDEN" });
    }
    return normalizeNoteRow(row);
  }

  function existingOriginNote(note, verifiedSubject) {
    if (note.subject_type !== verifiedSubject.subject_type || note.subject_id !== verifiedSubject.subject_id) {
      throw Object.assign(new Error("This origin key is already linked to a different record"), {
        status: 409,
        code: "NOTE_ORIGIN_CONFLICT",
      });
    }
    return { note, created: false };
  }

  function buildListParams(checkedOwnerId, query) {
    const params = new URLSearchParams({
      select: "*",
      owner_id: `eq.${checkedOwnerId}`,
      order: "updated_at.desc,created_at.desc,id.asc",
      limit: String(query.limit),
      offset: String(query.offset),
    });
    if (query.unlinked === true) {
      params.set("subject_type", "is.null");
      params.set("subject_id", "is.null");
    } else if (query.unlinked === false) {
      params.set("subject_type", "not.is.null");
    }
    if (query.after_updated_at) {
      const updated = query.after_updated_at;
      const created = query.after_created_at;
      const id = query.after_id;
      params.set("or", `(updated_at.lt.${updated},and(updated_at.eq.${updated},created_at.lt.${created}),and(updated_at.eq.${updated},created_at.eq.${created},id.gt.${id}))`);
    }
    if (query.subject_type) {
      params.set("subject_type", `eq.${query.subject_type}`);
    }
    if (query.subject_id) {
      params.set("subject_id", `eq.${query.subject_id}`);
    }
    if (query.q) {
      const term = sanitizeSearchTerm(query.q);
      if (term) {
        params.set("title", `ilike.*${term}*`);
      }
    }
    return params;
  }

  return Object.freeze({
    async verifyUser(accessToken) {
      const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
        method: "GET",
        headers: rlsHeaders(accessToken),
      });
      const payload = await parseJsonSafe(response);
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Supabase session is invalid or expired"), {
          status: 401,
          code: "UNAUTHORIZED",
        });
      }
      if (!response.ok || !payload || typeof payload !== "object") {
        throw Object.assign(new Error("Supabase authentication check failed"), {
          status: 502,
          code: "WORKBENCH_STORAGE_FAILED",
        });
      }
      if (payload.role === "service_role" || payload.role === "supabase_admin") {
        throw Object.assign(new Error("Service role credentials are not allowed"), {
          status: 403,
          code: "FORBIDDEN",
        });
      }
      const parsedId = SupabaseUserIdSchema.safeParse(payload.id);
      if (!parsedId.success) {
        throw Object.assign(
          new Error("Authenticated user ID must be a Supabase Auth UUID"),
          { status: 401, code: "UNAUTHORIZED" },
        );
      }
      return Object.freeze({
        id: parsedId.data.toLowerCase(),
        email: typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null,
      });
    },

    verifySubject,

    async listNotes({ accessToken, ownerId, query }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const validatedQuery = NoteListQuerySchema.parse(query || {});
      const params = buildListParams(checkedOwnerId, validatedQuery);

      const response = await fetchImpl(`${supabaseUrl}/rest/v1/notes?${params.toString()}`, {
        method: "GET",
        headers: rlsHeaders(accessToken),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok || !Array.isArray(payload)) {
        throw mapPostgrestError(response, payload, "Notes could not be loaded", "NOTE_STORAGE_FAILED");
      }
      const notes = payload.map((row) => {
        if (row?.owner_id && String(row.owner_id).toLowerCase() !== checkedOwnerId) {
          throw Object.assign(new Error("Note owner mismatch"), { status: 403, code: "FORBIDDEN" });
        }
        return normalizeNoteRow(row);
      });
      return NoteListResponseSchema.parse({ notes });
    },

    async getNote({ accessToken, ownerId, id }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const checkedId = NoteIdSchema.parse(id);
      const note = await selectSingleRowById({
        accessToken,
        ownerId: checkedOwnerId,
        table: "notes",
        id: checkedId,
        normalizeRow: normalizeNoteRow,
        storageCode: "NOTE_STORAGE_FAILED",
      });
      if (!note) {
        throw Object.assign(new Error("Note was not found"), {
          status: 404,
          code: "NOTE_NOT_FOUND",
        });
      }
      return NoteResponseSchema.parse({ note });
    },

    async createNote({ accessToken, ownerId, input }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const parsedInput = NoteCreateRequestSchema.parse(input);
      const verifiedSubject = await verifySubject({
        accessToken,
        ownerId: checkedOwnerId,
        subject_type: parsedInput.subject_type,
        subject_id: parsedInput.subject_id,
      });

      // A meeting origin must resolve under this owner and point to the exact
      // candidate source key. The key alone is never proof of a relationship.
      if (parsedInput.origin_key?.startsWith("meeting_draft:")) {
        const rawMeetingId = parsedInput.origin_key.slice("meeting_draft:".length);
        const parsedMeetingId = SupabaseUserIdSchema.safeParse(rawMeetingId);
        if (!parsedMeetingId.success || verifiedSubject.subject_type !== "candidate") {
          throw Object.assign(new Error("Meeting origin requires a candidate and valid meeting ID"), {
            status: 400,
            code: "INVALID_INPUT",
          });
        }
        const meeting = await selectSingleRowById({
          accessToken,
          ownerId: checkedOwnerId,
          table: "meeting_drafts",
          id: parsedMeetingId.data.toLowerCase(),
          normalizeRow: (row) => row,
          storageCode: "NOTE_STORAGE_FAILED",
        });
        const meetingCandidateId = meeting
          ? `${meeting.candidate_source}:${meeting.candidate_source_id}`
          : null;
        if (!meeting || meetingCandidateId !== verifiedSubject.subject_id) {
          throw Object.assign(new Error("Meeting origin does not match this candidate"), {
            status: 409,
            code: "NOTE_ORIGIN_CONFLICT",
          });
        }
      }

      // An origin key makes creation idempotent: a repeat returns the note that
      // already exists for that key and never inserts a duplicate or replaces text.
      if (parsedInput.origin_key) {
        const existing = await findNoteByOriginKey({
          accessToken,
          ownerId: checkedOwnerId,
          originKey: parsedInput.origin_key,
        });
        if (existing) return existingOriginNote(existing, verifiedSubject);
      }

      const rowToInsert = {
        owner_id: checkedOwnerId,
        title: parsedInput.title,
        subject_type: verifiedSubject.subject_type,
        subject_id: verifiedSubject.subject_id,
        body: parsedInput.body,
        ...(parsedInput.origin_key ? { origin_key: parsedInput.origin_key } : {}),
      };

      const response = await fetchImpl(`${supabaseUrl}/rest/v1/notes?select=*`, {
        method: "POST",
        headers: rlsHeaders(accessToken, {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        }),
        body: JSON.stringify(rowToInsert),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        // Two concurrent creates with one origin key: the unique index rejects the
        // second insert, so return the row the first one wrote.
        if (parsedInput.origin_key && payload?.code === "23505") {
          const raced = await findNoteByOriginKey({
            accessToken,
            ownerId: checkedOwnerId,
            originKey: parsedInput.origin_key,
          });
          if (raced) return existingOriginNote(raced, verifiedSubject);
        }
        throw mapPostgrestError(response, payload, "Note could not be created", "NOTE_STORAGE_FAILED");
      }
      const inserted = Array.isArray(payload) ? payload[0] : payload;
      if (!inserted?.id) {
        throw Object.assign(new Error("Note insert returned no record"), {
          status: 502,
          code: "NOTE_STORAGE_FAILED",
        });
      }
      if (inserted.owner_id && String(inserted.owner_id).toLowerCase() !== checkedOwnerId) {
        throw Object.assign(new Error("Note owner mismatch"), {
          status: 403,
          code: "FORBIDDEN",
        });
      }
      return { note: NoteResponseSchema.parse({ note: normalizeNoteRow(inserted) }).note, created: true };
    },

    async updateNote({ accessToken, ownerId, id, input }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const checkedId = NoteIdSchema.parse(id);
      const parsedInput = NoteUpdateRequestSchema.parse(input);

      const existing = await selectSingleRowById({
        accessToken,
        ownerId: checkedOwnerId,
        table: "notes",
        id: checkedId,
        normalizeRow: normalizeNoteRow,
        storageCode: "NOTE_STORAGE_FAILED",
      });
      if (!existing) {
        throw Object.assign(new Error("Note was not found"), {
          status: 404,
          code: "NOTE_NOT_FOUND",
        });
      }

      if (parsedInput.expected_updated_at !== undefined) {
        const expectedTime = new Date(parsedInput.expected_updated_at).getTime();
        const actualTime = new Date(existing.updated_at).getTime();
        if (expectedTime !== actualTime) {
          throw Object.assign(
            new Error("Note was modified by a newer save"),
            { status: 409, code: "AUTOSAVE_CONFLICT" },
          );
        }
      }

      const patchPayload = {};
      if (parsedInput.title !== undefined) {
        patchPayload.title = parsedInput.title;
      }
      if (parsedInput.body !== undefined) {
        patchPayload.body = parsedInput.body;
      }
      if (parsedInput.subject_type !== undefined || parsedInput.subject_id !== undefined) {
        const verifiedSubject = await verifySubject({
          accessToken,
          ownerId: checkedOwnerId,
          subject_type: parsedInput.subject_type,
          subject_id: parsedInput.subject_id,
        });
        patchPayload.subject_type = verifiedSubject.subject_type;
        patchPayload.subject_id = verifiedSubject.subject_id;
      }

      const params = new URLSearchParams({
        id: `eq.${checkedId}`,
        owner_id: `eq.${checkedOwnerId}`,
        updated_at: `eq.${existing.updated_at}`,
        select: "*",
      });
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/notes?${params.toString()}`, {
        method: "PATCH",
        headers: rlsHeaders(accessToken, {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        }),
        body: JSON.stringify(patchPayload),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        throw mapPostgrestError(response, payload, "Note could not be updated", "NOTE_STORAGE_FAILED");
      }
      const updated = Array.isArray(payload) ? payload[0] : payload;
      if (!updated?.id) {
        throw Object.assign(new Error("Note changed during autosave"), {
          status: 409,
          code: "AUTOSAVE_CONFLICT",
        });
      }
      if (updated.owner_id && String(updated.owner_id).toLowerCase() !== checkedOwnerId) {
        throw Object.assign(new Error("Note owner mismatch"), {
          status: 403,
          code: "FORBIDDEN",
        });
      }
      return NoteResponseSchema.parse({ note: normalizeNoteRow(updated) });
    },

    async deleteNote({ accessToken, ownerId, id }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const checkedId = NoteIdSchema.parse(id);
      const params = new URLSearchParams({
        id: `eq.${checkedId}`,
        owner_id: `eq.${checkedOwnerId}`,
        select: "*",
      });
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/notes?${params.toString()}`, {
        method: "DELETE",
        headers: rlsHeaders(accessToken, {
          Prefer: "return=representation",
        }),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        throw mapPostgrestError(response, payload, "Note could not be deleted", "NOTE_STORAGE_FAILED");
      }
      const deleted = Array.isArray(payload) ? payload[0] : payload;
      if (!deleted?.id) {
        throw Object.assign(new Error("Note was not found"), {
          status: 404,
          code: "NOTE_NOT_FOUND",
        });
      }
      if (deleted.owner_id && String(deleted.owner_id).toLowerCase() !== checkedOwnerId) {
        throw Object.assign(new Error("Note owner mismatch"), {
          status: 403,
          code: "FORBIDDEN",
        });
      }
      return NoteDeleteResponseSchema.parse({
        deleted: true,
        id: String(deleted.id).toLowerCase(),
      });
    },

    async listBoards({ accessToken, ownerId, query }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const validatedQuery = BoardListQuerySchema.parse(query || {});
      const params = buildListParams(checkedOwnerId, validatedQuery);

      const response = await fetchImpl(`${supabaseUrl}/rest/v1/boards?${params.toString()}`, {
        method: "GET",
        headers: rlsHeaders(accessToken),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok || !Array.isArray(payload)) {
        throw mapPostgrestError(response, payload, "Boards could not be loaded", "BOARD_STORAGE_FAILED");
      }
      const boards = payload.map((row) => {
        if (row?.owner_id && String(row.owner_id).toLowerCase() !== checkedOwnerId) {
          throw Object.assign(new Error("Board owner mismatch"), { status: 403, code: "FORBIDDEN" });
        }
        return normalizeBoardRow(row);
      });
      return BoardListResponseSchema.parse({ boards });
    },

    async getBoard({ accessToken, ownerId, id }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const checkedId = BoardIdSchema.parse(id);
      const board = await selectSingleRowById({
        accessToken,
        ownerId: checkedOwnerId,
        table: "boards",
        id: checkedId,
        normalizeRow: normalizeBoardRow,
        storageCode: "BOARD_STORAGE_FAILED",
      });
      if (!board) {
        throw Object.assign(new Error("Board was not found"), {
          status: 404,
          code: "BOARD_NOT_FOUND",
        });
      }
      return BoardResponseSchema.parse({ board });
    },

    async createBoard({ accessToken, ownerId, input }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const parsedInput = BoardCreateRequestSchema.parse(input);
      const verifiedSubject = await verifySubject({
        accessToken,
        ownerId: checkedOwnerId,
        subject_type: parsedInput.subject_type,
        subject_id: parsedInput.subject_id,
      });

      const rowToInsert = {
        owner_id: checkedOwnerId,
        title: parsedInput.title,
        subject_type: verifiedSubject.subject_type,
        subject_id: verifiedSubject.subject_id,
        scene: parsedInput.scene,
      };

      const response = await fetchImpl(`${supabaseUrl}/rest/v1/boards?select=*`, {
        method: "POST",
        headers: rlsHeaders(accessToken, {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        }),
        body: JSON.stringify(rowToInsert),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        throw mapPostgrestError(response, payload, "Board could not be created", "BOARD_STORAGE_FAILED");
      }
      const inserted = Array.isArray(payload) ? payload[0] : payload;
      if (!inserted?.id) {
        throw Object.assign(new Error("Board insert returned no record"), {
          status: 502,
          code: "BOARD_STORAGE_FAILED",
        });
      }
      if (inserted.owner_id && String(inserted.owner_id).toLowerCase() !== checkedOwnerId) {
        throw Object.assign(new Error("Board owner mismatch"), {
          status: 403,
          code: "FORBIDDEN",
        });
      }
      return BoardResponseSchema.parse({ board: normalizeBoardRow(inserted) });
    },

    async updateBoard({ accessToken, ownerId, id, input }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const checkedId = BoardIdSchema.parse(id);
      const parsedInput = BoardUpdateRequestSchema.parse(input);

      const existing = await selectSingleRowById({
        accessToken,
        ownerId: checkedOwnerId,
        table: "boards",
        id: checkedId,
        normalizeRow: normalizeBoardRow,
        storageCode: "BOARD_STORAGE_FAILED",
      });
      if (!existing) {
        throw Object.assign(new Error("Board was not found"), {
          status: 404,
          code: "BOARD_NOT_FOUND",
        });
      }

      if (parsedInput.expected_updated_at !== undefined) {
        const expectedTime = new Date(parsedInput.expected_updated_at).getTime();
        const actualTime = new Date(existing.updated_at).getTime();
        if (expectedTime !== actualTime) {
          throw Object.assign(
            new Error("Board was modified by a newer save"),
            { status: 409, code: "AUTOSAVE_CONFLICT" },
          );
        }
      }

      const patchPayload = {};
      if (parsedInput.title !== undefined) {
        patchPayload.title = parsedInput.title;
      }
      if (parsedInput.scene !== undefined) {
        patchPayload.scene = parsedInput.scene;
      }
      if (parsedInput.subject_type !== undefined || parsedInput.subject_id !== undefined) {
        const verifiedSubject = await verifySubject({
          accessToken,
          ownerId: checkedOwnerId,
          subject_type: parsedInput.subject_type,
          subject_id: parsedInput.subject_id,
        });
        patchPayload.subject_type = verifiedSubject.subject_type;
        patchPayload.subject_id = verifiedSubject.subject_id;
      }

      const params = new URLSearchParams({
        id: `eq.${checkedId}`,
        owner_id: `eq.${checkedOwnerId}`,
        updated_at: `eq.${existing.updated_at}`,
        select: "*",
      });
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/boards?${params.toString()}`, {
        method: "PATCH",
        headers: rlsHeaders(accessToken, {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        }),
        body: JSON.stringify(patchPayload),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        throw mapPostgrestError(response, payload, "Board could not be updated", "BOARD_STORAGE_FAILED");
      }
      const updated = Array.isArray(payload) ? payload[0] : payload;
      if (!updated?.id) {
        throw Object.assign(new Error("Board changed during autosave"), {
          status: 409,
          code: "AUTOSAVE_CONFLICT",
        });
      }
      if (updated.owner_id && String(updated.owner_id).toLowerCase() !== checkedOwnerId) {
        throw Object.assign(new Error("Board owner mismatch"), {
          status: 403,
          code: "FORBIDDEN",
        });
      }
      return BoardResponseSchema.parse({ board: normalizeBoardRow(updated) });
    },

    async deleteBoard({ accessToken, ownerId, id }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const checkedId = BoardIdSchema.parse(id);
      const params = new URLSearchParams({
        id: `eq.${checkedId}`,
        owner_id: `eq.${checkedOwnerId}`,
        select: "*",
      });
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/boards?${params.toString()}`, {
        method: "DELETE",
        headers: rlsHeaders(accessToken, {
          Prefer: "return=representation",
        }),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        throw mapPostgrestError(response, payload, "Board could not be deleted", "BOARD_STORAGE_FAILED");
      }
      const deleted = Array.isArray(payload) ? payload[0] : payload;
      if (!deleted?.id) {
        throw Object.assign(new Error("Board was not found"), {
          status: 404,
          code: "BOARD_NOT_FOUND",
        });
      }
      if (deleted.owner_id && String(deleted.owner_id).toLowerCase() !== checkedOwnerId) {
        throw Object.assign(new Error("Board owner mismatch"), {
          status: 403,
          code: "FORBIDDEN",
        });
      }
      return BoardDeleteResponseSchema.parse({
        deleted: true,
        id: String(deleted.id).toLowerCase(),
      });
    },
  });
}

export function registerNotesBoardsRoutes(app, {
  env = process.env,
  authConfig,
  notesBoardsStore,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") {
    throw new TypeError("An Express app is required");
  }

  const supabaseConfig = resolveNotesBoardsSupabaseConfig(env);
  const allowedEmails = parseAllowedGoogleEmails(env.AUTH_ALLOWED_GOOGLE_EMAILS);
  const isApprovedEmail = typeof authConfig?.isApprovedEmail === "function"
    ? authConfig.isApprovedEmail.bind(authConfig)
    : allowedEmails
      ? (email) => typeof email === "string" && allowedEmails.includes(email.trim().toLowerCase())
      : null;

  const store = notesBoardsStore ?? (supabaseConfig.enabled
    ? createSupabaseNotesBoardsStore({
      supabaseUrl: supabaseConfig.supabaseUrl,
      publishableKey: supabaseConfig.publishableKey,
      fetchImpl,
    })
    : null);

  async function requireSupabaseWorkbenchAuth(req, res, next) {
    if (!store) {
      return respondError(
        res,
        "SUPABASE_UNAVAILABLE",
        supabaseConfig.reason || "Supabase notes and boards storage is unavailable",
        503,
      );
    }
    const accessToken = extractBearerToken(req.get("authorization"));
    if (!accessToken) {
      return respondError(res, "UNAUTHORIZED", "A valid Supabase bearer token is required", 401);
    }
    if (isPrivilegedSupabaseKey(accessToken)) {
      return respondError(res, "FORBIDDEN", "Service role credentials are not allowed", 403);
    }
    try {
      const user = await store.verifyUser(accessToken);
      const parsedUuid = SupabaseUserIdSchema.safeParse(user?.id);
      if (!parsedUuid.success) {
        return respondError(res, "UNAUTHORIZED", "Supabase user ID must be a valid UUID", 401);
      }
      if (isApprovedEmail && (!user?.email || !isApprovedEmail(user.email))) {
        return respondError(res, "FORBIDDEN", "This account is not authorized for Workbench notes and boards", 403);
      }
      req.supabaseWorkbenchAuth = Object.freeze({
        accessToken,
        ownerId: parsedUuid.data.toLowerCase(),
        email: user.email || null,
      });
      return next();
    } catch (error) {
      const status = error?.status || 401;
      const code = error?.code || (status === 403 ? "FORBIDDEN" : status === 401 ? "UNAUTHORIZED" : "WORKBENCH_STORAGE_FAILED");
      const message = error instanceof Error ? error.message : "Supabase authentication failed";
      return respondError(res, code, message, status);
    }
  }

  function handleRouteError(res, error, fallbackMessage, notFoundCode, storageCode) {
    if (error?.name === "ZodError") {
      return respondError(res, "INVALID_INPUT", error.issues?.[0]?.message || fallbackMessage, 400);
    }
    const status = error?.status || 502;
    const code = error?.code
      || (status === 400
        ? "INVALID_INPUT"
        : status === 404
          ? notFoundCode
          : status === 409
            ? "AUTOSAVE_CONFLICT"
            : storageCode);
    const message = error instanceof Error ? error.message : fallbackMessage;
    return respondError(res, code, message, status);
  }

  // --- Notes CRUD + Autosave Routes ---

  app.get("/api/notes", requireSupabaseWorkbenchAuth, async (req, res) => {
    const parsedQuery = NoteListQuerySchema.safeParse(req.query || {});
    if (!parsedQuery.success) {
      return respondError(
        res,
        "INVALID_INPUT",
        parsedQuery.error.issues?.[0]?.message || "Invalid notes query",
        400,
      );
    }
    try {
      const result = await store.listNotes({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        query: parsedQuery.data,
      });
      return noStore(res).json(NoteListResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Notes could not be loaded", "NOTE_NOT_FOUND", "NOTE_STORAGE_FAILED");
    }
  });

  app.get("/api/notes/:id", requireSupabaseWorkbenchAuth, async (req, res) => {
    const parsedId = NoteIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      return respondError(
        res,
        "INVALID_NOTE_ID",
        parsedId.error.issues?.[0]?.message || "Note ID must be a valid UUID",
        400,
      );
    }
    try {
      const result = await store.getNote({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        id: parsedId.data,
      });
      return noStore(res).json(NoteResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Note could not be loaded", "NOTE_NOT_FOUND", "NOTE_STORAGE_FAILED");
    }
  });

  app.post("/api/notes", requireSupabaseWorkbenchAuth, async (req, res) => {
    try {
      checkForbiddenWriteKeys(req.body);
      const parsedBody = NoteCreateRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return respondError(
          res,
          "INVALID_INPUT",
          parsedBody.error.issues?.[0]?.message || "Invalid note input",
          400,
        );
      }
      const result = await store.createNote({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        input: parsedBody.data,
      });
      // 201 for a new note; 200 when an origin_key replays an existing note.
      return noStore(res).status(result.created ? 201 : 200).json(NoteResponseSchema.parse({ note: result.note }));
    } catch (error) {
      return handleRouteError(res, error, "Note could not be created", "SUBJECT_NOT_FOUND", "NOTE_STORAGE_FAILED");
    }
  });

  async function handleUpdateNote(req, res) {
    const parsedId = NoteIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      return respondError(
        res,
        "INVALID_NOTE_ID",
        parsedId.error.issues?.[0]?.message || "Note ID must be a valid UUID",
        400,
      );
    }
    try {
      checkForbiddenWriteKeys(req.body);
      const parsedBody = NoteUpdateRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return respondError(
          res,
          "INVALID_INPUT",
          parsedBody.error.issues?.[0]?.message || "Invalid note update input",
          400,
        );
      }
      const result = await store.updateNote({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        id: parsedId.data,
        input: parsedBody.data,
      });
      return noStore(res).json(NoteResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Note could not be updated", "NOTE_NOT_FOUND", "NOTE_STORAGE_FAILED");
    }
  }

  app.patch("/api/notes/:id", requireSupabaseWorkbenchAuth, handleUpdateNote);
  app.put("/api/notes/:id", requireSupabaseWorkbenchAuth, handleUpdateNote);
  app.post("/api/notes/:id", requireSupabaseWorkbenchAuth, handleUpdateNote);

  app.delete("/api/notes/:id", requireSupabaseWorkbenchAuth, async (req, res) => {
    const parsedId = NoteIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      return respondError(
        res,
        "INVALID_NOTE_ID",
        parsedId.error.issues?.[0]?.message || "Note ID must be a valid UUID",
        400,
      );
    }
    try {
      const result = await store.deleteNote({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        id: parsedId.data,
      });
      return noStore(res).json(NoteDeleteResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Note could not be deleted", "NOTE_NOT_FOUND", "NOTE_STORAGE_FAILED");
    }
  });

  // --- Boards CRUD + Autosave Routes ---

  app.get("/api/boards", requireSupabaseWorkbenchAuth, async (req, res) => {
    const parsedQuery = BoardListQuerySchema.safeParse(req.query || {});
    if (!parsedQuery.success) {
      return respondError(
        res,
        "INVALID_INPUT",
        parsedQuery.error.issues?.[0]?.message || "Invalid boards query",
        400,
      );
    }
    try {
      const result = await store.listBoards({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        query: parsedQuery.data,
      });
      return noStore(res).json(BoardListResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Boards could not be loaded", "BOARD_NOT_FOUND", "BOARD_STORAGE_FAILED");
    }
  });

  app.get("/api/boards/:id", requireSupabaseWorkbenchAuth, async (req, res) => {
    const parsedId = BoardIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      return respondError(
        res,
        "INVALID_BOARD_ID",
        parsedId.error.issues?.[0]?.message || "Board ID must be a valid UUID",
        400,
      );
    }
    try {
      const result = await store.getBoard({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        id: parsedId.data,
      });
      return noStore(res).json(BoardResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Board could not be loaded", "BOARD_NOT_FOUND", "BOARD_STORAGE_FAILED");
    }
  });

  app.post("/api/boards", requireSupabaseWorkbenchAuth, async (req, res) => {
    try {
      checkForbiddenWriteKeys(req.body);
      const parsedBody = BoardCreateRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return respondError(
          res,
          "INVALID_INPUT",
          parsedBody.error.issues?.[0]?.message || "Invalid board input",
          400,
        );
      }
      const result = await store.createBoard({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        input: parsedBody.data,
      });
      return noStore(res).status(201).json(BoardResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Board could not be created", "SUBJECT_NOT_FOUND", "BOARD_STORAGE_FAILED");
    }
  });

  async function handleUpdateBoard(req, res) {
    const parsedId = BoardIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      return respondError(
        res,
        "INVALID_BOARD_ID",
        parsedId.error.issues?.[0]?.message || "Board ID must be a valid UUID",
        400,
      );
    }
    try {
      checkForbiddenWriteKeys(req.body);
      const parsedBody = BoardUpdateRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return respondError(
          res,
          "INVALID_INPUT",
          parsedBody.error.issues?.[0]?.message || "Invalid board update input",
          400,
        );
      }
      const result = await store.updateBoard({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        id: parsedId.data,
        input: parsedBody.data,
      });
      return noStore(res).json(BoardResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Board could not be updated", "BOARD_NOT_FOUND", "BOARD_STORAGE_FAILED");
    }
  }

  app.patch("/api/boards/:id", requireSupabaseWorkbenchAuth, handleUpdateBoard);
  app.put("/api/boards/:id", requireSupabaseWorkbenchAuth, handleUpdateBoard);
  app.post("/api/boards/:id", requireSupabaseWorkbenchAuth, handleUpdateBoard);

  app.delete("/api/boards/:id", requireSupabaseWorkbenchAuth, async (req, res) => {
    const parsedId = BoardIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      return respondError(
        res,
        "INVALID_BOARD_ID",
        parsedId.error.issues?.[0]?.message || "Board ID must be a valid UUID",
        400,
      );
    }
    try {
      const result = await store.deleteBoard({
        accessToken: req.supabaseWorkbenchAuth.accessToken,
        ownerId: req.supabaseWorkbenchAuth.ownerId,
        id: parsedId.data,
      });
      return noStore(res).json(BoardDeleteResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Board could not be deleted", "BOARD_NOT_FOUND", "BOARD_STORAGE_FAILED");
    }
  });
}
