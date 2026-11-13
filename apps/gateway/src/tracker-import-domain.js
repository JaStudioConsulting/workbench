const TABLES = Object.freeze({
  candidates: { table: "tracker_candidates", required: ["candidate_name"], fields: ["candidate_name", "current_title", "location", "industry", "shift", "email", "phone", "compensation_target", "current_compensation", "current_company", "submitted_on", "submitted_to", "notes"] },
  jobs: { table: "tracker_jobs", required: ["job_title", "job_id"], fields: ["job_id", "job_title", "company", "client_contact", "location", "compensation", "date_opened", "owners", "status", "job_description", "loxo_link"] },
  sourcing: { table: "tracker_sourcing", required: [], fields: ["role", "candidate_name", "current_company", "current_title", "profile_url", "evidence_url", "found_at", "review_status", "fit_evidence", "gaps", "candidate_key", "business_email", "personal_email", "mobile_number", "work_number", "other_phone", "source_tab_range", "source_group", "source_notes", "next_check", "email", "phone"] },
  submissions: { table: "tracker_submissions", required: ["candidate_name"], fields: ["submission_date", "recruiter", "candidate_name", "current_title", "current_company", "licenses_certifications", "location", "industry", "target_current_compensation", "reason_for_leaving", "profile_summary", "additional_notes", "submission_type", "role_submitted_for", "client_submitted_to", "activity_status", "submission_link", "gmail_message_id", "gmail_thread_id", "candidate_key", "source_verified_date"] },
  fits: { table: "tracker_fits", required: ["person_id", "fit_label", "tracker_sheet", "tracker_row"], fields: ["person_id", "fit_job_id", "fit_label", "tracker_sheet", "date_added", "added_by", "notes", "matched_resume_lines"] },
});

const HEADER_ALIASES = Object.freeze({
  candidate_name: ["candidate name", "name", "candidate"], current_title: ["current title", "title"], current_company: ["current company", "company"], job_title: ["job title", "title", "role"], job_id: ["job id", "loxo job id"], candidate_key: ["candidate key", "source id", "candidate id"],
});
const normalizeHeader = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export function trackerImportTypes() { return Object.keys(TABLES); }

export function mapTrackerHeaders(headers, type, explicitMapping) {
  const schema = TABLES[type];
  if (!schema) throw new TypeError("Unsupported Tracker type");
  if (explicitMapping !== undefined) {
    if (!explicitMapping || typeof explicitMapping !== "object" || Array.isArray(explicitMapping)) throw new TypeError("Header mapping must be an object");
    const mapping = {};
    for (const [field, index] of Object.entries(explicitMapping)) {
      if (!schema.fields.includes(field) || !Number.isInteger(index) || index < 0 || index >= headers.length) throw new TypeError("Header mapping contains an unsupported field or column");
      if (Object.values(mapping).includes(index)) throw new TypeError("A source column can map to only one field");
      mapping[field] = index;
    }
    return Object.freeze(mapping);
  }
  const names = headers.map((header) => normalizeHeader(header));
  const mapping = {};
  for (const field of schema.fields) {
    const accepted = new Set([field, ...(HEADER_ALIASES[field] || []).map(normalizeHeader)]);
    const matches = names.flatMap((name, index) => accepted.has(name) ? [index] : []);
    if (matches.length === 1) mapping[field] = matches[0];
  }
  return Object.freeze(mapping);
}

export function previewTrackerRows({ type, headers, rows, sourceKey, explicitIdentityField, headerMapping } = {}) {
  const schema = TABLES[type];
  if (!schema) throw new TypeError("Unsupported Tracker type");
  if (typeof sourceKey !== "string" || !sourceKey.trim()) throw new TypeError("A stable source key is required");
  if (rows?.length > 10000 || headers?.length > 100) throw new RangeError("Tracker preview exceeds supported row or column limits");
  const mapping = mapTrackerHeaders(headers, type, headerMapping);
  if (explicitIdentityField && (!schema.fields.includes(explicitIdentityField) || !Object.hasOwn(mapping, explicitIdentityField))) {
    throw new TypeError("Selected identity field is not mapped");
  }
  const duplicateFieldHeaders = Object.entries(mapping).filter(([, index]) => Object.values(mapping).filter((candidate) => candidate === index).length > 1).map(([field]) => field);
  const items = (Array.isArray(rows) ? rows : []).map((cells, index) => {
    const values = {};
    for (const [field, column] of Object.entries(mapping)) values[field] = String(cells?.[column] ?? "").trim() || null;
    const rowNumber = index + 2;
    if (type === "fits") {
      values.tracker_row = rowNumber;
      values.tracker_sheet = values.tracker_sheet || sourceKey;
      values.matched_resume_lines = values.matched_resume_lines ? (() => { try { return JSON.parse(values.matched_resume_lines); } catch { return values.matched_resume_lines; } })() : [];
    }
    const problems = [];
    for (const field of schema.required) {
      if (!Object.hasOwn(mapping, field)) problems.push(`Map required field: ${field}`);
      else if (!values[field]) problems.push(`Missing required value: ${field}`);
    }
    if (duplicateFieldHeaders.length) problems.push("Resolve ambiguous duplicate header mapping");
    if (type === "fits" && values.fit_job_id && !/^\d+$/.test(values.fit_job_id)) problems.push("fit_job_id must be an exact numeric Loxo ID");
    if (type === "fits" && typeof values.matched_resume_lines === "string") problems.push("matched_resume_lines must be a JSON array");
    if (type === "fits" && !/^\d+$/.test(values.person_id || "")) problems.push("person_id must be an exact numeric Loxo ID");
    if (type === "jobs" && !/^\d+$/.test(values.job_id || "")) problems.push("job_id must be an exact stable numeric job ID");
    const stableId = explicitIdentityField && values[explicitIdentityField] ? `${explicitIdentityField}:${values[explicitIdentityField]}` : `row:${rowNumber}`;
    return Object.freeze({ sourceRow: rowNumber, sourceRowKey: `${sourceKey}:${stableId}`, values: Object.freeze(values), problems: Object.freeze(problems), blocked: problems.length > 0, identityBasis: explicitIdentityField && values[explicitIdentityField] ? "explicit_field" : "row_position_requires_reconciliation" });
  });
  const counts = new Map();
  for (const row of items) counts.set(row.sourceRowKey, (counts.get(row.sourceRowKey) || 0) + 1);
  const jobIds = new Map();
  if (type === "jobs") for (const row of items) {
    const id = row.values.job_id;
    if (id) jobIds.set(id, (jobIds.get(id) || 0) + 1);
  }
  const finalRows = items.map((row) => counts.get(row.sourceRowKey) > 1
    ? Object.freeze({ ...row, problems: Object.freeze([...row.problems, "Duplicate stable source identity in import"]), blocked: true })
    : type === "jobs" && jobIds.get(row.values.job_id) > 1
      ? Object.freeze({ ...row, problems: Object.freeze([...row.problems, "Duplicate job_id in import"]), blocked: true })
      : row);
  const rowsWithIdentityState = finalRows.map((row) => row.identityBasis === "row_position_requires_reconciliation"
    ? Object.freeze({ ...row, blocked: true, requiresIdentityReview: true })
    : row);
  return Object.freeze({ type, table: schema.table, sourceKey, headers: Object.freeze([...headers]), headerMapping: mapping, rows: Object.freeze(rowsWithIdentityState), blockedCount: rowsWithIdentityState.filter((row) => row.blocked).length });
}

export function parseCsvText(input, { maxRows = 10000, maxColumns = 100, maxCellLength = 10000 } = {}) {
  if (typeof input !== "string") throw new TypeError("CSV input must be text");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
      if (rows.length > maxRows) throw new RangeError("CSV row limit exceeded");
    } else cell += char;
    if (cell.length > maxCellLength) throw new RangeError("CSV cell length limit exceeded");
    if (row.length > maxColumns) throw new RangeError("CSV column limit exceeded");
  }
  if (quoted) throw new SyntaxError("Malformed CSV: unclosed quoted field");
  if (cell.length || row.length || input.endsWith(",")) { row.push(cell); rows.push(row); }
  while (rows.length && rows.at(-1).every((value) => !String(value).trim())) rows.pop();
  if (!rows.length) return Object.freeze({ headers: Object.freeze([]), rows: Object.freeze([]) });
  return Object.freeze({ headers: Object.freeze(rows[0]), rows: Object.freeze(rows.slice(1).map((entry) => Object.freeze(entry))) });
}
