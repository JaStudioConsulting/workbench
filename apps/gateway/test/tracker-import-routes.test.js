import assert from "node:assert/strict";
import test from "node:test";
import { createTrackerImportHandlers } from "../src/tracker-import-routes.js";

const runId = "33333333-3333-4333-8333-333333333333";

function request({ body = {}, query = {}, params = {}, token = "user-token" } = {}) {
  return {
    body, query, params, workbenchSession: { user: { email: "ja@example.invalid" } },
    get(name) { return name.toLowerCase() === "authorization" ? `Bearer ${token}` : undefined; },
  };
}
function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    set(key, value) { if (typeof key === "object") Object.assign(this.headers, key); else this.headers[key] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

function fixture() {
  const calls = [];
  const store = {
    async verifyUser(token) {
      if (token === "service_role-token") throw Object.assign(new Error("Privileged token forbidden"), { status: 403, code: "FORBIDDEN" });
      assert.equal(token, "user-token"); return { id: "user-1", email: "ja@example.invalid" };
    },
    async request(_token, path, options = {}) {
      calls.push({ path, ...options });
      if (path === "tracker_imports") return [{ id: runId, status: "preview" }];
      if (path === "rpc/save_tracker_import_preview") return { rowCount: options.body.p_rows.length };
      if (path === "rpc/confirm_tracker_import") return { count: options.body.p_rows.length, status: "partial", remainingEligible: 1535, rows: options.body.p_rows.map((row) => ({ ...row, canonicalId: 3 })) };
      return [];
    },
  };
  const auth = { isApprovedEmail: (email) => email === "ja@example.invalid", getGoogleProviderAccessToken: async () => ({ accessToken: "google-token", scopes: ["https://www.googleapis.com/auth/spreadsheets"] }) };
  const handlers = createTrackerImportHandlers({ env: { SUPABASE_URL: "https://supabase.example", SUPABASE_PUBLISHABLE_KEY: "public-key" }, auth, store, sheetsClientFactory: async () => ({
    spreadsheets: {
      async get({ spreadsheetId }) { return { data: { spreadsheetId, properties: { title: "Tracker" }, sheets: [{ properties: { sheetId: 8, title: "Candidates", gridProperties: { rowCount: 2000, columnCount: 10 } } }] } }; },
      values: { async get() { return { data: { values: [["Candidate Name", "Email"], ["Alex Lee", "alex@example.invalid"]] } }; } },
    },
  }) });
  return { handlers, calls };
}

test("Sheets metadata and preview use the matching approved caller and read-only Google methods", async () => {
  const { handlers, calls } = fixture();
  const metaRes = response();
  await handlers.metadata(request({ query: { spreadsheetId: "123456789012345678901234567890" } }), metaRes);
  assert.equal(metaRes.statusCode, 200);
  assert.equal(metaRes.body.sheets[0].sheetId, 8);

  const previewRes = response();
  await handlers.preview(request({ body: {
    type: "candidates",
    source: { kind: "sheet", spreadsheetId: "123456789012345678901234567890", sheetId: 8, sheetTitle: "Candidates", sourceKey: "sheet:123456789012345678901234567890:8", sourceLabel: "Tracker · Candidates" },
    identityField: "email",
  } }), previewRes);
  assert.equal(previewRes.statusCode, 201);
  assert.equal(previewRes.body.rows[0].values.candidate_name, "Alex Lee");
  assert.equal(previewRes.body.rows[0].fingerprint.length, 32);
  assert.equal(calls.find((call) => call.path === "rpc/save_tracker_import_preview").body.p_rows.length, 1);
});

test("preview preserves 1,536 rows and confirm sends choices only for server-saved preview", async () => {
  const { handlers, calls } = fixture();
  const rows = Array.from({ length: 1536 }, (_, index) => [`Candidate ${index + 1}`, `candidate${index + 1}@example.invalid`]);
  const previewRes = response();
  await handlers.preview(request({ body: {
    type: "candidates", source: { kind: "file", sourceKey: "upload:44444444-4444-4444-8444-444444444444", sourceLabel: "Tracker.csv" },
    headers: ["Candidate Name", "Email"], rows, identityField: "email",
  } }), previewRes);
  assert.equal(previewRes.statusCode, 201);
  assert.equal(previewRes.body.rowCount, 1536);
  assert.equal(calls.find((call) => call.path === "rpc/save_tracker_import_preview").body.p_rows.length, 1536);

  const confirmRes = response();
  await handlers.confirm(request({ params: { id: runId }, body: { confirm: true, rows: [{ sourceRowKey: previewRes.body.rows[0].sourceRowKey, action: "insert", values: { candidate_name: "Forged client snapshot" }, fingerprint: "forged", blocked: false }] } }), confirmRes);
  assert.equal(confirmRes.statusCode, 200);
  assert.equal(confirmRes.body.importedCount, 1);
  const confirmCall = calls.find((call) => call.path === "rpc/confirm_tracker_import");
  assert.deepEqual(confirmCall.body.p_rows, [{ sourceRowKey: previewRes.body.rows[0].sourceRowKey, action: "insert" }]);
});

test("Sheets tab mismatch and unapproved caller are rejected before persistence", async () => {
  const { handlers, calls } = fixture();
  const mismatch = response();
  await handlers.preview(request({ body: { type: "candidates", source: { kind: "sheet", spreadsheetId: "123456789012345678901234567890", sheetId: 999, sheetTitle: "Other", sourceKey: "sheet:x:999", sourceLabel: "Other" } } }), mismatch);
  assert.equal(mismatch.statusCode, 400);
  assert.equal(calls.length, 0);

  const forged = response();
  await handlers.history(request({ token: "service_role-token" }), forged);
  assert.equal(forged.statusCode, 403);
  const mismatched = request();
  mismatched.workbenchSession.user.email = "other@example.invalid";
  const denied = response();
  await handlers.preview({ ...mismatched, body: {
    type: "candidates", source: { kind: "sheet", spreadsheetId: "123456789012345678901234567890", sheetId: 8, sheetTitle: "Candidates", sourceKey: "sheet:123456789012345678901234567890:8", sourceLabel: "Tracker · Candidates" },
  } }, denied);
  assert.equal(denied.statusCode, 403);

  const fileHistory = response();
  await handlers.history(mismatched, fileHistory);
  assert.equal(fileHistory.statusCode, 200);
});
