import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrackerImportChoices,
  createFileSourceKey,
  TrackerImportError,
  confirmTrackerImport,
  getSpreadsheetMetadata,
  listTrackerImports,
  paginateImportPreviewRows,
  parseCsvText,
  parseSpreadsheetId,
  previewTrackerImport,
  suggestHeaderMapping,
  validateImportGrid,
} from "../src/features/imports/trackerImportClient.js";

test("CSV parser preserves quoted commas and rejects malformed or oversized grids", () => {
  assert.deepEqual(parseCsvText('Candidate Name,Notes\r\nAda Lovelace,"text, with comma"\r\n'), {
    headers: ["Candidate Name", "Notes"],
    rows: [["Ada Lovelace", "text, with comma"]],
  });
  assert.throws(() => parseCsvText('Candidate Name\n"unfinished'), /open quote/);
  assert.throws(() => validateImportGrid([["A"], Array.from({ length: 101 }, () => "value")]), /columns/);
  assert.throws(() => validateImportGrid([["A"], ["x".repeat(10_001)]]), /cell is longer/);
  assert.deepEqual(suggestHeaderMapping(["Name", "Email", "Job ID", "Status"], "candidates"), ["candidate_name", "email", "", ""]);
});

test("file source keys are explicit UUIDs, not derived from filenames or file metadata", () => {
  const first = createFileSourceKey();
  const second = createFileSourceKey();
  assert.match(first, /^upload:/);
  assert.notEqual(first, second);
});

test("including a row does not acknowledge row-position identity review", () => {
  const row = { sourceRowKey: "sheet:source:row:2", requiresIdentityReview: true, suggestedAction: "insert", problems: [] };
  assert.deepEqual(buildTrackerImportChoices([row], new Set([row.sourceRowKey])), []);
  assert.deepEqual(buildTrackerImportChoices([row], new Set([row.sourceRowKey]), new Set([row.sourceRowKey])), [
    { sourceRowKey: row.sourceRowKey, action: "insert", reviewedIdentity: true },
  ]);
  const update = { ...row, suggestedAction: "update", existingMapping: { canonicalId: 42, sourceFingerprint: "old" } };
  assert.deepEqual(buildTrackerImportChoices([update], new Set([update.sourceRowKey]), new Set([update.sourceRowKey])), [
    { sourceRowKey: update.sourceRowKey, action: "update", canonicalId: 42, reviewedIdentity: true },
  ]);
});

test("preview pagination exposes later records without selecting them implicitly", () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ sourceRowKey: `row-${index + 1}`, sourceRow: index + 2, problems: [] }));
  const first = paginateImportPreviewRows(rows, 1);
  const second = paginateImportPreviewRows(rows, 2);
  assert.equal(first.rows.length, 50);
  assert.equal(second.rows[0].sourceRowKey, "row-51");
  assert.equal(second.pageCount, 2);
  assert.deepEqual(buildTrackerImportChoices(rows, new Set()), []);
});

test("Tracker requests use caller session, publishable key, and confirmed response data", async () => {
  const requests = [];
  const client = {
    supabaseKey: "sb_publishable_test",
    auth: { async getSession() { return { data: { session: { access_token: "caller-token" } }, error: null }; } },
  };
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    return Response.json({ importId: "import-1", importedCount: 1, updatedCount: 0, unchangedCount: 0, rows: [] });
  };
  const response = await previewTrackerImport({ type: "candidates", source: {}, headers: ["Name"], rows: [["Ada"]], headerMapping: { candidate_name: 0 } }, { client, fetchImpl });
  assert.equal(response.importId, "import-1");
  assert.match(requests[0].url, /\/api\/tracker-imports\/preview$/);
  assert.equal(requests[0].options.credentials, "include");
  assert.equal(requests[0].options.headers.Authorization, "Bearer caller-token");
  assert.equal(requests[0].options.headers.apikey, "sb_publishable_test");

  const confirmed = await confirmTrackerImport("import-1", [], { client, fetchImpl });
  assert.equal(confirmed.importedCount, 1);
  assert.match(requests[1].url, /\/api\/tracker-imports\/import-1\/confirm$/);
  assert.deepEqual(JSON.parse(requests[1].options.body), { rows: [], confirm: true });
});

test("spreadsheet metadata accepts a link and uses the connected account cookie and caller JWT", async () => {
  let request;
  const metadata = await getSpreadsheetMetadata("https://docs.google.com/spreadsheets/d/abcdefghijklmnop123456/edit", {
    client: {
      supabaseKey: "sb_publishable_test",
      auth: { async getSession() { return { data: { session: { access_token: "caller-token" } }, error: null }; } },
    },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return Response.json({ spreadsheetId: "abcdefghijklmnop123456", title: "Tracker", sheets: [{ sheetId: 11, title: "Candidates", range: "Candidates!A1:Z12" }] });
    },
  });
  assert.match(request.url, /\/api\/tracker-imports\/sheets\/metadata\?spreadsheetId=abcdefghijklmnop123456$/);
  assert.equal(request.options.credentials, "include");
  assert.equal(request.options.headers.Authorization, "Bearer caller-token");
  assert.equal(request.options.headers.apikey, undefined);
  assert.equal(metadata.sheets[0].title, "Candidates");
  assert.equal(parseSpreadsheetId("abcdefghijklmnop123456"), "abcdefghijklmnop123456");
  assert.throws(() => parseSpreadsheetId("not a spreadsheet"), /valid Google Sheets/);
});

test("history read returns items and large previews stop before sending", async () => {
  const client = {
    supabaseKey: "sb_publishable_test",
    auth: { async getSession() { return { data: { session: { access_token: "caller-token" } }, error: null }; } },
  };
  const items = await listTrackerImports({ client, fetchImpl: async () => Response.json({ items: [{
    id: "i1",
    source_type: "candidates",
    source_key: "upload:11111111-1111-4111-8111-111111111111",
    source_label: "synthetic.csv",
    status: "confirmed",
    created_at: "2026-11-13T17:00:00Z",
    confirmed_at: "2026-11-13T17:01:00Z",
  }] }) });
  assert.equal(items[0].id, "i1");
  assert.deepEqual({ type: items[0].type, sourceKey: items[0].sourceKey, sourceLabel: items[0].sourceLabel, createdAt: items[0].createdAt, confirmedAt: items[0].confirmedAt }, {
    type: "candidates",
    sourceKey: "upload:11111111-1111-4111-8111-111111111111",
    sourceLabel: "synthetic.csv",
    createdAt: "2026-11-13T17:00:00Z",
    confirmedAt: "2026-11-13T17:01:00Z",
  });
  await assert.rejects(
    previewTrackerImport({ rows: [["x".repeat(10 * 1024 * 1024 + 1)]] }, { client, fetchImpl: async () => { throw new Error("must not send"); } }),
    (error) => error instanceof TrackerImportError && error.code === "LIMIT_EXCEEDED",
  );
});

test("import API errors map to concise recovery guidance", async () => {
  const client = {
    supabaseKey: "sb_publishable_test",
    auth: { async getSession() { return { data: { session: { access_token: "caller-token" } }, error: null }; } },
  };
  await assert.rejects(
    listTrackerImports({ client, fetchImpl: async () => Response.json({ error: { code: "IMPORT_CONFLICT" } }, { status: 409 }) }),
    /source changed since the preview/i,
  );
  await assert.rejects(
    listTrackerImports({ client: { supabaseKey: "k", auth: { async getSession() { return { data: { session: null }, error: null }; } } }, fetchImpl: async () => { throw new Error("must not send"); } }),
    /sign in again/i,
  );
});
