import {
  SearchQuerySchema,
  SearchResponseSchema,
  SearchResultItemSchema,
  SupabaseUserIdSchema,
  errorEnvelope,
  parseCandidateSourceKey,
} from "@ja/shared-types";
import { parseAllowedGoogleEmails } from "./auth.js";
import {
  extractBearerToken,
  isPrivilegedSupabaseKey,
} from "./candidate-routes.js";

const DEFAULT_SUPABASE_URL = "https://abnfffkmxqixrwzackjf.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0";

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

export function resolveSearchSupabaseConfig(env = process.env) {
  const hasExplicitServiceKey = Object.entries(env || {}).some(
    ([key, val]) => /^SUPABASE_(?:SERVICE|SECRET)/i.test(key) && typeof val === "string" && val.trim().length > 0,
  );
  if (hasExplicitServiceKey) {
    return {
      enabled: false,
      reason: "Search routes forbid Supabase service or secret keys and require end-user RLS",
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
      reason: "Search routes require a publishable Supabase key, not a privileged key",
    };
  }
  return {
    enabled: true,
    supabaseUrl,
    publishableKey,
  };
}

function nullableTrimmed(value) {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function normalizeRank(value) {
  if (value == null) return 0;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw Object.assign(new Error("Search result rank is invalid"), {
      status: 502,
      code: "SEARCH_STORAGE_FAILED",
    });
  }
  return num;
}

export function normalizeSearchResultRow(row) {
  if (!row || typeof row !== "object") {
    throw Object.assign(new Error("Search result row is missing"), {
      status: 502,
      code: "SEARCH_STORAGE_FAILED",
    });
  }

  const entityType = typeof row.entity_type === "string" ? row.entity_type.trim() : "";
  const rawEntityId = row.entity_id != null ? String(row.entity_id).trim() : "";
  let entityId = rawEntityId;
  let id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : "";

  if (entityType === "candidate") {
    const parsedKey = parseCandidateSourceKey(rawEntityId);
    if (parsedKey) {
      entityId = parsedKey.id;
      if (!id) id = `candidate:${parsedKey.id}`;
    }
  } else if (entityType === "lead" || entityType === "note") {
    entityId = rawEntityId.toLowerCase();
    if (!id && entityId) {
      id = `${entityType}:${entityId}`;
    } else if (id.toLowerCase().startsWith(`${entityType}:`)) {
      id = `${entityType}:${id.slice(entityType.length + 1).toLowerCase()}`;
    }
  } else if (entityType === "job") {
    if (!id && entityId) id = `job:${entityId}`;
  } else if (entityType === "client") {
    if (!id && entityId) id = `client:${entityId.toLowerCase()}`;
  }

  const subjectType = nullableTrimmed(row.subject_type);
  let subjectId = nullableTrimmed(row.subject_id);
  if (subjectType === "candidate" && subjectId) {
    const parsedSubjectKey = parseCandidateSourceKey(subjectId);
    if (parsedSubjectKey) {
      subjectId = parsedSubjectKey.id;
    }
  }

  const normalized = {
    id,
    entity_type: entityType,
    entity_id: entityId,
    title: nullableTrimmed(row.title),
    subtitle: nullableTrimmed(row.subtitle),
    company: nullableTrimmed(row.company),
    location: nullableTrimmed(row.location),
    status: nullableTrimmed(row.status),
    subject_type: subjectType,
    subject_id: subjectId,
    snippet: nullableTrimmed(row.snippet),
    updated_at: normalizeTimestamp(row.updated_at),
    rank: normalizeRank(row.rank),
  };

  try {
    return SearchResultItemSchema.parse(normalized);
  } catch (error) {
    throw Object.assign(
      new Error(error?.issues?.[0]?.message || "Search result violated response contract"),
      { status: 502, code: "SEARCH_STORAGE_FAILED" },
    );
  }
}

export function groupSearchResults(items, { query, limit }) {
  const normalizedItems = (Array.isArray(items) ? items : []).map(normalizeSearchResultRow);
  const candidates = normalizedItems.filter((item) => item.entity_type === "candidate");
  const leads = normalizedItems.filter((item) => item.entity_type === "lead");
  const jobs = normalizedItems.filter((item) => item.entity_type === "job");
  const clients = normalizedItems.filter((item) => item.entity_type === "client");
  const notes = normalizedItems.filter((item) => item.entity_type === "note");

  return SearchResponseSchema.parse({
    query,
    limit,
    results: normalizedItems,
    groups: {
      candidates,
      leads,
      jobs,
      clients,
      notes,
    },
    candidates,
    leads,
    jobs,
    clients,
    notes,
  });
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

function isMissingSearchMigrationError(response, payload) {
  const pgCode = typeof payload?.code === "string" ? payload.code.toUpperCase() : "";
  const combinedText = [
    payload?.message,
    payload?.details,
    payload?.hint,
  ]
    .filter((part) => typeof part === "string")
    .join(" ");

  if (pgCode === "42883" || pgCode === "42P01" || pgCode === "PGRST202" || pgCode === "PGRST205") {
    return true;
  }
  if (
    response.status === 404
    || /search_workbench|search_documents|client_companies|candidates_all|note_body_plain_text|workbench_search_tsquery|could not find the function|does not exist/i.test(combinedText)
  ) {
    return true;
  }
  return false;
}

export function mapSearchPostgrestError(response, payload, fallbackMessage) {
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
  if (isMissingSearchMigrationError(response, payload)) {
    return Object.assign(
      new Error("Full-text search migration 021_fulltext_search.sql is not applied (missing public.search_workbench)"),
      {
        status: 503,
        code: "SEARCH_MIGRATION_REQUIRED",
      },
    );
  }
  if (response.status === 400 || response.status === 422 || pgCode === "23514" || pgCode === "22P02") {
    return Object.assign(new Error(fallbackMessage), {
      status: 400,
      code: "INVALID_INPUT",
    });
  }
  return Object.assign(new Error(fallbackMessage), {
    status: 502,
    code: "SEARCH_STORAGE_FAILED",
  });
}

export function createSupabaseSearchStore({
  supabaseUrl,
  publishableKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!supabaseUrl || !publishableKey) {
    throw new TypeError("supabaseUrl and publishableKey are required");
  }
  if (isPrivilegedSupabaseKey(publishableKey)) {
    throw new Error("Privileged Supabase keys are forbidden in search store");
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
          code: "SEARCH_STORAGE_FAILED",
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

    async searchWorkbench({ accessToken, query }) {
      const validatedQuery = SearchQuerySchema.parse(query);
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/search_workbench`, {
        method: "POST",
        headers: rlsHeaders(accessToken, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          query_text: validatedQuery.q,
          max_per_group: validatedQuery.max_per_group,
        }),
      });
      const payload = await parseJsonSafe(response);
      if (!response.ok || !Array.isArray(payload)) {
        throw mapSearchPostgrestError(response, payload, "Workbench search could not be executed");
      }
      return groupSearchResults(payload, {
        query: validatedQuery.q,
        limit: validatedQuery.limit,
      });
    },
  });
}

export function registerSearchRoutes(app, {
  env = process.env,
  authConfig,
  searchStore,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!app || typeof app.get !== "function") {
    throw new TypeError("An Express app is required");
  }

  const supabaseConfig = resolveSearchSupabaseConfig(env);
  const allowedEmails = parseAllowedGoogleEmails(env.AUTH_ALLOWED_GOOGLE_EMAILS);
  const isApprovedEmail = typeof authConfig?.isApprovedEmail === "function"
    ? authConfig.isApprovedEmail.bind(authConfig)
    : allowedEmails
      ? (email) => typeof email === "string" && allowedEmails.includes(email.trim().toLowerCase())
      : null;

  const store = searchStore ?? (supabaseConfig.enabled
    ? createSupabaseSearchStore({
      supabaseUrl: supabaseConfig.supabaseUrl,
      publishableKey: supabaseConfig.publishableKey,
      fetchImpl,
    })
    : null);

  async function requireSupabaseSearchAuth(req, res, next) {
    if (!store) {
      return respondError(
        res,
        "SUPABASE_UNAVAILABLE",
        supabaseConfig.reason || "Supabase search is unavailable",
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
        return respondError(res, "FORBIDDEN", "This account is not authorized for Workbench search", 403);
      }
      req.supabaseSearchAuth = Object.freeze({
        accessToken,
        userId: parsedUuid.data.toLowerCase(),
        email: user.email || null,
      });
      return next();
    } catch (error) {
      const status = error?.status || 401;
      const code = error?.code || (status === 403 ? "FORBIDDEN" : status === 401 ? "UNAUTHORIZED" : "SEARCH_STORAGE_FAILED");
      const message = error instanceof Error ? error.message : "Supabase authentication failed";
      return respondError(res, code, message, status);
    }
  }

  function handleRouteError(res, error, fallbackMessage) {
    if (error?.name === "ZodError") {
      return respondError(res, "INVALID_INPUT", error.issues?.[0]?.message || fallbackMessage, 400);
    }
    const status = error?.status || 502;
    const code = error?.code || (status === 400 ? "INVALID_INPUT" : status === 503 ? "SEARCH_MIGRATION_REQUIRED" : "SEARCH_STORAGE_FAILED");
    const message = error instanceof Error ? error.message : fallbackMessage;
    return respondError(res, code, message, status);
  }

  app.get("/api/search", requireSupabaseSearchAuth, async (req, res) => {
    const parsedQuery = SearchQuerySchema.safeParse(req.query || {});
    if (!parsedQuery.success) {
      return respondError(
        res,
        "INVALID_INPUT",
        parsedQuery.error.issues?.[0]?.message || "Invalid search query",
        400,
      );
    }
    try {
      const result = await store.searchWorkbench({
        accessToken: req.supabaseSearchAuth.accessToken,
        query: parsedQuery.data,
      });
      return noStore(res).json(SearchResponseSchema.parse(result));
    } catch (error) {
      return handleRouteError(res, error, "Workbench search could not be executed");
    }
  });
}
