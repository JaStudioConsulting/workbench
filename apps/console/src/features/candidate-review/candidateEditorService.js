import {
  CANDIDATE_TO_TRACKER_SOURCE,
  CandidateCreateRequestSchema,
  CandidateEditRequestSchema,
  CandidateIdSchema,
  CandidateListQuerySchema,
  CandidateListResponseSchema,
  CandidateRecordSchema,
  CandidateResponseSchema,
  MANUAL_CANDIDATE_EDITABLE_FIELDS,
  ManualCandidateEditsSchema,
  SupabaseUserIdSchema,
  TRACKER_CANDIDATE_OVERLAY_FIELDS,
  TrackerCandidateEditsSchema,
  parseCandidateSourceKey,
} from "@ja/shared-types";
import { gatewayBaseURL } from "../../auth-client.js";
import { supabase } from "../../supabase-client.js";

const UI_PLACEHOLDER_VALUES = new Set([
  "Unnamed candidate",
  "Title not recorded",
  "Company not recorded",
]);

const UI_FALLBACK_KEYS = Object.freeze({
  candidate_name: "name",
  current_title: "title",
  current_company: "employer",
  location: "location",
  industry: "industry",
  shift: "shift",
  email: "email",
  phone: "phone",
  compensation_target: "compensationTarget",
  current_compensation: "currentCompensation",
  compensation_context: "compensationContext",
  notes: "additionalNotes",
  profile_url: "profileUrl",
  role_context: "roleContext",
  client_context: "clientContext",
});

const SOURCE_LABELS = Object.freeze({
  manual: "Manual record",
  tracker_candidates: "Tracker candidates",
  sourcing: "Tracker sourcing",
  submission: "Tracker submission",
});

export const CANDIDATE_FORM_FIELD_CONFIGS = Object.freeze([
  { key: "candidate_name", label: "Candidate name", type: "text", maxLength: 300, required: true, trackerOnly: false },
  { key: "current_title", label: "Current title", type: "text", maxLength: 300, required: false, trackerOnly: false },
  { key: "current_company", label: "Current company", type: "text", maxLength: 300, required: false, trackerOnly: false },
  { key: "location", label: "Location", type: "text", maxLength: 300, required: false, trackerOnly: false },
  { key: "industry", label: "Industry", type: "text", maxLength: 300, required: false, trackerOnly: false },
  { key: "shift", label: "Shift", type: "text", maxLength: 200, required: false, trackerOnly: false },
  { key: "email", label: "Email", type: "email", maxLength: 320, required: false, trackerOnly: false },
  { key: "phone", label: "Phone", type: "tel", maxLength: 100, required: false, trackerOnly: false },
  { key: "compensation_target", label: "Target compensation", type: "text", maxLength: 300, required: false, trackerOnly: false },
  { key: "current_compensation", label: "Current compensation", type: "text", maxLength: 300, required: false, trackerOnly: false },
  {
    key: "compensation_context",
    label: "Compensation context (imported target/current)",
    type: "text",
    maxLength: 500,
    required: false,
    trackerOnly: true,
  },
  { key: "profile_url", label: "Profile URL", type: "url", maxLength: 2000, required: false, trackerOnly: true },
  { key: "role_context", label: "Role context", type: "text", maxLength: 300, required: false, trackerOnly: true },
  { key: "client_context", label: "Client context", type: "text", maxLength: 300, required: false, trackerOnly: true },
  { key: "notes", label: "Notes", type: "textarea", maxLength: 20000, required: false, trackerOnly: false },
]);

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

const candidateRecordsById = new Map();
const storeListeners = new Set();
let cachedOwnerId = null;

function notifyListeners() {
  const snapshot = getCachedCandidateRecords();
  for (const listener of storeListeners) {
    try {
      listener(snapshot);
    } catch {
      // Ignore subscriber errors so store updates remain resilient.
    }
  }
}

function syncCacheOwner(ownerId) {
  const normalized = ownerId ? String(ownerId).toLowerCase() : null;
  if (normalized === cachedOwnerId) return;
  cachedOwnerId = normalized;
  candidateRecordsById.clear();
  notifyListeners();
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_event, session) => {
    syncCacheOwner(session?.user?.id || null);
  });
}

export function subscribeCandidateRecords(listener) {
  if (typeof listener !== "function") return () => {};
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

export function getCachedCandidateRecord(id) {
  const parsed = parseCandidateSourceKey(String(id || ""));
  if (!parsed) return null;
  return candidateRecordsById.get(parsed.id) || null;
}

export function getCachedCandidateRecords() {
  return [...candidateRecordsById.values()];
}

function storeCandidateRecord(record) {
  const validated = CandidateRecordSchema.parse(record);
  candidateRecordsById.set(validated.id, validated);
  notifyListeners();
  return validated;
}

function storeCandidateRecordList(records) {
  const validatedList = [];
  for (const item of records || []) {
    const validated = CandidateRecordSchema.parse(item);
    candidateRecordsById.set(validated.id, validated);
    validatedList.push(validated);
  }
  notifyListeners();
  return validatedList;
}

export function _resetCandidateEditorStoreForTesting() {
  candidateRecordsById.clear();
  storeListeners.clear();
  cachedOwnerId = null;
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof Buffer !== "undefined"
      ? Buffer.from(base64, "base64").toString("utf8")
      : globalThis.atob(base64);
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function isPrivilegedSupabaseCredential(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^sb_secret_/i.test(trimmed) || /service[_-]?role/i.test(trimmed)) return true;
  const payload = decodeJwtPayload(trimmed);
  const role = typeof payload?.role === "string" ? payload.role.toLowerCase() : "";
  return role === "service_role" || role === "supabase_admin";
}

export async function getSupabaseCandidateAccessToken({ client = supabase } = {}) {
  if (!client?.auth || typeof client.auth.getSession !== "function") {
    throw Object.assign(
      new Error("Supabase authentication client is unavailable."),
      { code: "SUPABASE_UNAVAILABLE", status: 503 },
    );
  }

  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) {
    syncCacheOwner(null);
    throw Object.assign(
      new Error("Sign in with Supabase to view or edit candidates."),
      { code: "UNAUTHORIZED", status: 401 },
    );
  }

  const accessToken = String(data.session.access_token).trim();
  if (!accessToken) {
    throw Object.assign(
      new Error("Sign in with Supabase to view or edit candidates."),
      { code: "UNAUTHORIZED", status: 401 },
    );
  }

  if (isPrivilegedSupabaseCredential(accessToken)) {
    throw Object.assign(
      new Error("Service role or secret Supabase credentials are forbidden."),
      { code: "FORBIDDEN", status: 403 },
    );
  }

  const sessionUserId = data.session?.user?.id;
  if (sessionUserId !== undefined) {
    const parsedUserId = SupabaseUserIdSchema.safeParse(sessionUserId);
    if (!parsedUserId.success) {
      throw Object.assign(
        new Error("Candidate routes require a Supabase Auth UUID session, not a Better Auth ID."),
        { code: "UNAUTHORIZED", status: 401 },
      );
    }
  }

  const jwtPayload = decodeJwtPayload(accessToken);
  if (jwtPayload?.sub !== undefined) {
    const parsedSub = SupabaseUserIdSchema.safeParse(jwtPayload.sub);
    if (!parsedSub.success) {
      throw Object.assign(
        new Error("Bearer token subject must be a Supabase Auth UUID."),
        { code: "UNAUTHORIZED", status: 401 },
      );
    }
  }

  const ownerId = sessionUserId || jwtPayload?.sub || null;
  if (ownerId) syncCacheOwner(ownerId);
  return accessToken;
}

function cleanFieldValue(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed || UI_PLACEHOLDER_VALUES.has(trimmed)) return null;
  return trimmed;
}

export function readCandidateFieldValue(source, fieldKey) {
  if (!source || typeof source !== "object") return null;
  if (Object.hasOwn(source, fieldKey)) {
    return cleanFieldValue(source[fieldKey]);
  }
  const fallbackKey = UI_FALLBACK_KEYS[fieldKey];
  if (fallbackKey && Object.hasOwn(source, fallbackKey)) {
    return cleanFieldValue(source[fallbackKey]);
  }
  return null;
}

export function describeCandidateProvenance(candidateOrRecord, { mode = "edit" } = {}) {
  if (mode === "create") {
    return Object.freeze({
      mode: "create",
      id: null,
      isManual: true,
      candidateSource: "manual",
      trackerSource: null,
      trackerRow: null,
      editedAt: null,
      hasOverlay: false,
      badgeLabel: "Manual record",
      sourceLabel: SOURCE_LABELS.manual,
      description: "Creates a manual candidate record in public.candidates_manual.",
      editableFields: MANUAL_CANDIDATE_EDITABLE_FIELDS,
    });
  }

  const rawId = candidateOrRecord?.id ?? "";
  const parsedKey = parseCandidateSourceKey(String(rawId));
  if (!parsedKey) {
    return Object.freeze({
      mode: "edit",
      id: String(rawId || ""),
      isManual: false,
      candidateSource: null,
      trackerSource: null,
      trackerRow: null,
      editedAt: null,
      hasOverlay: false,
      badgeLabel: "Unverified source key",
      sourceLabel: "Unverified source",
      description: "Candidate ID must be a valid candidate_source:candidate_source_id key.",
      editableFields: MANUAL_CANDIDATE_EDITABLE_FIELDS,
      invalidKey: true,
    });
  }

  if (parsedKey.is_manual) {
    const editedAt = candidateOrRecord?.edited_at ?? candidateOrRecord?.editedAt ?? null;
    return Object.freeze({
      mode: "edit",
      id: parsedKey.id,
      isManual: true,
      candidateSource: "manual",
      trackerSource: null,
      trackerRow: null,
      editedAt,
      hasOverlay: false,
      badgeLabel: "Manual record",
      sourceLabel: SOURCE_LABELS.manual,
      description: "Updates your manual candidate record directly. Clearing an optional field saves null.",
      editableFields: MANUAL_CANDIDATE_EDITABLE_FIELDS,
    });
  }

  const rawRow = candidateOrRecord?.tracker_row ?? candidateOrRecord?.trackerRow ?? null;
  const trackerRow = Number.isInteger(Number(rawRow)) && Number(rawRow) > 0 ? Number(rawRow) : null;
  const editedAt = candidateOrRecord?.edited_at ?? candidateOrRecord?.editedAt ?? null;
  const sourceLabel = SOURCE_LABELS[parsedKey.candidate_source] || "Tracker import";

  return Object.freeze({
    mode: "edit",
    id: parsedKey.id,
    isManual: false,
    candidateSource: parsedKey.candidate_source,
    trackerSource: parsedKey.tracker_source,
    trackerRow,
    editedAt,
    hasOverlay: Boolean(editedAt),
    badgeLabel: editedAt ? "Imported overlay (edited)" : `${sourceLabel} (imported)`,
    sourceLabel,
    description: `Saves an owner overlay on ${parsedKey.tracker_source}${trackerRow ? ` row #${trackerRow}` : ""} without modifying the imported Tracker table. Clearing a field writes null over the imported value.`,
    editableFields: TRACKER_CANDIDATE_OVERLAY_FIELDS,
  });
}

export function createInitialCandidateFormValues(candidateOrRecord = null, { mode = "create" } = {}) {
  const provenance = describeCandidateProvenance(candidateOrRecord, { mode });
  const values = {};
  for (const config of CANDIDATE_FORM_FIELD_CONFIGS) {
    if (provenance.isManual && config.trackerOnly) continue;
    const initial = mode === "create"
      ? (candidateOrRecord ? readCandidateFieldValue(candidateOrRecord, config.key) : null)
      : readCandidateFieldValue(candidateOrRecord, config.key);
    values[config.key] = initial ?? "";
  }
  return values;
}

function assertNoForbiddenWriteKeys(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("Candidate input must be a JSON object."), {
      code: "INVALID_INPUT",
      status: 400,
    });
  }
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_WRITE_KEYS.has(key)) {
      throw Object.assign(new Error(`${key} cannot be set by the client.`), {
        code: "INVALID_INPUT",
        status: 400,
      });
    }
  }
}

function formatZodValidationError(zodError, fallbackMessage) {
  const fieldErrors = {};
  for (const issue of zodError?.issues || []) {
    const field = issue.path?.[issue.path.length - 1];
    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  }
  const firstMessage = zodError?.issues?.[0]?.message || fallbackMessage;
  return Object.assign(new Error(firstMessage), {
    code: "INVALID_INPUT",
    status: 400,
    fieldErrors,
  });
}

export function buildCandidateCreatePayload(input) {
  assertNoForbiddenWriteKeys(input);
  const allowedSet = new Set(MANUAL_CANDIDATE_EDITABLE_FIELDS);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) {
      throw Object.assign(
        new Error(`Unsupported field for manual candidate creation: ${key}`),
        { code: "INVALID_INPUT", status: 400, fieldErrors: { [key]: `Unsupported field: ${key}` } },
      );
    }
  }

  const candidateName = String(input.candidate_name ?? "").trim();
  if (!candidateName) {
    throw Object.assign(new Error("Candidate name is required"), {
      code: "INVALID_INPUT",
      status: 400,
      fieldErrors: { candidate_name: "Candidate name is required" },
    });
  }

  const rawPayload = { candidate_name: candidateName };
  for (const field of MANUAL_CANDIDATE_EDITABLE_FIELDS) {
    if (field === "candidate_name") continue;
    if (!Object.hasOwn(input, field)) continue;
    const rawValue = input[field];
    if (rawValue === undefined) continue;
    if (rawValue === null) {
      rawPayload[field] = null;
      continue;
    }
    const trimmed = String(rawValue).trim();
    if (!trimmed) continue;
    rawPayload[field] = field === "email" ? trimmed.toLowerCase() : trimmed;
  }

  const parsed = CandidateCreateRequestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw formatZodValidationError(parsed.error, "Invalid manual candidate input");
  }
  return parsed.data;
}

export function buildCandidateEditPayload(
  targetIdOrRecord,
  input,
  { baseline = null, clearedFields = [] } = {},
) {
  assertNoForbiddenWriteKeys(input);
  const rawId = typeof targetIdOrRecord === "string" ? targetIdOrRecord : targetIdOrRecord?.id;
  const parsedIdResult = CandidateIdSchema.safeParse(String(rawId || ""));
  if (!parsedIdResult.success) {
    throw Object.assign(
      new Error(parsedIdResult.error.issues?.[0]?.message || "Candidate ID must be a valid candidate_source:candidate_source_id key"),
      { code: "INVALID_CANDIDATE_ID", status: 400 },
    );
  }

  const parsedKey = parseCandidateSourceKey(parsedIdResult.data);
  const allowedFields = parsedKey.is_manual
    ? MANUAL_CANDIDATE_EDITABLE_FIELDS
    : TRACKER_CANDIDATE_OVERLAY_FIELDS;
  const allowedSet = new Set(allowedFields);

  const rawPatch = Object.hasOwn(input, "edits") && input.edits && typeof input.edits === "object" && !Array.isArray(input.edits)
    ? input.edits
    : input;
  assertNoForbiddenWriteKeys(rawPatch);

  if (parsedKey.is_manual && (Object.hasOwn(input, "tracker_source") || Object.hasOwn(input, "tracker_row"))) {
    throw Object.assign(
      new Error("Manual candidates do not accept tracker_source or tracker_row"),
      { code: "INVALID_INPUT", status: 400 },
    );
  }

  for (const key of Object.keys(rawPatch)) {
    if (!allowedSet.has(key)) {
      throw Object.assign(
        new Error(`Unsupported edit field for ${parsedKey.candidate_source} candidate: ${key}`),
        { code: "INVALID_INPUT", status: 400, fieldErrors: { [key]: `Unsupported field: ${key}` } },
      );
    }
  }

  const clearedSet = new Set(clearedFields || []);
  const hasBaseline = Boolean(baseline && typeof baseline === "object");
  const edits = {};

  for (const field of allowedFields) {
    const inPatch = Object.hasOwn(rawPatch, field);
    const isExplicitlyCleared = clearedSet.has(field);
    if (!inPatch && !isExplicitlyCleared) continue;

    const rawValue = rawPatch[field];
    if (rawValue === undefined && !isExplicitlyCleared) continue;

    if (field === "candidate_name") {
      if (rawValue === null || isExplicitlyCleared || !String(rawValue ?? "").trim()) {
        throw Object.assign(new Error("Candidate name is required"), {
          code: "INVALID_INPUT",
          status: 400,
          fieldErrors: { candidate_name: "Candidate name is required" },
        });
      }
      const trimmedName = String(rawValue).trim();
      const baseName = hasBaseline ? readCandidateFieldValue(baseline, "candidate_name") : null;
      if (!hasBaseline || trimmedName !== baseName) {
        edits.candidate_name = trimmedName;
      }
      continue;
    }

    const normalizedValue = rawValue === null || isExplicitlyCleared || !String(rawValue ?? "").trim()
      ? null
      : field === "email"
        ? String(rawValue).trim().toLowerCase()
        : String(rawValue).trim();

    if (hasBaseline) {
      const baseValRaw = readCandidateFieldValue(baseline, field);
      const baseVal = field === "email" && typeof baseValRaw === "string"
        ? baseValRaw.toLowerCase()
        : baseValRaw;
      if (normalizedValue !== baseVal || isExplicitlyCleared || rawValue === null) {
        edits[field] = normalizedValue;
      }
    } else {
      edits[field] = normalizedValue;
    }
  }

  if (Object.keys(edits).length === 0 && hasBaseline && Object.hasOwn(rawPatch, "candidate_name")) {
    const fallbackName = String(rawPatch.candidate_name ?? "").trim();
    if (fallbackName) {
      edits.candidate_name = fallbackName;
    }
  }

  if (parsedKey.is_manual) {
    const validatedManual = ManualCandidateEditsSchema.safeParse(edits);
    if (!validatedManual.success) {
      throw formatZodValidationError(validatedManual.error, "Invalid manual candidate edit fields");
    }
    return validatedManual.data;
  }

  const validatedOverlay = TrackerCandidateEditsSchema.safeParse(edits);
  if (!validatedOverlay.success) {
    throw formatZodValidationError(validatedOverlay.error, "Invalid candidate overlay edit fields");
  }

  const rawRow = input.tracker_row ?? baseline?.tracker_row ?? baseline?.trackerRow ?? null;
  const trackerRow = Number.isInteger(Number(rawRow)) && Number(rawRow) > 0 ? Number(rawRow) : undefined;
  const trackerSource = input.tracker_source ?? CANDIDATE_TO_TRACKER_SOURCE[parsedKey.candidate_source];

  const wrappedRequest = {
    edits: validatedOverlay.data,
    ...(trackerSource ? { tracker_source: trackerSource } : {}),
    ...(trackerRow ? { tracker_row: trackerRow } : {}),
  };

  const parsedRequest = CandidateEditRequestSchema.safeParse(wrappedRequest);
  if (!parsedRequest.success) {
    throw formatZodValidationError(parsedRequest.error, "Invalid candidate overlay edit request");
  }
  return parsedRequest.data;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildGatewayError(response, payload, fallbackMessage) {
  const code = typeof payload?.error?.code === "string"
    ? payload.error.code
    : response.status === 401
      ? "UNAUTHORIZED"
      : response.status === 403
        ? "FORBIDDEN"
        : response.status === 404
          ? "CANDIDATE_NOT_FOUND"
          : response.status === 400
            ? "INVALID_INPUT"
            : "CANDIDATE_STORAGE_FAILED";
  const message = typeof payload?.error?.message === "string" && payload.error.message.trim()
    ? payload.error.message
    : fallbackMessage;
  return Object.assign(new Error(message), {
    code,
    status: response.status || 502,
  });
}

export async function listCandidates(
  query = {},
  { client = supabase, fetchImpl = globalThis.fetch, baseURL = gatewayBaseURL } = {},
) {
  const parsedQuery = CandidateListQuerySchema.safeParse(query || {});
  if (!parsedQuery.success) {
    throw formatZodValidationError(parsedQuery.error, "Invalid candidate list query");
  }

  const accessToken = await getSupabaseCandidateAccessToken({ client });
  const url = new URL("/api/candidates", baseURL);
  if (parsedQuery.data.source) url.searchParams.set("source", parsedQuery.data.source);
  if (parsedQuery.data.q) url.searchParams.set("q", parsedQuery.data.q);
  if (parsedQuery.data.limit) url.searchParams.set("limit", String(parsedQuery.data.limit));
  if (parsedQuery.data.offset) url.searchParams.set("offset", String(parsedQuery.data.offset));

  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw buildGatewayError(response, payload, "Candidates could not be loaded.");
  }

  const parsed = CandidateListResponseSchema.parse(payload);
  return storeCandidateRecordList(parsed.candidates);
}

export async function loadCandidateDirectory(options = {}) {
  const pageSize = 500;
  const records = [];
  for (let offset = 0; offset <= 10_000; offset += pageSize) {
    const page = await listCandidates({ limit: pageSize, offset }, options);
    records.push(...page);
    if (page.length < pageSize) return records;
  }
  throw new Error("Candidate directory exceeds the supported page range");
}

export async function getCandidateById(
  id,
  { client = supabase, fetchImpl = globalThis.fetch, baseURL = gatewayBaseURL } = {},
) {
  const parsedId = CandidateIdSchema.safeParse(String(id || ""));
  if (!parsedId.success) {
    throw Object.assign(
      new Error(parsedId.error.issues?.[0]?.message || "Candidate ID is invalid"),
      { code: "INVALID_CANDIDATE_ID", status: 400 },
    );
  }

  const accessToken = await getSupabaseCandidateAccessToken({ client });
  const url = new URL(`/api/candidates/${encodeURIComponent(parsedId.data)}`, baseURL);
  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw buildGatewayError(response, payload, "Candidate could not be loaded.");
  }

  const parsed = CandidateResponseSchema.parse(payload);
  return storeCandidateRecord(parsed.candidate);
}

export async function createCandidate(
  input,
  { client = supabase, fetchImpl = globalThis.fetch, baseURL = gatewayBaseURL } = {},
) {
  const body = buildCandidateCreatePayload(input);
  const accessToken = await getSupabaseCandidateAccessToken({ client });
  const url = new URL("/api/candidates", baseURL);

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw buildGatewayError(response, payload, "Manual candidate could not be created.");
  }

  const parsed = CandidateResponseSchema.parse(payload);
  return storeCandidateRecord(parsed.candidate);
}

export async function updateCandidate(
  id,
  input,
  {
    baseline = null,
    clearedFields = [],
    client = supabase,
    fetchImpl = globalThis.fetch,
    baseURL = gatewayBaseURL,
  } = {},
) {
  const parsedId = CandidateIdSchema.safeParse(String(id || ""));
  if (!parsedId.success) {
    throw Object.assign(
      new Error(parsedId.error.issues?.[0]?.message || "Candidate ID is invalid"),
      { code: "INVALID_CANDIDATE_ID", status: 400 },
    );
  }

  const body = buildCandidateEditPayload(parsedId.data, input, { baseline, clearedFields });
  const accessToken = await getSupabaseCandidateAccessToken({ client });
  const url = new URL(`/api/candidates/${encodeURIComponent(parsedId.data)}`, baseURL);

  const response = await fetchImpl(url, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw buildGatewayError(response, payload, "Candidate edits could not be saved.");
  }

  const parsed = CandidateResponseSchema.parse(payload);
  return storeCandidateRecord(parsed.candidate);
}

function computeInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function applyCandidateRecordToUiCandidate(candidate, record) {
  if (!record) return candidate;
  const validated = CandidateRecordSchema.parse(record);
  const base = candidate || {};
  const resolvedName = validated.candidate_name || "Unnamed candidate";
  const resolvedTitle = validated.current_title || "Title not recorded";
  const resolvedEmployer = validated.current_company || "Company not recorded";
  const resolvedLocation = validated.location || "";
  const resolvedEmail = validated.email || "";
  const resolvedPhone = validated.phone || "";
  const resolvedProfileUrl = validated.profile_url || "";
  const resolvedNotes = validated.notes || "";
  const fullResumeText = base.fullResumeText || "";
  const resumeStatus = fullResumeText
    ? "resume_on_file"
    : resolvedProfileUrl
      ? "profile_only"
      : "no_resume_data";

  return {
    ...base,
    id: validated.id,
    candidateId: base.candidateId || validated.source_candidate_key || validated.id,
    candidateSource: validated.candidate_source,
    candidateSourceId: validated.candidate_source_id,
    candidate_source: validated.candidate_source,
    tracker_source: validated.tracker_source,
    candidate_source_id: validated.candidate_source_id,
    tracker_row: validated.tracker_row,
    trackerRow: validated.tracker_row,
    is_manual: validated.is_manual,
    isManual: validated.is_manual,
    edited_at: validated.edited_at,
    editedAt: validated.edited_at,
    source_updated_at: validated.source_updated_at,
    source_candidate_key: validated.source_candidate_key,
    candidate_name: validated.candidate_name,
    current_title: validated.current_title,
    current_company: validated.current_company,
    location: resolvedLocation,
    industry: validated.industry,
    shift: validated.shift,
    email: resolvedEmail,
    phone: resolvedPhone,
    compensation_target: validated.compensation_target,
    current_compensation: validated.current_compensation,
    compensation_context: validated.compensation_context,
    notes: validated.notes,
    profile_url: validated.profile_url,
    role_context: validated.role_context,
    client_context: validated.client_context,
    name: resolvedName,
    initials: computeInitials(validated.candidate_name),
    title: resolvedTitle,
    employer: resolvedEmployer,
    profileUrl: resolvedProfileUrl,
    additionalNotes: resolvedNotes,
    compensationTarget: validated.compensation_target || "",
    currentCompensation: validated.current_compensation || "",
    compensationContext: validated.compensation_context || "",
    roleContext: validated.role_context || "",
    clientContext: validated.client_context || "",
    resumeStatus,
    stage: base.stage || (validated.is_manual ? "Manual" : "Needs checking"),
    workHistory: base.workHistory || [],
    education: base.education || [],
    skills: base.skills || [],
    certifications: base.certifications || [],
    profileSummary: base.profileSummary || "",
    fitEvidence: base.fitEvidence || "",
    gaps: base.gaps || "",
    activityTrail: base.activityTrail || [],
    otherContactsCount: base.otherContactsCount || 0,
    alsoFits: base.alsoFits || [],
    submissionHistory: base.submissionHistory || [],
  };
}

export function mapCandidateRecordToUiCandidate(record, existingCandidate = null) {
  return applyCandidateRecordToUiCandidate(existingCandidate || {}, record);
}

export function mergeCandidatesWithDirectory(candidates = [], directoryRecords = []) {
  const recordMap = new Map();
  for (const record of directoryRecords || []) {
    if (record?.id) {
      recordMap.set(record.id, record);
    }
  }

  const seenIds = new Set();
  const merged = (candidates || []).map((candidate) => {
    const id = String(candidate?.id || "");
    seenIds.add(id);
    const matchingRecord = recordMap.get(id) || getCachedCandidateRecord(id);
    return matchingRecord ? applyCandidateRecordToUiCandidate(candidate, matchingRecord) : candidate;
  });

  for (const [id, record] of recordMap.entries()) {
    if (!seenIds.has(id)) {
      seenIds.add(id);
      merged.push(mapCandidateRecordToUiCandidate(record));
    }
  }

  return merged;
}
