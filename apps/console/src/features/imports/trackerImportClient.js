import { gatewayBaseURL } from "../../auth-client.js";
import { supabase } from "../../supabase-client.js";

export const TRACKER_IMPORT_TYPES = Object.freeze([
  { value: "candidates", label: "Candidates" },
  { value: "jobs", label: "Jobs" },
  { value: "sourcing", label: "Sourcing" },
  { value: "submissions", label: "Submissions" },
  { value: "fits", label: "Fit records" },
]);

export const TRACKER_IMPORT_FIELDS = Object.freeze({
  candidates: ["candidate_name", "current_title", "location", "industry", "shift", "email", "phone", "compensation_target", "current_compensation", "current_company", "submitted_on", "submitted_to", "notes"],
  jobs: ["job_id", "job_title", "company", "client_contact", "location", "compensation", "date_opened", "owners", "status", "job_description", "loxo_link"],
  sourcing: ["role", "candidate_name", "current_company", "current_title", "profile_url", "evidence_url", "found_at", "review_status", "fit_evidence", "gaps", "candidate_key", "business_email", "personal_email", "mobile_number", "work_number", "other_phone", "source_tab_range", "source_group", "source_notes", "next_check", "email", "phone"],
  submissions: ["submission_date", "recruiter", "candidate_name", "current_title", "current_company", "licenses_certifications", "location", "industry", "target_current_compensation", "reason_for_leaving", "profile_summary", "additional_notes", "submission_type", "role_submitted_for", "client_submitted_to", "activity_status", "submission_link", "gmail_message_id", "gmail_thread_id", "candidate_key", "source_verified_date"],
  fits: ["person_id", "fit_job_id", "fit_label", "tracker_sheet", "date_added", "added_by", "notes", "matched_resume_lines"],
});

const TRACKER_FIELD_LABELS = Object.freeze({
  candidate_name: "Candidate name", current_title: "Current title", location: "Location", industry: "Industry", shift: "Shift", email: "Email", phone: "Phone", compensation_target: "Compensation target", current_compensation: "Current compensation", current_company: "Current company", submitted_on: "Submitted on", submitted_to: "Submitted to", notes: "Notes",
  job_id: "Loxo job ID", job_title: "Job title", company: "Company", client_contact: "Client contact", compensation: "Compensation", date_opened: "Date opened", owners: "Owners", status: "Status", job_description: "Job description", loxo_link: "Loxo link",
  role: "Role", profile_url: "Profile link", evidence_url: "Evidence link", found_at: "Found on", review_status: "Review status", fit_evidence: "Fit evidence", gaps: "Gaps", candidate_key: "Candidate key", business_email: "Business email", personal_email: "Personal email", mobile_number: "Mobile number", work_number: "Work number", other_phone: "Other phone", source_tab_range: "Source tab and range", source_group: "Source group", source_notes: "Source notes", next_check: "Next check",
  submission_date: "Submission date", recruiter: "Recruiter", licenses_certifications: "Licences and certifications", target_current_compensation: "Target and current compensation", reason_for_leaving: "Reason for leaving", profile_summary: "Profile summary", additional_notes: "Additional notes", submission_type: "Submission type", role_submitted_for: "Role submitted for", client_submitted_to: "Client submitted to", activity_status: "Activity status", submission_link: "Submission link", gmail_message_id: "Gmail message ID", gmail_thread_id: "Gmail thread ID", source_verified_date: "Source verified date",
  person_id: "Loxo person ID", fit_job_id: "Loxo job ID", fit_label: "Fit label", tracker_sheet: "Source sheet", tracker_row: "Source row", date_added: "Date added", added_by: "Added by", matched_resume_lines: "Matched résumé lines",
});

export function trackerImportFieldLabel(field) {
  return TRACKER_FIELD_LABELS[field] || field.replaceAll("_", " ");
}

export function paginateImportPreviewRows(rows = [], page = 1, pageSize = 50) {
  const count = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), count);
  const start = (currentPage - 1) * pageSize;
  return { page: currentPage, pageCount: count, start, total: rows.length, rows: rows.slice(start, start + pageSize) };
}

export function buildTrackerImportChoices(rows, selectedKeys, reviewedIdentityKeys = new Set()) {
  const selected = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys || []);
  const reviewed = reviewedIdentityKeys instanceof Set ? reviewedIdentityKeys : new Set(reviewedIdentityKeys || []);
  return (Array.isArray(rows) ? rows : []).filter((row) => selected.has(row?.sourceRowKey)
    && !row?.problems?.length
    && typeof row?.sourceRowKey === "string"
    && (row.requiresIdentityReview !== true || reviewed.has(row.sourceRowKey))
    && !(row.suggestedAction === "update" && !Number.isSafeInteger(Number(row?.existingMapping?.canonicalId)))
  ).map((row) => {
    const action = ["insert", "update", "unchanged"].includes(row.suggestedAction)
      ? row.suggestedAction
      : row.existingMapping
        ? row.existingMapping.sourceFingerprint === row.fingerprint ? "unchanged" : "update"
        : "insert";
    return {
      sourceRowKey: row.sourceRowKey,
      action,
      ...(action === "update" ? { canonicalId: Number(row.existingMapping.canonicalId) } : {}),
      ...(row.requiresIdentityReview === true ? { reviewedIdentity: true } : {}),
    };
  });
}

export function suggestHeaderMapping(headers, type) {
  const fields = TRACKER_IMPORT_FIELDS[type] || [];
  const used = new Set();
  return headers.map((header) => {
    const normalized = String(header || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const aliases = {
      candidate_name: ["name", "candidate"],
      job_title: ["title", "role"],
      job_id: ["loxo_job_id"],
      current_title: ["title"],
      candidate_key: ["candidate_id", "source_id"],
      person_id: ["loxo_person_id"],
      fit_job_id: ["loxo_job_id"],
      profile_url: ["profile_link", "linkedin_url", "linkedin"],
      evidence_url: ["evidence_link"],
    };
    const candidateFields = [normalized, ...Object.entries(aliases).flatMap(([field, names]) => names.includes(normalized) ? [field] : [])];
    const field = candidateFields.find((candidate) => fields.includes(candidate) && !used.has(candidate));
    if (!field) return "";
    used.add(field);
    return field;
  });
}

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_COLUMNS = 100;
export const MAX_IMPORT_CELL_LENGTH = 10_000;
export const MAX_IMPORT_REQUEST_BYTES = 10 * 1024 * 1024;


export class TrackerImportError extends Error {
  constructor(message, { status = 0, code = "IMPORT_UNAVAILABLE" } = {}) {
    super(message);
    this.name = "TrackerImportError";
    this.status = status;
    this.code = code;
  }
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value);
}

export function validateImportGrid(grid) {
  if (!Array.isArray(grid) || grid.length < 1) {
    throw new TrackerImportError("The file has no rows to import.", { code: "INVALID_FILE" });
  }

  const rows = grid.map((row) => (Array.isArray(row) ? row.map(cellText) : []));
  const headers = rows[0];
  if (headers.length > MAX_IMPORT_COLUMNS) {
    throw new TrackerImportError(`The file has more than ${MAX_IMPORT_COLUMNS} columns.`, { code: "LIMIT_EXCEEDED" });
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    throw new TrackerImportError(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString()} records.`, { code: "LIMIT_EXCEEDED" });
  }
  for (const row of rows) {
    if (row.length > MAX_IMPORT_COLUMNS) {
      throw new TrackerImportError(`The file has more than ${MAX_IMPORT_COLUMNS} columns.`, { code: "LIMIT_EXCEEDED" });
    }
    if (row.some((cell) => cell.length > MAX_IMPORT_CELL_LENGTH)) {
      throw new TrackerImportError(`A cell is longer than ${MAX_IMPORT_CELL_LENGTH.toLocaleString()} characters.`, { code: "LIMIT_EXCEEDED" });
    }
  }
  if (!headers.some((header) => header.trim())) {
    throw new TrackerImportError("The first row must contain column headings.", { code: "INVALID_FILE" });
  }
  const dataRows = rows.slice(1);
  if (!dataRows.length) {
    throw new TrackerImportError("The file has column headings but no records.", { code: "INVALID_FILE" });
  }
  return { headers, rows: dataRows };
}

export function parseCsvText(input) {
  if (typeof input !== "string") throw new TrackerImportError("Choose a CSV or XLSX file.", { code: "INVALID_FILE" });
  const grid = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell);
      grid.push(row);
      row = [];
      cell = "";
      if (grid.length > MAX_IMPORT_ROWS + 1) {
        throw new TrackerImportError(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString()} records.`, { code: "LIMIT_EXCEEDED" });
      }
    } else {
      cell += char;
    }
    if (cell.length > MAX_IMPORT_CELL_LENGTH) {
      throw new TrackerImportError(`A cell is longer than ${MAX_IMPORT_CELL_LENGTH.toLocaleString()} characters.`, { code: "LIMIT_EXCEEDED" });
    }
    if (row.length > MAX_IMPORT_COLUMNS) {
      throw new TrackerImportError(`The file has more than ${MAX_IMPORT_COLUMNS} columns.`, { code: "LIMIT_EXCEEDED" });
    }
  }

  if (quoted) throw new TrackerImportError("The CSV has an open quote. Check the file and try again.", { code: "INVALID_FILE" });
  if (cell.length || row.length || input.endsWith(",")) {
    row.push(cell);
    grid.push(row);
  }
  while (grid.length && grid.at(-1).every((value) => !String(value).trim())) grid.pop();
  return validateImportGrid(grid);
}

export async function parseImportFile(file, selectedSheet = "") {
  if (!file) throw new TrackerImportError("Choose a CSV or XLSX file.", { code: "INVALID_FILE" });
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new TrackerImportError("The file is larger than 10 MB. Choose a smaller file or split it into parts.", { code: "LIMIT_EXCEEDED" });
  }

  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "csv") return { ...parseCsvText(await file.text()), sheet: "" };
  if (extension !== "xlsx") throw new TrackerImportError("Choose a .csv or .xlsx file. Older .xls files aren't supported.", { code: "INVALID_FILE" });

  try {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    if (!sheets.length) throw new TrackerImportError("The workbook has no sheets.", { code: "INVALID_FILE" });
    const sheetName = selectedSheet || sheets[0].sheet;
    const sheet = sheets.find((candidate) => candidate.sheet === sheetName);
    if (!sheet) throw new TrackerImportError("Choose a sheet from this workbook.", { code: "INVALID_SHEET" });
    return { ...validateImportGrid(sheet.data), sheet: sheet.sheet, sheetNames: sheets.map((candidate) => candidate.sheet) };
  } catch (error) {
    if (error instanceof TrackerImportError) throw error;
    throw new TrackerImportError("The workbook couldn't be read. Check that it is a valid .xlsx file.", { code: "INVALID_FILE" });
  }
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createFileSourceKey() {
  return `upload:${uuid()}`;
}

function errorForResponse(response, payload) {
  const code = payload?.error?.code || "IMPORT_UNAVAILABLE";
  const messages = {
    INVALID_INPUT: "Some import values aren't valid. Review the preview and correct the source file.",
    UNAUTHORIZED: "Sign in again before importing data.",
    FORBIDDEN: "This account can't import data.",
    IMPORT_CONFLICT: "The source changed since the preview. Refresh it and review the rows again.",
    IMPORT_FAILED: "The import couldn't be completed. Retry after reviewing the preview.",
  };
  if (response.status === 413) {
    return new TrackerImportError("This source is too large for one preview. Narrow the sheet range or split the file.", { status: 413, code: "LIMIT_EXCEEDED" });
  }
  return new TrackerImportError(messages[code] || "The import service couldn't be reached. Try again.", { status: response.status, code });
}

async function readResponse(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw errorForResponse(response, payload);
  if (!payload || typeof payload !== "object") throw new TrackerImportError("The import service returned an unreadable response.");
  return payload;
}

async function callerHeaders(client, { includeApiKey = true } = {}) {
  let sessionResult;
  try {
    sessionResult = await client.auth.getSession();
  } catch {
    throw new TrackerImportError("Sign in again before importing data.", { status: 401, code: "UNAUTHORIZED" });
  }
  const token = sessionResult?.data?.session?.access_token;
  if (sessionResult?.error || !token) {
    throw new TrackerImportError("Sign in again before importing data.", { status: 401, code: "UNAUTHORIZED" });
  }
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(includeApiKey && client.supabaseKey ? { apikey: client.supabaseKey } : {}),
  };
  return headers;
}

async function importRequest(path, { method = "GET", body, client = supabase, fetchImpl = globalThis.fetch } = {}) {
  const headers = await callerHeaders(client);
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  if (requestBody && new TextEncoder().encode(requestBody).byteLength > MAX_IMPORT_REQUEST_BYTES) {
    throw new TrackerImportError("This preview is too large to send at once. Narrow the sheet range or split the file.", { status: 413, code: "LIMIT_EXCEEDED" });
  }
  let response;
  try {
    response = await fetchImpl(new URL(path, gatewayBaseURL), {
      method,
      credentials: "include",
      cache: "no-store",
      headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(requestBody ? { body: requestBody } : {}),
    });
  } catch {
    throw new TrackerImportError("Workbench couldn't be reached. Check your connection and try again.");
  }
  return readResponse(response);
}

export function parseSpreadsheetId(input) {
  const value = String(input || "").trim();
  const match = value.match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/i);
  const spreadsheetId = match?.[1] || value;
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(spreadsheetId)) {
    throw new TrackerImportError("Paste a valid Google Sheets link or spreadsheet ID.", { code: "INVALID_SOURCE" });
  }
  return spreadsheetId;
}

export async function getSpreadsheetMetadata(spreadsheetIdInput, options = {}) {
  const spreadsheetId = parseSpreadsheetId(spreadsheetIdInput);
  const client = options.client || supabase;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const headers = await callerHeaders(client, { includeApiKey: false });
  let response;
  try {
    const url = new URL("/api/tracker-imports/sheets/metadata", gatewayBaseURL);
    url.searchParams.set("spreadsheetId", spreadsheetId);
    response = await fetchImpl(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers,
    });
  } catch {
    throw new TrackerImportError("Google Sheets couldn't be reached. Check your connection and try again.");
  }
  const payload = await readResponse(response);
  if (typeof payload.title !== "string" || !Array.isArray(payload.sheets)) {
    throw new TrackerImportError("Spreadsheet tabs couldn't be read. Refresh and try again.");
  }
  return payload;
}

export async function previewTrackerImport(input, options = {}) {
  return importRequest("/api/tracker-imports/preview", { ...options, method: "POST", body: input });
}

export async function confirmTrackerImport(importId, rows, options = {}) {
  return importRequest(`/api/tracker-imports/${encodeURIComponent(importId)}/confirm`, {
    ...options,
    method: "POST",
    body: { rows, confirm: true },
  });
}

export async function listTrackerImports(options = {}) {
  const payload = await importRequest("/api/tracker-imports", options);
  if (!Array.isArray(payload.items)) throw new TrackerImportError("Import history couldn't be read. Try refreshing it.");
  return payload.items;
}
