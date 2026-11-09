import {
  ErrorEnvelopeSchema,
  MAX_SEARCH_QUERY_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
  SearchQuerySchema,
  SearchResponseSchema,
  parseCandidateSourceKey,
} from "@ja/shared-types";
import { gatewayBaseURL } from "../../auth-client.js";
import { supabase } from "../../supabase-client.js";

export const PRIMARY_SEARCH_GROUPS = Object.freeze([
  Object.freeze({
    key: "candidates",
    entityType: "candidate",
    label: "Candidates",
    emptyText: "No matching candidates",
  }),
  Object.freeze({
    key: "leads",
    entityType: "lead",
    label: "Leads",
    emptyText: "No matching leads",
  }),
  Object.freeze({
    key: "jobs",
    entityType: "job",
    label: "Jobs",
    emptyText: "No matching jobs",
  }),
  Object.freeze({
    key: "clients",
    entityType: "client",
    label: "Clients",
    emptyText: "No matching clients",
  }),
]);

export const NOTES_SEARCH_GROUP = Object.freeze({
  key: "notes",
  entityType: "note",
  label: "Notes",
  emptyText: "No matching notes",
});

const CANDIDATE_SOURCE_LABELS = Object.freeze({
  tracker_candidates: "Tracker",
  sourcing: "Sourcing",
  submission: "Submission",
  manual: "Manual",
});

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = typeof globalThis.atob === "function"
      ? globalThis.atob(padded)
      : Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function isDisallowedSearchToken(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^sb_(?:secret|service)/i.test(trimmed)) return true;
  const payload = decodeJwtPayload(trimmed);
  if (payload && typeof payload.role === "string") {
    const role = payload.role.trim().toLowerCase();
    if (role.includes("service") || role === "supabase_admin") return true;
  }
  return false;
}

export function createSearchStateError(phase, code, message, status = 500) {
  const error = new Error(message);
  error.phase = phase;
  error.code = code;
  error.status = status;
  return error;
}

export async function getCallerSearchAccessToken({ client = supabase } = {}) {
  if (!client?.auth || typeof client.auth.getSession !== "function") {
    throw createSearchStateError(
      "auth_error",
      "UNAUTHORIZED",
      "Sign in with Supabase to search your Workbench records.",
      401,
    );
  }

  let sessionResult;
  try {
    sessionResult = await client.auth.getSession();
  } catch (error) {
    throw createSearchStateError(
      "auth_error",
      "UNAUTHORIZED",
      error instanceof Error && error.message
        ? error.message
        : "Supabase session could not be verified.",
      401,
    );
  }

  if (sessionResult?.error) {
    throw createSearchStateError(
      "auth_error",
      "UNAUTHORIZED",
      sessionResult.error.message || "Supabase session could not be verified.",
      401,
    );
  }

  const accessToken = typeof sessionResult?.data?.session?.access_token === "string"
    ? sessionResult.data.session.access_token.trim()
    : "";

  if (!accessToken) {
    throw createSearchStateError(
      "auth_error",
      "UNAUTHORIZED",
      "Sign in with Supabase to search your Workbench records.",
      401,
    );
  }

  if (isDisallowedSearchToken(accessToken)) {
    throw createSearchStateError(
      "auth_error",
      "FORBIDDEN",
      "Privileged credentials cannot be used for Workbench search.",
      403,
    );
  }

  return accessToken;
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

export function mapGatewaySearchError(status, payload) {
  const parsedEnvelope = ErrorEnvelopeSchema.safeParse(payload);
  const code = parsedEnvelope.success
    ? parsedEnvelope.data.error.code
    : status === 401
      ? "UNAUTHORIZED"
      : status === 403
        ? "FORBIDDEN"
        : status === 503
          ? "SEARCH_MIGRATION_REQUIRED"
          : "SEARCH_STORAGE_FAILED";
  const message = parsedEnvelope.success
    ? parsedEnvelope.data.error.message
    : status === 401
      ? "Sign in with Supabase to search your Workbench records."
      : status === 403
        ? "Your account is not authorized for Workbench search."
        : "Workbench search could not be completed.";

  if (status === 401 || status === 403 || code === "UNAUTHORIZED" || code === "FORBIDDEN") {
    return createSearchStateError("auth_error", code, message, status || 401);
  }
  if (code === "SEARCH_MIGRATION_REQUIRED") {
    return createSearchStateError("migration_required", code, message, status || 503);
  }
  return createSearchStateError("error", code, message, status || 502);
}

export async function searchWorkbench(
  rawQuery,
  {
    limit,
    client = supabase,
    fetchImpl = globalThis.fetch,
    baseURL = gatewayBaseURL,
    signal,
  } = {},
) {
  const queryInput = typeof rawQuery === "string"
    ? { q: rawQuery, ...(limit !== undefined ? { limit } : {}) }
    : rawQuery || {};

  const parsedQuery = SearchQuerySchema.safeParse(queryInput);
  if (!parsedQuery.success) {
    throw createSearchStateError(
      "error",
      "INVALID_INPUT",
      parsedQuery.error.issues?.[0]?.message
        || `Search query must be between ${MIN_SEARCH_QUERY_LENGTH} and ${MAX_SEARCH_QUERY_LENGTH} characters.`,
      400,
    );
  }

  const accessToken = await getCallerSearchAccessToken({ client });

  if (typeof fetchImpl !== "function") {
    throw createSearchStateError("error", "SEARCH_UNAVAILABLE", "Network fetch is unavailable.", 503);
  }

  const url = new URL("/api/search", baseURL);
  url.searchParams.set("q", parsedQuery.data.q);
  if (limit !== undefined) {
    url.searchParams.set("limit", String(parsedQuery.data.limit));
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw createSearchStateError(
      "error",
      "NETWORK_ERROR",
      "Could not reach Workbench search gateway.",
      503,
    );
  }

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw mapGatewaySearchError(response.status, payload);
  }

  const parsedResponse = SearchResponseSchema.safeParse(payload);
  if (!parsedResponse.success) {
    throw createSearchStateError(
      "error",
      "SEARCH_CONTRACT_ERROR",
      "Search gateway returned an invalid response payload.",
      502,
    );
  }

  return parsedResponse.data;
}

export function formatSearchResultItem(item) {
  if (!item || typeof item !== "object") {
    throw new TypeError("Search result item is required");
  }

  if (item.entity_type === "candidate") {
    const parsedKey = parseCandidateSourceKey(item.entity_id);
    const candidateSource = parsedKey?.candidate_source ?? item.status ?? null;
    return Object.freeze({
      id: item.id,
      entityType: "candidate",
      entityId: item.entity_id,
      candidateSource,
      candidateSourceId: parsedKey?.candidate_source_id ?? null,
      sourceLabel: candidateSource ? (CANDIDATE_SOURCE_LABELS[candidateSource] || candidateSource) : null,
      title: item.title ?? null,
      displayTitle: item.title ?? "Unnamed candidate",
      subtitle: item.subtitle ?? null,
      company: item.company ?? null,
      location: item.location ?? null,
      status: item.status ?? null,
      snippet: item.snippet ?? null,
      updatedAt: item.updated_at ?? null,
      rank: item.rank,
    });
  }

  if (item.entity_type === "lead") {
    return Object.freeze({
      id: item.id,
      entityType: "lead",
      entityId: item.entity_id,
      title: item.title ?? null,
      displayTitle: item.title ?? "Unnamed lead",
      subtitle: item.subtitle ?? null,
      company: item.company ?? null,
      location: item.location ?? null,
      status: item.status ?? null,
      snippet: item.snippet ?? null,
      updatedAt: item.updated_at ?? null,
      rank: item.rank,
    });
  }

  if (item.entity_type === "job") {
    return Object.freeze({
      id: item.id,
      entityType: "job",
      entityId: item.entity_id,
      title: item.title ?? null,
      displayTitle: item.title ?? "Untitled job",
      subtitle: item.subtitle ?? null,
      company: item.company ?? null,
      location: item.location ?? null,
      status: item.status ?? null,
      snippet: item.snippet ?? null,
      updatedAt: item.updated_at ?? null,
      rank: item.rank,
    });
  }

  if (item.entity_type === "client") {
    return Object.freeze({
      id: item.id,
      entityType: "client",
      entityId: item.entity_id,
      title: item.title ?? null,
      displayTitle: item.title ?? item.company ?? item.entity_id,
      subtitle: item.subtitle ?? null,
      company: item.company ?? null,
      location: item.location ?? null,
      status: item.status ?? null,
      snippet: item.snippet ?? null,
      updatedAt: item.updated_at ?? null,
      rank: item.rank,
    });
  }

  if (item.entity_type === "note") {
    return Object.freeze({
      id: item.id,
      entityType: "note",
      entityId: item.entity_id,
      title: item.title ?? null,
      displayTitle: item.title ?? "Untitled note",
      subtitle: item.subtitle ?? null,
      company: null,
      location: null,
      status: item.status ?? null,
      subjectType: item.subject_type ?? null,
      subjectId: item.subject_id ?? null,
      snippet: item.snippet ?? null,
      updatedAt: item.updated_at ?? null,
      rank: item.rank,
    });
  }

  throw new Error(`Unsupported search entity_type: ${String(item.entity_type)}`);
}

export function buildDisplayGroups(searchResponse) {
  const groups = searchResponse?.groups || {
    candidates: [],
    leads: [],
    jobs: [],
    clients: [],
    notes: [],
  };

  const displayGroups = PRIMARY_SEARCH_GROUPS.map((group) => {
    const rawItems = Array.isArray(groups[group.key]) ? groups[group.key] : [];
    return Object.freeze({
      ...group,
      items: rawItems.map(formatSearchResultItem),
      rawItems,
    });
  });

  const rawNotes = Array.isArray(groups.notes) ? groups.notes : [];
  if (rawNotes.length > 0) {
    displayGroups.push(
      Object.freeze({
        ...NOTES_SEARCH_GROUP,
        items: rawNotes.map(formatSearchResultItem),
        rawItems: rawNotes,
      }),
    );
  }

  return Object.freeze(displayGroups);
}

export function resolveSearchNavigation(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const entityType = item.entity_type || item.entityType;
  const entityId = String(item.entity_id ?? item.entityId ?? "").trim();
  const id = String(item.id || "").trim();

  if (!entityType || !entityId) {
    return null;
  }

  if (entityType === "candidate") {
    const parsed = parseCandidateSourceKey(entityId);
    const normalizedEntityId = parsed ? parsed.id : entityId;
    return Object.freeze({
      page: "Candidates",
      entityType: "candidate",
      id: id || `candidate:${normalizedEntityId}`,
      entityId: normalizedEntityId,
      candidateSource: parsed?.candidate_source ?? item.status ?? null,
      candidateSourceId: parsed?.candidate_source_id ?? null,
      trackerSource: parsed?.tracker_source ?? null,
      isManual: parsed?.is_manual ?? false,
      focusCandidateId: normalizedEntityId,
    });
  }

  if (entityType === "lead") {
    return Object.freeze({
      page: "Leads",
      entityType: "lead",
      id: id || `lead:${entityId.toLowerCase()}`,
      entityId: entityId.toLowerCase(),
      focusLeadId: entityId.toLowerCase(),
    });
  }

  if (entityType === "job") {
    return Object.freeze({
      page: "Jobs",
      entityType: "job",
      id: id || `job:${entityId}`,
      entityId,
      focusJobId: entityId,
      job: Object.freeze({
        id: entityId,
        loxoJobId: entityId,
        title: item.title ?? null,
        company: item.company ?? null,
        location: item.location ?? null,
        status: item.status ?? null,
        description: item.snippet ?? null,
      }),
    });
  }

  if (entityType === "client") {
    return Object.freeze({
      page: "Leads",
      entityType: "client",
      id: id || `client:${entityId.toLowerCase()}`,
      entityId,
      focusClientId: entityId,
      client: Object.freeze({
        id: id || `client:${entityId.toLowerCase()}`,
        entityId,
        company: item.company ?? item.title ?? null,
        jobTitles: item.subtitle ?? null,
        location: item.location ?? null,
        status: item.status ?? null,
        clientContact: item.snippet ?? null,
      }),
    });
  }

  if (entityType === "note") {
    // Every note hit opens the Notes directory with this note focused, including unlinked notes.
    // The stored subject is kept only as a label; navigation never follows it.
    const rawSubjectId = item.subject_id ?? item.subjectId ?? null;
    const subjectId = typeof rawSubjectId === "string" && rawSubjectId.trim() ? rawSubjectId.trim() : null;
    return Object.freeze({
      page: "Notes",
      entityType: "note",
      id: id || `note:${entityId.toLowerCase()}`,
      entityId: entityId.toLowerCase(),
      subjectType: subjectId ? (item.subject_type ?? item.subjectType ?? null) : null,
      subjectId,
      focusNoteId: entityId.toLowerCase(),
    });
  }

  return null;
}

export function formatResultMetadata(item) {
  if (!item) return "";
  if (item.entityType === "candidate") {
    const parts = [item.subtitle, item.company, item.location].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "Details not on file";
  }
  if (item.entityType === "lead") {
    const parts = [item.subtitle, item.location].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "Role not on file";
  }
  if (item.entityType === "job") {
    const companyText = item.company ?? "Company unknown";
    const locationText = item.location ?? "Location unknown";
    return `${companyText} · ${locationText}`;
  }
  if (item.entityType === "client") {
    const rolesText = item.subtitle ?? "Roles unknown";
    const locationText = item.location ?? "Location unknown";
    return `${rolesText} · ${locationText}`;
  }
  if (item.entityType === "note") {
    if (item.subjectType && item.subjectId) {
      return `${item.subjectType} · ${item.subjectId}`;
    }
    return "General note";
  }
  return "";
}

export async function runWorkbenchSearch(rawQuery, options = {}) {
  const trimmed = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!trimmed) {
    return Object.freeze({
      phase: "idle",
      query: "",
      data: null,
      groups: Object.freeze([]),
      totalCount: 0,
      error: null,
    });
  }

  try {
    const data = await searchWorkbench(trimmed, options);
    const groups = buildDisplayGroups(data);
    const totalCount = data.results.length;
    return Object.freeze({
      phase: totalCount === 0 ? "empty" : "ready",
      query: data.query,
      data,
      groups,
      totalCount,
      error: null,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const phase = error?.phase || "error";
    const code = error?.code || "SEARCH_FAILED";
    const status = error?.status || 500;
    const message = error instanceof Error && error.message
      ? error.message
      : "Workbench search could not be completed.";
    return Object.freeze({
      phase,
      query: trimmed,
      data: null,
      groups: Object.freeze([]),
      totalCount: 0,
      error: Object.freeze({ code, message, status }),
    });
  }
}
