import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CloudDownload, FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.tsx";
import {
  TRACKER_IMPORT_FIELDS,
  TRACKER_IMPORT_TYPES,
  TrackerImportError,
  buildTrackerImportChoices,
  confirmTrackerImport,
  createFileSourceKey,
  getSpreadsheetMetadata,
  listTrackerImports,
  paginateImportPreviewRows,
  parseImportFile,
  previewTrackerImport,
  suggestHeaderMapping,
  trackerImportFieldLabel,
} from "./trackerImportClient.js";

const SKIP_FIELD = "__skip_column__";
const PREVIEW_PAGE_SIZE = 50;
const STABLE_ID_FIELDS = Object.freeze({
  candidates: ["email", "phone"],
  jobs: ["job_id"],
  sourcing: ["candidate_key", "business_email", "personal_email", "profile_url", "email"],
  submissions: ["candidate_key", "gmail_message_id", "gmail_thread_id", "submission_link"],
  fits: [],
});

function mappedFields(mapping) {
  return [...new Set(mapping.filter(Boolean))];
}

function defaultIdentityField(type, mapping) {
  const available = mappedFields(mapping);
  return (STABLE_ID_FIELDS[type] || []).find((field) => available.includes(field)) || "";
}

function headerMapFromColumns(mapping) {
  const result = {};
  mapping.forEach((field, index) => {
    if (field) result[field] = index;
  });
  return result;
}

function columnsFromHeaderMap(headers, headerMapping, type) {
  if (!Array.isArray(headers)) return [];
  const columns = Array(headers.length).fill("");
  for (const [field, rawIndex] of Object.entries(headerMapping || {})) {
    const index = Number(rawIndex);
    if (Number.isInteger(index) && index >= 0 && index < columns.length) columns[index] = field;
  }
  return columns;
}

function actionForRow(row) {
  if (["insert", "update", "unchanged"].includes(row?.suggestedAction)) return row.suggestedAction;
  if (["insert", "update", "unchanged"].includes(row?.action)) return row.action;
  if (row?.existingMapping) {
    return row.existingMapping.sourceFingerprint === row.fingerprint ? "unchanged" : "update";
  }
  return "insert";
}

function isBlocked(row) {
  return Boolean(row?.problems?.length || (row?.blocked && !row?.requiresIdentityReview));
}

function canConfirmRow(row, reviewedIdentityRows = new Set()) {
  const action = actionForRow(row);
  return !row?.problems?.length
    && typeof row?.sourceRowKey === "string"
    && (row?.requiresIdentityReview !== true || reviewedIdentityRows.has(row.sourceRowKey))
    && (action !== "update" || Number.isSafeInteger(Number(row?.existingMapping?.canonicalId)));
}

function displayProblem(problem) {
  const text = String(problem || "");
  const missingMapping = text.match(/^Map required field: (.+)$/i);
  if (missingMapping) return `Choose a column for ${trackerImportFieldLabel(missingMapping[1])}.`;
  const missingValue = text.match(/^Missing required value: (.+)$/i);
  if (missingValue) return `Add a ${trackerImportFieldLabel(missingValue[1]).toLowerCase()}.`;
  if (/duplicate stable source identity/i.test(text)) return "This ID appears more than once. Correct the ID values before importing.";
  if (/ambiguous duplicate header mapping/i.test(text)) return "More than one column maps to the same field. Choose one column for each field.";
  if (/person_id must be an exact numeric Loxo ID/i.test(text)) return "Loxo person ID must be an exact numeric ID.";
  if (/fit_job_id must be an exact numeric Loxo ID/i.test(text)) return "Loxo job ID must be an exact numeric ID.";
  if (/job_id must be an exact stable numeric job ID/i.test(text)) return "Job ID must be an exact numeric Loxo ID.";
  if (/matched_resume_lines must be a JSON array/i.test(text)) return "Matched résumé lines must be a list. Correct this value in the source.";
  return text;
}

function formatDate(value) {
  if (!value) return "Date not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function historyStatus(status) {
  if (status === "confirmed") return "Imported";
  if (status === "preview") return "Previewed";
  if (status === "partial") return "Partially imported";
  if (status === "failed") return "Failed";
  return "In progress";
}

export function ImportDataPanel() {
  const [type, setType] = useState("candidates");
  const [sourceKind, setSourceKind] = useState("sheet");
  const [sheetLink, setSheetLink] = useState("");
  const [sheetMetadata, setSheetMetadata] = useState(null);
  const [sheetId, setSheetId] = useState("");
  const [file, setFile] = useState(null);
  const [fileGrid, setFileGrid] = useState(null);
  const [fileSheets, setFileSheets] = useState([]);
  const [fileSheet, setFileSheet] = useState("");
  const [fileSourceKey, setFileSourceKey] = useState("");
  const [mapping, setMapping] = useState([]);
  const [identityField, setIdentityField] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewFilter, setPreviewFilter] = useState("all");
  const [selectedRows, setSelectedRows] = useState(() => new Set());
  const [reviewedIdentityRows, setReviewedIdentityRows] = useState(() => new Set());
  const [completedRows, setCompletedRows] = useState(() => new Set());
  const [previewDirty, setPreviewDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [history, setHistory] = useState([]);
  const [historyState, setHistoryState] = useState("loading");
  const [historyError, setHistoryError] = useState("");
  const [historyRequest, setHistoryRequest] = useState(0);

  useEffect(() => {
    let active = true;
    setHistoryState("loading");
    setHistoryError("");
    listTrackerImports()
      .then((items) => { if (active) { setHistory(items); setHistoryState("ready"); } })
      .catch((cause) => { if (active) { setHistoryError(cause.message || "Import history couldn't be loaded."); setHistoryState("error"); } });
    return () => { active = false; };
  }, [historyRequest]);

  const sheet = sheetMetadata?.sheets?.find((item) => String(item.sheetId) === sheetId) || null;
  const previousFileSources = useMemo(() => {
    const bySource = new Map();
    for (const item of history) {
      if (item.type === type && String(item.sourceKey || "").startsWith("upload:") && !bySource.has(item.sourceKey)) bySource.set(item.sourceKey, item);
    }
    return [...bySource.values()];
  }, [history, type]);
  const eligibleIdentityFields = useMemo(() => (STABLE_ID_FIELDS[type] || []).filter((field) => mapping.includes(field)), [mapping, type]);
  const mappingDuplicates = useMemo(() => {
    const seen = new Set();
    const duplicates = new Set();
    for (const field of mapping.filter(Boolean)) {
      if (seen.has(field)) duplicates.add(field);
      seen.add(field);
    }
    return [...duplicates];
  }, [mapping]);

  function clearPreview() {
    setPreview(null);
    setPreviewPage(1);
    setPreviewFilter("all");
    setSelectedRows(new Set());
    setReviewedIdentityRows(new Set());
    setCompletedRows(new Set());
    setPreviewDirty(false);
    setConfirmed(false);
    setSuccess("");
  }

  function updateMapping(index, value) {
    setMapping((current) => current.map((field, column) => column === index ? (value === SKIP_FIELD ? "" : value) : field));
    setPreviewDirty(Boolean(preview));
    setSuccess("");
  }

  function updateIdentityField(value) {
    setIdentityField(value === SKIP_FIELD ? "" : value);
    setPreviewDirty(Boolean(preview));
    setReviewedIdentityRows(new Set());
    setSelectedRows(new Set());
    setSuccess("");
  }

  function changeType(value) {
    setType(value);
    clearPreview();
    setFileSourceKey("");
    setIdentityField(defaultIdentityField(value, mapping));
    if (fileGrid) setMapping(suggestHeaderMapping(fileGrid.headers, value));
  }

  async function loadSheetTabs() {
    setBusy("sheets");
    setError("");
    setSuccess("");
    clearPreview();
    try {
      const data = await getSpreadsheetMetadata(sheetLink);
      if (!Array.isArray(data.sheets) || !data.sheets.length) throw new TrackerImportError("No tabs were found in this spreadsheet.", { code: "SHEETS_UNAVAILABLE" });
      setSheetMetadata(data);
      setSheetId(String(data.sheets[0].sheetId));
      setMapping([]);
      setIdentityField("");
    } catch (cause) {
      setSheetMetadata(null);
      setSheetId("");
      setError(cause.message || "Spreadsheet tabs couldn't be loaded.");
    } finally {
      setBusy("");
    }
  }

  async function chooseFile(fileValue) {
    if (!fileValue) return;
    setBusy("file");
    setError("");
    setSuccess("");
    clearPreview();
    try {
      const parsed = await parseImportFile(fileValue);
      setFile(fileValue);
      setFileGrid(parsed);
      setFileSheets(parsed.sheetNames || []);
      setFileSheet(parsed.sheet || "");
      const suggested = suggestHeaderMapping(parsed.headers, type);
      setMapping(suggested);
      setIdentityField(defaultIdentityField(type, suggested));
    } catch (cause) {
      setFile(fileValue);
      setFileGrid(null);
      setFileSheets([]);
      setFileSheet("");
      setMapping([]);
      setError(cause.message || "This file couldn't be read.");
    } finally {
      setBusy("");
    }
  }

  async function chooseFileSheet(value) {
    if (!file) return;
    setBusy("file");
    setError("");
    clearPreview();
    try {
      const parsed = await parseImportFile(file, value);
      setFileGrid(parsed);
      setFileSheet(parsed.sheet || value);
      const suggested = suggestHeaderMapping(parsed.headers, type);
      setMapping(suggested);
      setIdentityField(defaultIdentityField(type, suggested));
    } catch (cause) {
      setError(cause.message || "This worksheet couldn't be read.");
    } finally {
      setBusy("");
    }
  }

  async function createPreview() {
    if (mappingDuplicates.length) {
      setError("Choose only one source column for each field.");
      return;
    }
    if (sourceKind === "sheet" && (!sheetMetadata || !sheet)) {
      setError("Load the spreadsheet tabs and choose one first.");
      return;
    }
    if (sourceKind === "file" && (!file || !fileGrid)) {
      setError("Choose a readable CSV or XLSX file first.");
      return;
    }

    setBusy("preview");
    setError("");
    setSuccess("");
    try {
      const nextFileSourceKey = sourceKind === "file" ? (fileSourceKey || createFileSourceKey()) : "";
      if (sourceKind === "file" && !fileSourceKey) setFileSourceKey(nextFileSourceKey);
      const source = sourceKind === "sheet"
        ? {
            kind: "sheet",
            sourceKey: `sheet:${sheetMetadata.spreadsheetId}:${sheet.sheetId}`,
            sourceLabel: `${sheetMetadata.title} · ${sheet.title}`,
            spreadsheetId: sheetMetadata.spreadsheetId,
            sheetId: sheet.sheetId,
            sheetTitle: sheet.title,
          }
        : {
            kind: "file",
            sourceKey: nextFileSourceKey,
            sourceLabel: file.name,
          };
      const headerMapping = headerMapFromColumns(mapping);
      const request = {
        type,
        source,
        ...(Object.keys(headerMapping).length || fileGrid || preview?.headers?.length ? { headerMapping } : {}),
        ...(identityField ? { identityField } : {}),
        ...(sourceKind === "file" ? { headers: fileGrid.headers, rows: fileGrid.rows } : {}),
      };
      const result = await previewTrackerImport(request);
      const resultHeaders = result.headers || (sourceKind === "file" ? fileGrid.headers : []);
      const returnedHeaderMapping = result.headerMapping || headerMapping;
      const nextMapping = Object.keys(returnedHeaderMapping).length
        ? columnsFromHeaderMap(resultHeaders, returnedHeaderMapping, type)
        : (Object.hasOwn(request, "headerMapping") ? Array(resultHeaders.length).fill("") : suggestHeaderMapping(resultHeaders, type));
      setMapping(nextMapping);
      const nextIdentity = identityField || defaultIdentityField(type, nextMapping);
      setIdentityField(nextIdentity);
      const identityNeedsRefresh = sourceKind === "sheet" && !request.identityField && Boolean(nextIdentity);
      const nextPreview = { ...result, headers: resultHeaders, source, sourceKind, type, sourceLabel: source.sourceLabel };
      setPreview(nextPreview);
      setPreviewPage(1);
      setPreviewFilter("all");
      setSelectedRows(new Set());
      setReviewedIdentityRows(new Set());
      setCompletedRows(new Set());
      setPreviewDirty(identityNeedsRefresh);
      setConfirmed(false);
      if (result.rows?.length) setSuccess(identityNeedsRefresh ? "Preview ready. Review the suggested ID field and update the preview before confirming." : "Preview ready. Review the mapped fields, records, and any problems below.");
      if (sourceKind === "sheet" && !Object.keys(result.headerMapping || {}).length) {
        setError("No columns matched these records yet. Choose the columns to import, then update the preview.");
      }
    } catch (cause) {
      setError(cause.message || "The preview couldn't be created. Check the source and try again.");
    } finally {
      setBusy("");
    }
  }

  async function confirmImport() {
    if (!preview || previewDirty || mappingDuplicates.length) return;
    const rows = buildTrackerImportChoices(preview.rows, selectedRows, reviewedIdentityRows)
      .filter((row) => !completedRows.has(row.sourceRowKey));
    if (!rows.length) return;

    setBusy("confirm");
    setError("");
    setSuccess("");
    try {
      const result = await confirmTrackerImport(preview.importId, rows);
      const imported = Number(result.importedCount) || 0;
      const updated = Number(result.updatedCount) || 0;
      const unchanged = Number(result.unchangedCount) || 0;
      const completed = new Set(rows.map((row) => row.sourceRowKey));
      setCompletedRows((current) => new Set([...current, ...completed]));
      setSelectedRows((current) => new Set([...current].filter((key) => !completed.has(key))));
      setConfirmed(result.status === "confirmed");
      const counts = `${imported} added, ${updated} updated, ${unchanged} unchanged`;
      setSuccess(result.status === "confirmed"
        ? `Import confirmed: ${counts}${result.skippedCount ? `, ${result.skippedCount} skipped` : ""}.`
        : `Workbench saved some records: ${counts}. ${Number(result.remainingEligible) || "Some"} eligible rows remain. Select them to finish this import.`);
      setHistoryRequest((value) => value + 1);
    } catch (cause) {
      setError(cause.message || "The import couldn't be confirmed. Review the preview and try again.");
    } finally {
      setBusy("");
    }
  }

  function toggleRow(sourceRowKey) {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(sourceRowKey)) next.delete(sourceRowKey);
      else next.add(sourceRowKey);
      return next;
    });
  }

  function toggleIdentityReview(sourceRowKey) {
    setReviewedIdentityRows((current) => {
      const next = new Set(current);
      if (next.has(sourceRowKey)) {
        next.delete(sourceRowKey);
        setSelectedRows((selected) => new Set([...selected].filter((key) => key !== sourceRowKey)));
      } else {
        next.add(sourceRowKey);
      }
      return next;
    });
  }

  const mappedColumnCount = mappedFields(mapping).length;
  const rowCount = preview?.rows?.length || 0;
  const blockedCount = preview?.rows?.filter((row) => isBlocked(row) || row.requiresIdentityReview).length || 0;
  const selectedCount = preview?.rows?.filter((row) => selectedRows.has(row.sourceRowKey) && canConfirmRow(row, reviewedIdentityRows) && !completedRows.has(row.sourceRowKey)).length || 0;
  const hasRowPositionIdentity = preview?.rows?.some((row) => row.identityBasis === "row_position_requires_reconciliation");
  const columns = Object.keys(preview?.rows?.[0]?.values || {});
  const bulkEligibleRows = preview?.rows?.filter((row) => canConfirmRow(row, reviewedIdentityRows) && !completedRows.has(row.sourceRowKey)) || [];
  const filteredRows = (preview?.rows || []).filter((row) => {
    if (previewFilter === "ready") return canConfirmRow(row, reviewedIdentityRows) && !completedRows.has(row.sourceRowKey);
    if (previewFilter === "issues") return isBlocked(row) || row.requiresIdentityReview;
    if (previewFilter === "selected") return selectedRows.has(row.sourceRowKey);
    if (previewFilter === "saved") return completedRows.has(row.sourceRowKey);
    return true;
  });
  const page = paginateImportPreviewRows(filteredRows, previewPage);
  const pageCount = page.pageCount;
  const currentPage = page.page;
  const pageStart = page.start;
  const visibleRows = page.rows;
  const selectAllReady = () => setSelectedRows(new Set(bulkEligibleRows.map((row) => row.sourceRowKey)));

  return (
    <Card data-testid="tracker-import-panel">
      <CardHeader>
        <CardTitle className="text-base">Import data</CardTitle>
        <CardDescription>Import candidates, jobs, sourcing, submissions, or fit records from a Google Sheet or CSV/XLSX file. No Tracker rows change until you confirm.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="tracker-import-type">Data type</Label>
            <Select value={type} onValueChange={(value) => changeType(String(value))}>
              <SelectTrigger id="tracker-import-type" className="w-full"><SelectValue placeholder="Choose data type" /></SelectTrigger>
              <SelectContent>{TRACKER_IMPORT_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Source</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name="tracker-import-source" value="sheet" checked={sourceKind === "sheet"} onChange={() => { setSourceKind("sheet"); clearPreview(); setError(""); }} />Google Sheets</label>
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name="tracker-import-source" value="file" checked={sourceKind === "file"} onChange={() => { setSourceKind("file"); clearPreview(); setError(""); }} />CSV or XLSX file</label>
            </div>
          </fieldset>
        </div>

        {sourceKind === "sheet" ? <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="grid gap-2">
            <Label htmlFor="tracker-sheet-link">Google Sheets link</Label>
            <div className="flex flex-col gap-2 sm:flex-row"><Input id="tracker-sheet-link" value={sheetLink} onChange={(event) => { setSheetLink(event.target.value); setSheetMetadata(null); setSheetId(""); setMapping([]); setIdentityField(""); clearPreview(); setError(""); }} placeholder="Paste your Google Sheets link" autoComplete="url" /><Button type="button" variant="outline" disabled={busy !== "" || !sheetLink.trim()} onClick={loadSheetTabs}><CloudDownload data-icon="inline-start" />{busy === "sheets" ? "Loading tabs…" : "Load tabs"}</Button></div>
          </div>
          {sheetMetadata ? <div className="grid gap-2 sm:max-w-md"><Label htmlFor="tracker-sheet-tab">Sheet tab</Label><Select value={sheetId} onValueChange={(value) => { setSheetId(String(value)); setMapping([]); setIdentityField(""); clearPreview(); }}><SelectTrigger id="tracker-sheet-tab" className="w-full"><SelectValue placeholder="Choose a tab" /></SelectTrigger><SelectContent>{sheetMetadata.sheets.map((item) => <SelectItem key={item.sheetId} value={String(item.sheetId)}>{item.title}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Reads this tab only. Workbench never writes back to Google Sheets.</p></div> : null}
        </div> : <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="grid gap-2 sm:max-w-md"><Label htmlFor="tracker-import-file-source">File import series</Label><Select value={fileSourceKey || "new"} onValueChange={(value) => { setFileSourceKey(value === "new" ? "" : String(value)); clearPreview(); setError(""); }}><SelectTrigger id="tracker-import-file-source" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">Start a new import</SelectItem>{previousFileSources.map((item) => <SelectItem key={item.sourceKey} value={item.sourceKey}>{item.sourceLabel || "Previous file import"} · {formatDate(item.confirmedAt || item.createdAt)}</SelectItem>)}{fileSourceKey && !previousFileSources.some((item) => item.sourceKey === fileSourceKey) ? <SelectItem value={fileSourceKey}>{file?.name || "Current file import"}</SelectItem> : null}</SelectContent></Select><p className="text-xs text-muted-foreground">Choose a prior import to update the same records. File names alone never match records.</p></div>
          <div className="grid gap-2"><Label htmlFor="tracker-import-file">CSV or XLSX file</Label><Input id="tracker-import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => chooseFile(event.target.files?.[0])} aria-describedby="tracker-import-file-help" /><p id="tracker-import-file-help" className="text-xs text-muted-foreground">Up to 10 MB, 10,000 records, and 100 columns. Older .xls files aren't supported.</p></div>
          {file && fileSheets.length > 1 ? <div className="grid gap-2 sm:max-w-md"><Label htmlFor="tracker-file-tab">Workbook sheet</Label><Select value={fileSheet} onValueChange={(value) => chooseFileSheet(String(value))}><SelectTrigger id="tracker-file-tab" className="w-full"><SelectValue placeholder="Choose a sheet" /></SelectTrigger><SelectContent>{fileSheets.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div> : null}
          {fileGrid ? <p className="text-sm text-muted-foreground">{file.name}: {fileGrid.rows.length.toLocaleString()} records and {fileGrid.headers.length} columns ready to preview.</p> : null}
        </div>}

        {error ? <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{error}</span></div> : null}
        {success ? <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-3 text-sm" role="status"><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{success}</span></div> : null}

        {((sourceKind === "file" && fileGrid) || (sourceKind === "sheet" && preview?.headers?.length)) ? <section className="flex flex-col gap-4" aria-labelledby="tracker-import-mapping-title">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 id="tracker-import-mapping-title" className="text-sm font-semibold">Match source columns</h3><p className="text-sm text-muted-foreground">Choose where each column goes. Skipped columns won't be imported.</p></div><Badge variant="outline">{mappedColumnCount} mapped fields</Badge></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(sourceKind === "file" ? fileGrid.headers : preview.headers).map((header, index) => <div className="grid gap-1.5" key={`${index}:${header}`}>
            <Label htmlFor={`tracker-import-map-${index}`}>{header.trim() || `Column ${index + 1}`}</Label>
            <Select value={mapping[index] || SKIP_FIELD} onValueChange={(value) => updateMapping(index, String(value))}>
              <SelectTrigger id={`tracker-import-map-${index}`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={SKIP_FIELD}>Don't import this column</SelectItem>{TRACKER_IMPORT_FIELDS[type].map((field) => <SelectItem key={field} value={field}>{trackerImportFieldLabel(field)}</SelectItem>)}</SelectContent>
            </Select>
          </div>)}</div>
          {mappingDuplicates.length ? <p className="text-sm text-destructive" role="alert">Map only one source column to each field: {mappingDuplicates.map(trackerImportFieldLabel).join(", ")}.</p> : null}
          <div className="grid gap-2 sm:max-w-md"><Label htmlFor="tracker-import-identity">Match repeat imports using</Label><Select value={identityField || SKIP_FIELD} onValueChange={(value) => updateIdentityField(String(value))}><SelectTrigger id="tracker-import-identity" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={SKIP_FIELD}>Source row number</SelectItem>{eligibleIdentityFields.map((field) => <SelectItem key={field} value={field}>{trackerImportFieldLabel(field)}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Names are never used to match records. Without a stable ID, repeat imports use source row numbers; keep rows in the same order.</p></div>
          {previewDirty ? <Button type="button" variant="outline" className="self-start" disabled={busy !== "" || mappingDuplicates.length > 0} onClick={createPreview}>{busy === "preview" ? "Updating preview…" : "Update preview"}</Button> : null}
        </section> : null}

          <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy !== "" || (sourceKind === "sheet" ? !sheet : !fileGrid) || mappingDuplicates.length > 0} onClick={createPreview}><FileSpreadsheet data-icon="inline-start" />{busy === "preview" ? "Loading preview…" : preview ? "Refresh preview" : "Preview records"}</Button>
          {preview ? <Button type="button" variant="outline" disabled={busy !== "" || selectedCount === 0 || previewDirty || confirmed || mappingDuplicates.length > 0} onClick={confirmImport}><Upload data-icon="inline-start" />{busy === "confirm" ? "Confirming…" : `Confirm import (${selectedCount})`}</Button> : null}
        </div>

        {preview ? <section className="flex flex-col gap-3" aria-labelledby="tracker-import-preview-title">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="tracker-import-preview-title" className="text-sm font-semibold">Preview</h3><p className="text-sm text-muted-foreground">{rowCount.toLocaleString()} records checked. {blockedCount.toLocaleString()} need correction or identity review. {selectedCount.toLocaleString()} selected. Rows are not selected by default.</p></div><Badge variant="outline">{preview.sourceLabel}</Badge></div>
          {hasRowPositionIdentity ? <p className="rounded-md border p-3 text-sm">Some records use source row numbers because no stable ID was selected. Keep the source order unchanged when you import it again.</p> : null}
          {previewDirty ? <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm" role="status">The mapping changed. Update the preview before confirming.</p> : null}
          {!columns.length ? <p className="rounded-md border p-3 text-sm">No recognized fields are mapped. Select the source columns above, then update the preview.</p> : null}
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border bg-muted/20 p-3">
            <div className="grid gap-2"><Label htmlFor="tracker-import-row-filter">Show rows</Label><Select value={previewFilter} onValueChange={(value) => { setPreviewFilter(String(value)); setPreviewPage(1); }}><SelectTrigger id="tracker-import-row-filter" className="w-full min-w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All rows ({rowCount})</SelectItem><SelectItem value="ready">Ready to import ({bulkEligibleRows.length})</SelectItem><SelectItem value="issues">Needs review ({blockedCount})</SelectItem><SelectItem value="selected">Selected ({selectedCount})</SelectItem><SelectItem value="saved">Already saved ({completedRows.size})</SelectItem></SelectContent></Select></div>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={!bulkEligibleRows.length || selectedCount === bulkEligibleRows.length} onClick={selectAllReady}>Select all {bulkEligibleRows.length.toLocaleString()} ready rows</Button><Button type="button" variant="outline" size="sm" disabled={!selectedCount} onClick={() => setSelectedRows(new Set())}>Clear selection</Button></div>
            <p className="w-full text-xs text-muted-foreground">Bulk selection excludes rows with errors and rows that still need identity review. You can review every page before confirming the selected count.</p>
          </div>
          <div className="rounded-lg border"><Table>
            <TableHeader><TableRow><TableHead>Include</TableHead><TableHead>Source row</TableHead>{columns.map((field) => <TableHead key={field}>{trackerImportFieldLabel(field)}</TableHead>)}<TableHead>Review</TableHead></TableRow></TableHeader>
            <TableBody>{visibleRows.map((row) => {
              const action = actionForRow(row);
              const dataBlocked = isBlocked(row);
              const reviewAccepted = reviewedIdentityRows.has(row.sourceRowKey);
              const canReviewIdentity = row.requiresIdentityReview && !dataBlocked && canConfirmRow(row, new Set([row.sourceRowKey]));
              const canSelect = canConfirmRow(row, row.requiresIdentityReview ? new Set([row.sourceRowKey]) : reviewedIdentityRows) && !completedRows.has(row.sourceRowKey);
              const completed = completedRows.has(row.sourceRowKey);
              return <TableRow key={row.sourceRowKey || row.sourceRow}>
                <TableCell>{canSelect ? <label className="flex max-w-48 items-start gap-2 text-xs"><input type="checkbox" aria-label={`Include source row ${row.sourceRow}`} disabled={row.requiresIdentityReview && !reviewAccepted} checked={selectedRows.has(row.sourceRowKey)} onChange={() => toggleRow(row.sourceRowKey)} />{row.requiresIdentityReview && !reviewAccepted ? "Review identity first" : completed ? "Already saved" : "Include row"}</label> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell>{row.sourceRow}</TableCell>
                {columns.map((field) => <TableCell key={field} className="max-w-64 whitespace-normal break-words">{Array.isArray(row.values?.[field]) ? row.values[field].join(", ") : row.values?.[field] == null || row.values?.[field] === "" ? "—" : String(row.values[field])}</TableCell>)}
                <TableCell className="min-w-56 whitespace-normal">{dataBlocked ? <div><strong>Needs correction</strong><ul className="list-disc pl-4">{row.problems.map((problem, index) => <li key={`${index}:${problem}`}>{displayProblem(problem)}</li>)}</ul></div> : completed ? "Saved" : row.requiresIdentityReview ? <div className="grid gap-2"><strong>{reviewAccepted ? "Identity reviewed" : "Needs identity review"}</strong>{canReviewIdentity ? <label className="flex items-start gap-2 text-xs"><input type="checkbox" aria-label={action === "update" ? `Confirm row ${row.sourceRow} updates existing record ${row.existingMapping.canonicalId}` : `Confirm row ${row.sourceRow} is a new record`} checked={reviewAccepted} onChange={() => toggleIdentityReview(row.sourceRowKey)} />{action === "update" ? `I confirm this row should update record ${row.existingMapping.canonicalId}.` : action === "unchanged" ? `I confirm this row still matches record ${row.existingMapping?.canonicalId || "the existing record"}.` : "I confirm this is a new record."}</label> : null}</div> : action === "unchanged" ? "Unchanged" : action === "update" ? <span>Update existing record ({row.existingMapping.canonicalId})</span> : "Add new record"}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table></div>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Showing {filteredRows.length ? `${pageStart + 1}–${Math.min(pageStart + visibleRows.length, filteredRows.length)}` : "0"} of {filteredRows.length.toLocaleString()} filtered rows ({rowCount.toLocaleString()} total).</p><div className="flex items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}>Previous</Button><span className="text-xs tabular-nums">Page {currentPage} of {pageCount}</span><Button type="button" size="sm" variant="outline" disabled={currentPage >= pageCount} onClick={() => setPreviewPage((page) => Math.min(pageCount, page + 1))}>Next</Button></div></div>
        </section> : null}

        <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="tracker-import-history-title">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 id="tracker-import-history-title" className="text-sm font-semibold">Import history</h3><p className="text-sm text-muted-foreground">Confirmed imports appear here after Workbench saves them.</p></div><Button type="button" variant="outline" size="sm" disabled={historyState === "loading"} onClick={() => setHistoryRequest((value) => value + 1)}><RefreshCw data-icon="inline-start" />{historyState === "loading" ? "Refreshing…" : "Refresh history"}</Button></div>
          {historyError ? <div className="flex items-start justify-between gap-3" role="alert"><p className="text-sm text-destructive">{historyError}</p><Button type="button" variant="outline" size="sm" onClick={() => setHistoryRequest((value) => value + 1)}>Retry</Button></div> : null}
          {historyState === "loading" && !history.length ? <p className="text-sm text-muted-foreground" role="status">Loading import history…</p> : null}
          {historyState === "ready" && !history.length ? <p className="text-sm text-muted-foreground">No imports yet.</p> : null}
          {history.length ? <ul className="grid gap-2">{history.slice(0, 10).map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span className="font-medium">{item.sourceLabel || TRACKER_IMPORT_TYPES.find((entry) => entry.value === item.type)?.label || "Import"}</span><span className="text-muted-foreground">{historyStatus(item.status)} · {formatDate(item.confirmedAt || item.createdAt)}</span></li>)}</ul> : null}
        </section>
      </CardContent>
    </Card>
  );
}
