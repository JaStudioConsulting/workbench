import {
  CANDIDATE_TO_TRACKER_SOURCE,
  CandidateCreateRequestSchema,
  CandidateEditRequestSchema,
  CandidateIdSchema,
  CandidateListQuerySchema,
  CandidateListResponseSchema,
  CandidateRecordSchema,
  CandidateResponseSchema,
  ManualCandidateEditsSchema,
  SupabaseUserIdSchema,
  TrackerCandidateEditsSchema,
  errorEnvelope,
  parseCandidateSourceKey,
} from "@ja/shared-types";
import { parseAllowedGoogleEmails } from "./auth.js";

const DEFAULT_SUPABASE_URL = "https://abnfffkmxqixrwzackjf.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0";

const FORBIDDEN_WRITE_KEYS = new Set([
  "id",
  "owner_id",
  "ownerId",
  "candidate_source",
  "candidateSource",
  "candidate_source_id",
  "candidateSourceId",
  "source_candidate_key",
  "sourceCandidateKey",
  "source_updated_at",
  "sourceUpdatedAt",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "edited_at",
  "editedAt",
  "is_manual",
  "isManual",
  "raw",
  "imported_at",
]);

function noStore(res) {
  res.set("Cache-Control", "private, no-store");
  return res;
}

function respondError(res, code, message, status) {
  return noStore(res).status(status).json(errorEnvelope(code, message));
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function isPrivilegedSupabaseKey(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^sb_secret_/i.test(trimmed) || /service[_-]?role/i.test(trimmed)) return true;
  const payload = decodeJwtPayload(trimmed);
  const role = typeof payload?.role === "string" ? payload.role.toLowerCase() : "";
  return role === "service_role" || role === "supabase_admin";
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

export function resolveCandidateSupabaseConfig(env = process.env) {
  const hasExplicitServiceKey = Object.entries(env || {}).some(
    ([key, val]) => /^SUPABASE_(?:SERVICE|SECRET)/i.test(key) && typeof val === "string" && val.trim().length > 0,
  );
  if (hasExplicitServiceKey) {
    return {
      enabled: false,
      reason: "Candidate routes forbid Supabase service or secret keys and require end-user RLS",
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
      reason: "Candidate routes require a publishable Supabase key, not a privileged key",
    };
  }
  return {
    enabled: true,
    supabaseUrl,
    publishableKey,
  };
}

export function extractBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") return null;
  const match = authorizationHeader.trim().match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token || token.length > 8192 || /[\r\n\0]/.test(token)) return null;
  return token;
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
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return trimmed;
  }
  return null;
}

export function normalizeCandidateRow(row) {
  if (!row || typeof row !== "object") {
    throw Object.assign(new Error("Candidate record is missing"), { status: 502, code: "CANDIDATE_STORAGE_FAILED" });
  }
  const normalized = {
    id: typeof row.id === "string" ? row.id : `${row.candidate_source}:${row.candidate_source_id}`,
    candidate_source: row.candidate_source ?? null,
    tracker_source: row.tracker_source ?? null,
    candidate_source_id: row.candidate_source_id != null ? String(row.candidate_source_id) : "",
    tracker_row: row.tracker_row != null ? Number(row.tracker_row) : null,
    candidate_name: row.candidate_name ?? null,
    current_title: row.current_title ?? null,
    current_company: row.current_company ?? null,
    location: row.location ?? null,
    industry: row.industry ?? null,
    shift: row.shift ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    compensation_target: row.compensation_target ?? null,
    current_compensation: row.current_compensation ?? null,
    compensation_context: row.compensation_context ?? null,
    notes: row.notes ?? null,
    profile_url: row.profile_url ?? null,
    role_context: row.role_context ?? null,
    client_context: row.client_context ?? null,
    source_candidate_key: row.source_candidate_key ?? null,
    source_updated_at: normalizeTimestamp(row.source_updated_at),
    edited_at: normalizeTimestamp(row.edited_at),
    is_manual: Boolean(row.is_manual),
  };
  return CandidateRecordSchema.parse(normalized);
}

function sanitizeSearchTerm(value) {
  return String(value || "")
    .replace(/[(),*%\\]/g, " ")
    .trim();
}

function checkForbiddenWriteKeys(rawBody) {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw Object.assign(new Error("Request body must be a JSON object"), { status: 400, code: "INVALID_INPUT" });
  }
  for (const key of Object.keys(rawBody)) {
    if (FORBIDDEN_WRITE_KEYS.has(key)) {
      throw Object.assign(
        new Error(`${key} cannot be set by the client`),
        { status: 400, code: "INVALID_INPUT" },
      );
    }
  }
  if (rawBody.edits && typeof rawBody.edits === "object" && !Array.isArray(rawBody.edits)) {
    for (const key of Object.keys(rawBody.edits)) {
      if (FORBIDDEN_WRITE_KEYS.has(key)) {
        throw Object.assign(
          new Error(`${key} cannot be set by the client`),
          { status: 400, code: "INVALID_INPUT" },
        );
      }
    }
  }
}

export function parseValidatedCandidateEdit(rawBody, targetKey) {
  checkForbiddenWriteKeys(rawBody);
  const hasEditsWrapper = Object.hasOwn(rawBody, "edits");

  if (targetKey.is_manual) {
    if (Object.hasOwn(rawBody, "tracker_source") || Object.hasOwn(rawBody, "tracker_row")) {
      throw Object.assign(
        new Error("Manual candidates do not accept tracker_source or tracker_row"),
        { status: 400, code: "INVALID_INPUT" },
      );
    }
    if (hasEditsWrapper) {
      const unknownWrapperKeys = Object.keys(rawBody).filter((key) => key !== "edits");
      if (unknownWrapperKeys.length > 0) {
        throw Object.assign(
          new Error(`Unsupported fields on manual candidate edit: ${unknownWrapperKeys.join(", ")}`),
          { status: 400, code: "INVALID_INPUT" },
        );
      }
    }
    const candidatePatch = hasEditsWrapper ? rawBody.edits : rawBody;
    const parsed = ManualCandidateEditsSchema.safeParse(candidatePatch);
    if (!parsed.success) {
      throw Object.assign(
        new Error(parsed.error.issues?.[0]?.message || "Invalid manual candidate edit fields"),
        { status: 400, code: "INVALID_INPUT" },
      );
    }
    const definedEntries = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
    return {
      edits: Object.fromEntries(definedEntries),
      tracker_source: null,
      tracker_row: null,
    };
  }

  const parsed = CandidateEditRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw Object.assign(
      new Error(parsed.error.issues?.[0]?.message || "Invalid candidate overlay edit fields"),
      { status: 400, code: "INVALID_INPUT" },
    );
  }
  const rawEdits = hasEditsWrapper ? parsed.data.edits : parsed.data;
  const trackerSource = hasEditsWrapper ? parsed.data.tracker_source : undefined;
  const trackerRow = hasEditsWrapper ? parsed.data.tracker_row : undefined;

  if (trackerSource !== undefined && trackerSource !== targetKey.tracker_source) {
    throw Object.assign(
      new Error("tracker_source does not match candidate source key"),
      { status: 400, code: "INVALID_INPUT" },
    );
  }

  const validatedEdits = TrackerCandidateEditsSchema.parse(rawEdits);
  const definedEntries = Object.entries(validatedEdits).filter(([, value]) => value !== undefined);
  return {
    edits: Object.fromEntries(definedEntries),
    tracker_source: trackerSource ?? targetKey.tracker_source,
    tracker_row: trackerRow ?? null,
  };
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

function mapPostgrestError(response, payload, fallbackMessage) {
  const pgCode = payload?.code;
  const message = typeof payload?.message === "string" ? payload.message : "";
  if (response.status === 401) {
    return Object.assign(new Error("Supabase rejected the bearer token"), { status: 401, code: "UNAUTHORIZED" });
  }
  if (response.status === 403 || pgCode === "42501" || /row-level security|permission denied|insufficient_privilege/i.test(message)) {
    return Object.assign(new Error("Access denied by Supabase row-level security"), { status: 403, code: "FORBIDDEN" });
  }
  if (response.status === 400 || response.status === 422 || pgCode === "23514" || pgCode === "22P02") {
    return Object.assign(new Error(fallbackMessage), { status: 400, code: "INVALID_INPUT" });
  }
  return Object.assign(new Error(fallbackMessage), { status: 502, code: "CANDIDATE_STORAGE_FAILED" });
}

export function createSupabaseCandidateStore({
  supabaseUrl,
  publishableKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!supabaseUrl || !publishableKey) {
    throw new TypeError("supabaseUrl and publishableKey are required");
  }
  if (isPrivilegedSupabaseKey(publishableKey)) {
    throw new Error("Privileged Supabase keys are forbidden in candidate store");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch implementation is required");
  }

  function rlsHeaders(accessToken, extra = {}) {
    if (!accessToken || isPrivilegedSupabaseKey(accessToken)) {
      throw Object.assign(new Error("Service role tokens are not allowed"), { status: 403, code: "FORBIDDEN" });
    }
    return {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...extra,
    };
  }

  async function selectSingleCandidateById(accessToken, id) {
    const params = new URLSearchParams({
      select: "*",
      id: `eq.${id}`,
      limit: "1",
    });
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/candidates_all?${params.toString()}`, {
      method: "GET",
      headers: rlsHeaders(accessToken),
    });
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
      throw mapPostgrestError(response, payload, "Candidate could not be loaded");
    }
    const row = Array.isArray(payload) ? payload[0] : null;
    return row ? normalizeCandidateRow(row) : null;
  }

  return Object.freeze({
    async verifyUser(accessToken) {
      const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
        method: "GET",
        headers: rlsHeaders(accessToken),
      });
      const payload = await parseJsonSafe(response);
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("Supabase session is invalid or expired"), { status: 401, code: "UNAUTHORIZED" });
      }
      if (!response.ok || !payload || typeof payload !== "object") {
        throw Object.assign(new Error("Supabase authentication check failed"), { status: 502, code: "CANDIDATE_STORAGE_FAILED" });
      }
      if (payload.role === "service_role" || payload.role === "supabase_admin") {
        throw Object.assign(new Error("Service role credentials are not allowed"), { status: 403, code: "FORBIDDEN" });
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

    async listCandidates({ accessToken, query }) {
      const params = new URLSearchParams({
        select: "*",
        order: "edited_at.desc.nullslast,source_updated_at.desc.nullslast,id.asc",
        limit: String(query.limit),
        offset: String(query.offset),
      });
      if (query.source) {
        params.set("candidate_source", `eq.${query.source}`);
      }
      if (query.q) {
        const term = sanitizeSearchTerm(query.q);
        if (term) {
          const cols = [
            "candidate_name",
            "current_title",
            "current_company",
            "location",
            "industry",
            "email",
            "notes",
            "role_context",
            "client_context",
          ];
          params.set("or", `(${cols.map((col) => `${col}.ilike.*${term}*`).join(",")})`);
        }
      }
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/candidates_all?${params.toString()}`, {
        method: "GET",
        headers: rlsHeaders(accessToken),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok || !Array.isArray(payload)) {
        throw mapPostgrestError(response, payload, "Candidates could not be loaded");
      }
      return CandidateListResponseSchema.parse({
        candidates: payload.map(normalizeCandidateRow),
      });
    },

    async getCandidate({ accessToken, id }) {
      const candidate = await selectSingleCandidateById(accessToken, id);
      if (!candidate) {
        throw Object.assign(new Error("Candidate was not found"), { status: 404, code: "CANDIDATE_NOT_FOUND" });
      }
      return CandidateResponseSchema.parse({ candidate });
    },

    async createManualCandidate({ accessToken, ownerId, input }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();
      const rowToInsert = {
        owner_id: checkedOwnerId,
        candidate_name: input.candidate_name,
      };
      for (const [key, value] of Object.entries(input)) {
        if (key !== "candidate_name" && value !== undefined) {
          rowToInsert[key] = value;
        }
      }

      const response = await fetchImpl(`${supabaseUrl}/rest/v1/candidates_manual?select=*`, {
        method: "POST",
        headers: rlsHeaders(accessToken, {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        }),
        body: JSON.stringify(rowToInsert),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok) {
        throw mapPostgrestError(response, payload, "Manual candidate could not be created");
      }
      const inserted = Array.isArray(payload) ? payload[0] : payload;
      if (!inserted?.id) {
        throw Object.assign(new Error("Manual candidate insert returned no record"), { status: 502, code: "CANDIDATE_STORAGE_FAILED" });
      }
      if (inserted.owner_id && String(inserted.owner_id).toLowerCase() !== checkedOwnerId) {
        throw Object.assign(new Error("Manual candidate owner mismatch"), { status: 403, code: "FORBIDDEN" });
      }

      const candidateId = `manual:${String(inserted.id).toLowerCase()}`;
      const fromView = await selectSingleCandidateById(accessToken, candidateId);
      if (fromView) {
        return CandidateResponseSchema.parse({ candidate: fromView });
      }
      const fallbackRow = normalizeCandidateRow({
        id: candidateId,
        candidate_source: "manual",
        tracker_source: null,
        candidate_source_id: String(inserted.id).toLowerCase(),
        tracker_row: null,
        candidate_name: inserted.candidate_name,
        current_title: inserted.current_title ?? null,
        current_company: inserted.current_company ?? null,
        location: inserted.location ?? null,
        industry: inserted.industry ?? null,
        shift: inserted.shift ?? null,
        email: inserted.email ?? null,
        phone: inserted.phone ?? null,
        compensation_target: inserted.compensation_target ?? null,
        current_compensation: inserted.current_compensation ?? null,
        compensation_context: null,
        notes: inserted.notes ?? null,
        profile_url: null,
        role_context: null,
        client_context: null,
        source_candidate_key: null,
        source_updated_at: inserted.updated_at ?? inserted.created_at ?? new Date().toISOString(),
        edited_at: inserted.updated_at ?? inserted.created_at ?? new Date().toISOString(),
        is_manual: true,
      });
      return CandidateResponseSchema.parse({ candidate: fallbackRow });
    },

    async editCandidate({ accessToken, ownerId, targetKey, parsedEdit }) {
      const checkedOwnerId = SupabaseUserIdSchema.parse(ownerId).toLowerCase();

      if (targetKey.is_manual) {
        const params = new URLSearchParams({
          id: `eq.${targetKey.candidate_source_id}`,
          owner_id: `eq.${checkedOwnerId}`,
          select: "*",
        });
        const response = await fetchImpl(`${supabaseUrl}/rest/v1/candidates_manual?${params.toString()}`, {
          method: "PATCH",
          headers: rlsHeaders(accessToken, {
            "Content-Type": "application/json",
            Prefer: "return=representation",
          }),
          body: JSON.stringify(parsedEdit.edits),
        });
        const payload = await parseJsonSafe(response);
        if (!response.ok) {
          throw mapPostgrestError(response, payload, "Manual candidate could not be updated");
        }
        const updated = Array.isArray(payload) ? payload[0] : payload;
        if (!updated?.id) {
          throw Object.assign(new Error("Candidate was not found"), { status: 404, code: "CANDIDATE_NOT_FOUND" });
        }
        if (updated.owner_id && String(updated.owner_id).toLowerCase() !== checkedOwnerId) {
          throw Object.assign(new Error("Manual candidate owner mismatch"), { status: 403, code: "FORBIDDEN" });
        }
        const fromView = await selectSingleCandidateById(accessToken, targetKey.id);
        if (fromView) {
          return CandidateResponseSchema.parse({ candidate: fromView });
        }
        const fallbackRow = normalizeCandidateRow({
          id: targetKey.id,
          candidate_source: "manual",
          tracker_source: null,
          candidate_source_id: targetKey.candidate_source_id,
          tracker_row: null,
          candidate_name: updated.candidate_name,
          current_title: updated.current_title ?? null,
          current_company: updated.current_company ?? null,
          location: updated.location ?? null,
          industry: updated.industry ?? null,
          shift: updated.shift ?? null,
          email: updated.email ?? null,
          phone: updated.phone ?? null,
          compensation_target: updated.compensation_target ?? null,
          current_compensation: updated.current_compensation ?? null,
          compensation_context: null,
          notes: updated.notes ?? null,
          profile_url: null,
          role_context: null,
          client_context: null,
          source_candidate_key: null,
          source_updated_at: updated.updated_at ?? new Date().toISOString(),
          edited_at: updated.updated_at ?? new Date().toISOString(),
          is_manual: true,
        });
        return CandidateResponseSchema.parse({ candidate: fallbackRow });
      }

      const existingCandidate = await selectSingleCandidateById(accessToken, targetKey.id);
      if (!existingCandidate) {
        throw Object.assign(new Error("Candidate was not found"), { status: 404, code: "CANDIDATE_NOT_FOUND" });
      }
      const expectedTrackerSource = CANDIDATE_TO_TRACKER_SOURCE[targetKey.candidate_source];
      if (existingCandidate.tracker_source !== expectedTrackerSource || !existingCandidate.tracker_row) {
        throw Object.assign(new Error("Candidate source provenance is invalid"), { status: 409, code: "SOURCE_MISMATCH" });
      }
      if (parsedEdit.tracker_row !== null && parsedEdit.tracker_row !== existingCandidate.tracker_row) {
        throw Object.assign(
          new Error("tracker_row does not match candidate source record"),
          { status: 400, code: "INVALID_INPUT" },
        );
      }

      const existingOverlayParams = new URLSearchParams({
        select: "id,owner_id,tracker_source,tracker_row,edits",
        owner_id: `eq.${checkedOwnerId}`,
        tracker_source: `eq.${existingCandidate.tracker_source}`,
        tracker_row: `eq.${existingCandidate.tracker_row}`,
        limit: "1",
      });
      const existingOverlayRes = await fetchImpl(
        `${supabaseUrl}/rest/v1/candidate_edits?${existingOverlayParams.toString()}`,
        {
          method: "GET",
          headers: rlsHeaders(accessToken),
        },
      );
      const existingOverlayPayload = await parseJsonSafe(existingOverlayRes);
      if (!existingOverlayRes.ok) {
        throw mapPostgrestError(existingOverlayRes, existingOverlayPayload, "Existing candidate edits could not be loaded");
      }
      const existingOverlay = Array.isArray(existingOverlayPayload) ? existingOverlayPayload[0] : null;
      const priorEdits = existingOverlay?.edits && typeof existingOverlay.edits === "object" && !Array.isArray(existingOverlay.edits)
        ? existingOverlay.edits
        : {};
      const mergedEdits = TrackerCandidateEditsSchema.parse({
        ...priorEdits,
        ...parsedEdit.edits,
      });

      const upsertParams = new URLSearchParams({
        on_conflict: "owner_id,tracker_source,tracker_row",
        select: "*",
      });
      const upsertRes = await fetchImpl(
        `${supabaseUrl}/rest/v1/candidate_edits?${upsertParams.toString()}`,
        {
          method: "POST",
          headers: rlsHeaders(accessToken, {
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=representation",
          }),
          body: JSON.stringify({
            owner_id: checkedOwnerId,
            tracker_source: existingCandidate.tracker_source,
            tracker_row: existingCandidate.tracker_row,
            edits: mergedEdits,
          }),
        },
      );
      const upsertPayload = await parseJsonSafe(upsertRes);
      if (!upsertRes.ok) {
        throw mapPostgrestError(upsertRes, upsertPayload, "Candidate overlay edits could not be saved");
      }

      const updatedCandidate = await selectSingleCandidateById(accessToken, targetKey.id);
      if (!updatedCandidate) {
        throw Object.assign(new Error("Overlaid candidate could not be loaded"), { status: 502, code: "CANDIDATE_STORAGE_FAILED" });
      }
      return CandidateResponseSchema.parse({ candidate: updatedCandidate });
    },
  });
}

export function registerCandidateRoutes(app, {
  env = process.env,
  authConfig,
  candidateStore,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") {
    throw new TypeError("An Express app is required");
  }

  const supabaseConfig = resolveCandidateSupabaseConfig(env);
  const allowedEmails = parseAllowedGoogleEmails(env.AUTH_ALLOWED_GOOGLE_EMAILS);
  const isApprovedEmail = typeof authConfig?.isApprovedEmail === "function"
    ? authConfig.isApprovedEmail.bind(authConfig)
    : allowedEmails
      ? (email) => typeof email === "string" && allowedEmails.includes(email.trim().toLowerCase())
      : null;

  const store = candidateStore ?? (supabaseConfig.enabled
    ? createSupabaseCandidateStore({
      supabaseUrl: supabaseConfig.supabaseUrl,
      publishableKey: supabaseConfig.publishableKey,
      fetchImpl,
    })
    : null);

  async function requireSupabaseCandidateAuth(req, res, next) {
    if (!store) {
      return respondError(
        res,
        "SUPABASE_UNAVAILABLE",
        supabaseConfig.reason || "Supabase candidate storage is unavailable",
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
        return respondError(res, "FORBIDDEN", "This account is not authorized for Workbench candidates", 403);
      }
      req.supabaseCandidateAuth = Object.freeze({
        accessToken,
        ownerId: parsedUuid.data.toLowerCase(),
        email: user.email || null,
      });
      return next();
    } catch (error) {
      const status = error?.status || 401;
      const code = error?.code || (status === 403 ? "FORBIDDEN" : status === 401 ? "UNAUTHORIZED" : "CANDIDATE_STORAGE_FAILED");
      const message = error instanceof Error ? error.message : "Supabase authentication failed";
      return respondError(res, code, message, status);
    }
  }

  function handleRouteError(res, error, fallbackMessage) {
    if (error?.name === "ZodError") {
      return respondError(res, "INVALID_INPUT", error.issues?.[0]?.message || fallbackMessage, 400);
    }
    const status = error?.status || 502;
    const code = error?.code || (status === 400 ? "INVALID_INPUT" : status === 404 ? "CANDIDATE_NOT_FOUND" : "CANDIDATE_STORAGE_FAILED");
    const message = error instanceof Error ? error.message : fallbackMessage;
    return respondError(res, code, message, status);
  }

  app.get("/api/candidates", requireSupabaseCandidateAuth, async (req, res) => {
    const parsedQuery = CandidateListQuerySchema.safeParse(req.query || {});
    if (!parsedQuery.success) {
      return respondError(res, "INVALID_INPUT", parsedQuery.error.issues?.[0]?.message || "Invalid candidate query", 400);
    }
    try {
      const result = await store.listCandidates({
        accessToken: req.supabaseCandidateAuth.accessToken,
        ownerId: req.supabaseCandidateAuth.ownerId,
        query: parsedQuery.data,
      });
      return noStore(res).json(CandidateListResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Candidates could not be loaded");
    }
  });

  app.get("/api/candidates/:id", requireSupabaseCandidateAuth, async (req, res) => {
    const parsedId = CandidateIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      return respondError(
        res,
        "INVALID_CANDIDATE_ID",
        parsedId.error.issues?.[0]?.message || "Invalid candidate source key",
        400,
      );
    }
    try {
      const result = await store.getCandidate({
        accessToken: req.supabaseCandidateAuth.accessToken,
        ownerId: req.supabaseCandidateAuth.ownerId,
        id: parsedId.data,
      });
      return noStore(res).json(CandidateResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Candidate could not be loaded");
    }
  });

  app.post("/api/candidates", requireSupabaseCandidateAuth, async (req, res) => {
    try {
      checkForbiddenWriteKeys(req.body);
      const parsedBody = CandidateCreateRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return respondError(
          res,
          "INVALID_INPUT",
          parsedBody.error.issues?.[0]?.message || "Invalid candidate input",
          400,
        );
      }
      const result = await store.createManualCandidate({
        accessToken: req.supabaseCandidateAuth.accessToken,
        ownerId: req.supabaseCandidateAuth.ownerId,
        input: parsedBody.data,
      });
      return noStore(res).status(201).json(CandidateResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Candidate could not be created");
    }
  });

  async function handleEditCandidate(req, res) {
    const parsedId = CandidateIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      return respondError(
        res,
        "INVALID_CANDIDATE_ID",
        parsedId.error.issues?.[0]?.message || "Invalid candidate source key",
        400,
      );
    }
    const targetKey = parseCandidateSourceKey(parsedId.data);
    try {
      const parsedEdit = parseValidatedCandidateEdit(req.body, targetKey);
      const result = await store.editCandidate({
        accessToken: req.supabaseCandidateAuth.accessToken,
        ownerId: req.supabaseCandidateAuth.ownerId,
        targetKey,
        parsedEdit,
      });
      return noStore(res).json(CandidateResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Candidate could not be updated");
    }
  }

  app.patch("/api/candidates/:id", requireSupabaseCandidateAuth, handleEditCandidate);
  app.post("/api/candidates/:id", requireSupabaseCandidateAuth, handleEditCandidate);
}
