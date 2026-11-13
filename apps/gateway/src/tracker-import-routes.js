import { createHash } from "node:crypto";
import { google } from "googleapis";
import { parseAllowedGoogleEmails } from "./auth.js";
import { previewTrackerRows, trackerImportTypes } from "./tracker-import-domain.js";

const DEFAULT_URL = "https://abnfffkmxqixrwzackjf.supabase.co";
const DEFAULT_KEY = "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const MAX_ROWS = 10000;
const MAX_COLUMNS = 100;
const MAX_CELL = 10000;

function noStore(res) { res.set("Cache-Control", "private, no-store"); return res; }
function error(res, code, message, status) { return noStore(res).status(status).json({ error: { code, message } }); }
function bearer(req) {
  const value = req.get("authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] || null;
}
function privileged(value) {
  if (!value || /^sb_secret_/i.test(value) || /service[_-]?role/i.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try { return ["service_role", "supabase_admin"].includes(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role); }
  catch { return false; }
}
function supabaseConfig(env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_KEY;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) throw new Error();
    if (parsed.username || parsed.password || parsed.search || parsed.hash || privileged(key)) throw new Error();
    return { url: parsed.origin, key };
  } catch { return null; }
}
async function readJson(response) {
  const body = await response.text();
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}
function storageError(response, payload) {
  const pg = payload?.code;
  const text = `${payload?.message || ""} ${payload?.details || ""}`;
  if (response.status === 401) return { status: 401, code: "UNAUTHORIZED", message: "A valid Supabase caller session is required" };
  if (response.status === 403 || pg === "42501") return { status: 403, code: "FORBIDDEN", message: "This import is unavailable to this account" };
  if (["23514", "23503", "23505", "40001"].includes(pg) || /source row|import row|canonical row|already mapped|reconciliation|changed since/i.test(text)) {
    return { status: 409, code: "IMPORT_CONFLICT", message: "The import needs review because its source or mapped record changed" };
  }
  if (response.status === 400 || response.status === 413 || pg === "22023") return { status: 400, code: "INVALID_INPUT", message: "The import preview or confirmation is invalid" };
  return { status: 502, code: "IMPORT_FAILED", message: "Tracker import storage is unavailable" };
}

function normalizeSpreadsheetId(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{20,200}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname !== "docs.google.com") return null;
    const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})(?:\/|$)/.exec(url.pathname);
    return match?.[1] || null;
  } catch { return null; }
}
function cleanSheetTitle(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) return null;
  return value.trim();
}
function cellString(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "").slice(0, MAX_CELL);
}
function md5(value) { return createHash("md5").update(value).digest("hex"); }
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
function typeAllowed(type) { return trackerImportTypes().includes(type); }

export function createSupabaseTrackerImportStore({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = supabaseConfig(env);
  if (!config || typeof fetchImpl !== "function") throw new TypeError("Supabase public client configuration and fetch are required");
  function headers(accessToken, extra = {}) {
    if (!accessToken || privileged(accessToken)) throw Object.assign(new Error("Privileged Supabase tokens are forbidden"), { status: 403 });
    return { apikey: config.key, Authorization: `Bearer ${accessToken}`, Accept: "application/json", ...extra };
  }
  async function request(accessToken, path, { method = "GET", body, prefer } = {}) {
    const response = await fetchImpl(`${config.url}/rest/v1/${path}`, {
      method,
      headers: headers(accessToken, {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(prefer ? { Prefer: prefer } : {}),
      }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await readJson(response);
    if (!response.ok) throw Object.assign(new Error("Tracker import storage request failed"), storageError(response, payload));
    return payload;
  }
  return Object.freeze({
    async verifyUser(accessToken) {
      const response = await fetchImpl(`${config.url}/auth/v1/user`, { headers: headers(accessToken) });
      const payload = await readJson(response);
      if (!response.ok || !payload?.id) throw Object.assign(new Error("Supabase caller session is invalid"), { status: 401, code: "UNAUTHORIZED" });
      if (payload.role === "service_role" || payload.role === "supabase_admin") throw Object.assign(new Error("Privileged Supabase tokens are forbidden"), { status: 403, code: "FORBIDDEN" });
      return Object.freeze({ id: String(payload.id), email: String(payload.email || "").trim().toLowerCase() });
    },
    request,
  });
}

export function createTrackerImportHandlers({ env = process.env, auth, store, fetchImpl = globalThis.fetch, sheetsClientFactory } = {}) {
  let supabase = store;
  if (!supabase) {
    try { supabase = createSupabaseTrackerImportStore({ env, fetchImpl }); }
    catch {
      const unavailable = () => { throw Object.assign(new Error("Tracker import storage is unavailable"), { status: 503, code: "SUPABASE_UNAVAILABLE" }); };
      supabase = Object.freeze({ verifyUser: unavailable, request: unavailable });
    }
  }
  const approvedEmail = typeof auth?.isApprovedEmail === "function" ? auth.isApprovedEmail.bind(auth) : null;
  const allowedEmails = parseAllowedGoogleEmails(env.AUTH_ALLOWED_GOOGLE_EMAILS);
  const isApprovedEmail = approvedEmail || (allowedEmails ? (email) => allowedEmails.includes(email) : null);
  const createSheetsClient = sheetsClientFactory ?? (async (accessToken) => {
    const client = new google.auth.OAuth2();
    client.setCredentials({ access_token: accessToken });
    return google.sheets({ version: "v4", auth: client });
  });

  async function caller(req, { requireGoogle = false } = {}) {
    const token = bearer(req);
    if (!token) throw Object.assign(new Error("Supabase caller session is required"), { status: 401, code: "UNAUTHORIZED" });
    const user = await supabase.verifyUser(token);
    if (!user.email || (isApprovedEmail && !isApprovedEmail(user.email))) throw Object.assign(new Error("This account is not approved for Tracker imports"), { status: 403, code: "FORBIDDEN" });
    if (requireGoogle) {
      const appEmail = String(req.workbenchSession?.user?.email || "").trim().toLowerCase();
      if (!appEmail || appEmail !== user.email) throw Object.assign(new Error("Google and Supabase sessions must belong to the same approved account"), { status: 403, code: "FORBIDDEN" });
    }
    return { token, user };
  }
  async function googleSheets(req) {
    if (typeof auth?.getGoogleProviderAccessToken !== "function") throw Object.assign(new Error("Connected Google Sheets access is unavailable"), { status: 409, code: "GOOGLE_ACCOUNT_NOT_CONNECTED" });
    const tokenResult = await auth.getGoogleProviderAccessToken(req);
    const accessToken = tokenResult?.accessToken || tokenResult?.access_token;
    if (!accessToken) throw Object.assign(new Error("Connected Google Sheets access is unavailable"), { status: 409, code: "GOOGLE_ACCOUNT_NOT_CONNECTED" });
    if (!Array.isArray(tokenResult?.scopes) || !tokenResult.scopes.includes(SHEETS_SCOPE)) throw Object.assign(new Error("Read-only Sheets scope is not granted"), { status: 403, code: "GOOGLE_SCOPE_REQUIRED" });
    const client = await createSheetsClient(accessToken);
    return client;
  }
  async function sheetMetadata(req, spreadsheetId) {
    const sheets = await googleSheets(req);
    const response = await sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))" });
    return {
      spreadsheetId: response.data.spreadsheetId,
      title: response.data.properties?.title || "Google Sheet",
      sheets: (response.data.sheets || []).map((sheet) => ({ sheetId: sheet.properties.sheetId, title: sheet.properties.title, rowCount: sheet.properties.gridProperties?.rowCount || null, columnCount: sheet.properties.gridProperties?.columnCount || null })),
    };
  }
  async function readSheetRows(req, spreadsheetId, sheetTitle) {
    const sheets = await googleSheets(req);
    const escaped = sheetTitle.replaceAll("'", "''");
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${escaped}'!A1:ZZ${MAX_ROWS + 2}`, valueRenderOption: "FORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
    const values = response.data.values || [];
    if (values.length > MAX_ROWS + 1) throw Object.assign(new Error("Sheet exceeds the 10,000-row preview limit"), { status: 400, code: "INVALID_INPUT" });
    if (values.some((row) => row.length > MAX_COLUMNS)) throw Object.assign(new Error("Sheet exceeds the 100-column preview limit"), { status: 400, code: "INVALID_INPUT" });
    return values.map((row) => row.map(cellString));
  }
  async function existingLoxoIds(accessToken, table, ids) {
    const unique = [...new Set(ids.filter((id) => /^\d+$/.test(String(id || ""))).map(String))];
    const found = new Set();
    for (let start = 0; start < unique.length; start += 100) {
      const batch = unique.slice(start, start + 100);
      const query = new URLSearchParams({ select: "id", id: `in.(${batch.join(",")})`, limit: String(batch.length) });
      const rows = await supabase.request(accessToken, `${table}?${query}`);
      for (const row of Array.isArray(rows) ? rows : []) found.add(String(row.id));
    }
    return found;
  }

  async function run(req, res, operation, { requireGoogle = false } = {}) {
    noStore(res);
    try {
      const { token, user } = await caller(req, { requireGoogle });
      return await operation({ token, user });
    } catch (errorValue) {
      const status = errorValue?.status || 502;
      const code = errorValue?.code || "IMPORT_FAILED";
      const message = status === 400 ? "The import request is invalid or exceeds supported limits"
        : status === 401 ? "A valid Supabase caller session is required"
          : status === 403 ? "This import is unavailable to this account"
            : status === 409 ? "The connected Google account or import source needs attention"
              : "Tracker import storage is unavailable";
      return error(res, code, message, status);
    }
  }

  return Object.freeze({
    async metadata(req, res) {
      return run(req, res, async () => {
        const spreadsheetId = normalizeSpreadsheetId(req.query?.spreadsheetId);
        if (!spreadsheetId) return error(res, "INVALID_INPUT", "Enter a valid Google Sheets URL or spreadsheet ID", 400);
        try { return noStore(res).json(await sheetMetadata(req, spreadsheetId)); }
        catch (caught) {
          const status = caught?.status || (caught?.code === "GOOGLE_SCOPE_REQUIRED" ? 403 : 502);
          const code = caught?.code || "GOOGLE_SHEETS_UNAVAILABLE";
          return error(res, code, status === 409 ? "Connect the approved Google account to read Sheets" : status === 403 ? "Read-only Sheets access is not granted" : "Google Sheets metadata is unavailable", status);
        }
      }, { requireGoogle: true });
    },
    async history(req, res) {
      return run(req, res, async ({ token }) => {
        try {
          const params = new URLSearchParams({ select: "id,source_type,source_key,source_label,status,created_at,confirmed_at", order: "created_at.desc", limit: "50" });
          const items = await supabase.request(token, `tracker_imports?${params}`);
          return noStore(res).json({ items: Array.isArray(items) ? items : [] });
        } catch (caught) { return error(res, caught.code || "IMPORT_FAILED", caught.message || "Import history is unavailable", caught.status || 502); }
      });
    },
    async preview(req, res) {
      return run(req, res, async ({ token }) => {
        const body = req.body || {};
        const type = body.type;
        const source = body.source || {};
        if (!typeAllowed(type) || !["sheet", "file"].includes(source.kind) || typeof source.sourceKey !== "string" || source.sourceKey.length > 500 || typeof source.sourceLabel !== "string" || source.sourceLabel.length > 300) {
          return error(res, "INVALID_INPUT", "Import type and source details are required", 400);
        }
        let headers = body.headers;
        let rows = body.rows;
        if (source.kind === "sheet") {
          const spreadsheetId = normalizeSpreadsheetId(source.spreadsheetId);
          const sheetTitle = cleanSheetTitle(source.sheetTitle);
          if (!spreadsheetId || !sheetTitle || !Number.isInteger(source.sheetId)) return error(res, "INVALID_INPUT", "Choose a valid spreadsheet and tab", 400);
          if (source.sourceKey !== `sheet:${spreadsheetId}:${source.sheetId}`) return error(res, "INVALID_INPUT", "Sheet source identity must use the selected spreadsheet and tab", 400);
          const meta = await sheetMetadata(req, spreadsheetId);
          const tab = meta.sheets.find((item) => item.sheetId === source.sheetId && item.title === sheetTitle);
          if (!tab) return error(res, "INVALID_INPUT", "The selected Sheet tab is unavailable", 400);
          const values = await readSheetRows(req, spreadsheetId, sheetTitle);
          headers = values[0] || [];
          rows = values.slice(1);
        } else if (!/^upload:[0-9a-f-]{36}$/i.test(source.sourceKey)) {
          return error(res, "INVALID_INPUT", "Choose or reuse a valid persistent upload source ID", 400);
        }
        if (!Array.isArray(headers) || !Array.isArray(rows) || rows.length > MAX_ROWS || headers.length > MAX_COLUMNS || rows.some((row) => !Array.isArray(row) || row.length > MAX_COLUMNS || row.some((cell) => String(cell ?? "").length > MAX_CELL))) {
          return error(res, "INVALID_INPUT", "Import exceeds supported row, column, or cell limits", 400);
        }
        headers = headers.map(cellString);
        rows = rows.map((row) => row.map(cellString));
        let mapped;
        try { mapped = previewTrackerRows({ type, headers, rows, sourceKey: source.sourceKey, explicitIdentityField: body.identityField, headerMapping: body.headerMapping }); }
        catch (caught) { return error(res, "INVALID_INPUT", caught.message || "Import mapping is invalid", 400); }
        if (mapped.rows.length === 0) return error(res, "INVALID_INPUT", "The selected source has no importable data rows", 400);
        if (type === "fits") {
          const personIds = mapped.rows.map((row) => row.values.person_id).filter(Boolean);
          const jobIds = mapped.rows.map((row) => row.values.fit_job_id).filter(Boolean);
          try {
            const [knownPeople, knownJobs] = await Promise.all([
              existingLoxoIds(token, "loxo_candidates", personIds),
              existingLoxoIds(token, "loxo_jobs", jobIds),
            ]);
            mapped = Object.freeze({ ...mapped, rows: Object.freeze(mapped.rows.map((row) => {
              const problems = [...row.problems];
              if (row.values.person_id && !knownPeople.has(String(row.values.person_id))) problems.push("person_id does not match an existing Loxo candidate");
              if (row.values.fit_job_id && !knownJobs.has(String(row.values.fit_job_id))) problems.push("fit_job_id does not match an existing Loxo job");
              return Object.freeze({ ...row, problems: Object.freeze(problems), blocked: problems.length > 0 || row.blocked });
            })) });
          } catch (caught) { return error(res, caught.code || "IMPORT_FAILED", "Loxo ID validation is unavailable; fit rows were not previewed", caught.status || 502); }
        }
        const previewRows = mapped.rows.map((row) => ({
          sourceType: type,
          sourceRow: row.sourceRow,
          sourceRowKey: row.sourceRowKey,
          fingerprint: md5(stableStringify({ values: row.values, sourceRowKey: row.sourceRowKey })),
          values: row.values,
          problems: row.problems,
          blocked: row.blocked,
          identityBasis: row.identityBasis,
        }));
        try {
          const created = await supabase.request(token, "tracker_imports", { method: "POST", prefer: "return=representation", body: { source_type: type, source_key: source.sourceKey, source_label: source.sourceLabel } });
          const runRecord = Array.isArray(created) ? created[0] : null;
          if (!runRecord?.id) throw new Error("Import run was not created");
          await supabase.request(token, "rpc/save_tracker_import_preview", { method: "POST", body: { p_import_id: runRecord.id, p_rows: previewRows, p_identity_field: body.identityField || null } });
          const keys = previewRows.map((row) => row.sourceRowKey);
          const params = new URLSearchParams({ select: "source_row_key,source_fingerprint,canonical_id,canonical_fingerprint,source_type", source_type: `eq.${type}`, limit: "10000" });
          const mappings = await supabase.request(token, `tracker_import_source_rows?${params}`);
          const byKey = new Map((Array.isArray(mappings) ? mappings : []).filter((mapping) => keys.includes(mapping.source_row_key)).map((mapping) => [mapping.source_row_key, mapping]));
          const responseRows = previewRows.map((row, index) => {
            const mapping = byKey.get(row.sourceRowKey);
            const existingMapping = mapping ? { canonicalId: mapping.canonical_id, sourceFingerprint: mapping.source_fingerprint, canonicalFingerprint: mapping.canonical_fingerprint, canonicalTable: mapped.table } : null;
            const unchanged = mapping?.source_fingerprint === row.fingerprint;
            return { ...row, blocked: mapped.rows[index].blocked, requiresIdentityReview: mapped.rows[index].requiresIdentityReview || false, existingMapping, suggestedAction: unchanged ? "unchanged" : mapping ? "update" : "insert", requiresReview: Boolean(mapping && !unchanged) };
          });
          return res.status(201).json({ importId: runRecord.id, type, sourceKey: source.sourceKey, sourceLabel: source.sourceLabel, rowCount: responseRows.length, blockedCount: mapped.blockedCount, headers, headerMapping: mapped.headerMapping, rows: responseRows });
        } catch (caught) { const mappedError = caught?.status ? caught : { ...storageError({ status: 502 }, null) }; return error(res, mappedError.code || "IMPORT_FAILED", mappedError.message || "Import preview could not be saved", mappedError.status || 502); }
      }, { requireGoogle: req.body?.source?.kind === "sheet" });
    },
    async confirm(req, res) {
      return run(req, res, async ({ token }) => {
        const importId = req.params?.id;
        const rows = req.body?.rows;
        if (!/^[0-9a-f-]{36}$/i.test(importId || "") || !Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS || req.body?.confirm !== true) return error(res, "INVALID_INPUT", "Confirm the reviewed import rows", 400);
        const choices = [];
        for (const row of rows) {
          if (!row || typeof row.sourceRowKey !== "string" || !["insert", "update", "unchanged"].includes(row.action)) return error(res, "INVALID_INPUT", "Import row choices are invalid", 400);
          if (row.action === "update" && !Number.isSafeInteger(Number(row.canonicalId))) return error(res, "INVALID_INPUT", "An exact canonical record is required for update", 400);
          choices.push({ sourceRowKey: row.sourceRowKey, action: row.action, ...(row.canonicalId == null ? {} : { canonicalId: Number(row.canonicalId) }), ...(row.reviewedIdentity === true ? { reviewedIdentity: true } : {}) });
        }
        try {
          const result = await supabase.request(token, "rpc/confirm_tracker_import", { method: "POST", body: { p_import_id: importId, p_rows: choices } });
          const list = Array.isArray(result?.rows) ? result.rows : [];
          return noStore(res).json({ importId, status: result?.status || "confirmed", remainingEligible: Number(result?.remainingEligible || 0), importedCount: Number(result?.importedCount ?? list.filter((row) => row.action === "insert").length), updatedCount: Number(result?.updatedCount ?? list.filter((row) => row.action === "update").length), unchangedCount: Number(result?.unchangedCount ?? list.filter((row) => row.action === "unchanged").length), skippedCount: Number(result?.skippedCount || 0), failedCount: Number(result?.failedCount || 0), rows: list });
        } catch (caught) { return error(res, caught.code || "IMPORT_FAILED", caught.message || "Import confirmation failed", caught.status || 502); }
      });
    },
  });
}

export function registerTrackerImportRoutes(app, options) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") throw new TypeError("Express app is required");
  const handlers = createTrackerImportHandlers(options);
  const authenticated = options?.authenticated;
  const googleAuthenticated = options?.googleAuthenticated;
  const requireGoogleForSheetPreview = (req, res, next) => {
    if (req.body?.source?.kind !== "sheet") return next();
    if (typeof googleAuthenticated !== "function") return error(res, "GOOGLE_ACCOUNT_NOT_CONNECTED", "Connected Google Sheets access is unavailable", 409);
    return googleAuthenticated(req, res, next);
  };
  if (typeof authenticated !== "function") throw new TypeError("Supabase recruiter middleware is required");
  app.get("/api/tracker-imports/sheets/metadata", authenticated, requireGoogle(googleAuthenticated), handlers.metadata);
  app.get("/api/tracker-imports", authenticated, handlers.history);
  app.post("/api/tracker-imports/preview", authenticated, requireGoogleForSheetPreview, handlers.preview);
  app.post("/api/tracker-imports/:id/confirm", authenticated, handlers.confirm);
  return handlers;
}

function requireGoogle(middleware) {
  if (typeof middleware !== "function") {
    return (_req, res) => error(res, "GOOGLE_ACCOUNT_NOT_CONNECTED", "Connected Google Sheets access is unavailable", 409);
  }
  return middleware;
}
