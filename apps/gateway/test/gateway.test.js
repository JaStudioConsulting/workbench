import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { createApp } from "../app.js";
import { createConfiguredAuth, parseAllowedGoogleEmails, parseExactHttpsOrigins } from "../src/auth.js";
import { discoverMcp, loadRecruitmentAuthority, validatePublishedRecruitmentAssets, validateRecruitmentManifest } from "../src/recruitment-package.js";

const browserOrigin = "https://console.test";
const testEnv = { APP_TRUSTED_ORIGINS: browserOrigin };
const supabaseMeetingEnv = { ...testEnv, SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const testAuthority = async () => ({ id: "recruiter", routerPath: "recruiter/SKILL.md", capabilities: [] });
const supabaseUserId = "11111111-1111-4111-8111-111111111111";
const supabaseFetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => url.endsWith("/auth/v1/user")
    ? { id: supabaseUserId, email: "review@example.invalid" }
    : url.includes("/rest/v1/candidates_all?")
      ? [{ id: "sourcing:7", candidate_name: "Avery Sampleton", current_title: "Maintenance Supervisor" }]
      : true,
});
const testRecruitmentContext = async () => ({
  authority: { ...await testAuthority(), policies: ["_JA-RULES.md", "_TOOL-MAP.md"] },
  pkg: {
    readSkillText: async (path) => path === "_JA-RULES.md"
      ? "# Ja rules\nThese rules override defaults."
      : "# Recruiter\nThe sole recruiting front door.",
    assertSkillFile: async () => {},
  },
});
const authenticated = {
  enabled: true,
  handler: (_req, res) => res.status(404).end(),
  isApprovedEmail: (email) => email === "review@example.invalid",
  getSession: async (req) => {
    if (req.headers.authorization === "Bearer synthetic-review") return { session: { id: "synthetic-session", userId: "synthetic-user" }, user: { id: "synthetic-user", email: "review@example.invalid" } };
    if (req.headers.authorization === "Bearer synthetic-unapproved") return { session: { id: "synthetic-session", userId: "synthetic-other" }, user: { id: "synthetic-other", email: "other@example.invalid" } };
    if (req.headers.authorization === "Bearer synthetic-missing-email") return { session: { id: "synthetic-session", userId: "synthetic-missing" }, user: { id: "synthetic-missing" } };
    return null;
  },
};
authenticated.getAuthoritativeSession = authenticated.getSession;

async function request(app, method, path, { body, rawBody, headers = {}, rawResponse = false } = {}) {
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    return await new Promise((resolve, reject) => {
      const resolvedHeaders = { ...headers };
      if (resolvedHeaders.origin === "__same__") resolvedHeaders.origin = `http://localhost:${server.address().port}`;
      const req = httpRequest({ port: server.address().port, path, method, headers: { ...resolvedHeaders, ...(payload ? { ...(!headers["content-type"] ? { "content-type": "application/json" } : {}), "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: rawResponse ? data : data ? JSON.parse(data) : null }));
      });
      req.on("error", reject);
      req.end(payload);
    });
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("public routes work server-to-server while browser CORS is strict", async () => {
  const app = await createApp({ env: testEnv, recruitmentContextLoader: testRecruitmentContext });
  assert.equal((await request(app, "GET", "/healthz")).status, 200);
  const authStatus = await request(app, "GET", "/api/auth/workbench-status");
  assert.equal(authStatus.status, 200);
  assert.deepEqual(authStatus.body, { googleSignIn: "unavailable", localDataSession: "unavailable" });
  assert.equal(authStatus.headers["cache-control"], "private, no-store");
  const allowed = await request(app, "OPTIONS", "/mcp", { headers: { origin: browserOrigin } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], browserOrigin);
  assert.equal(allowed.headers["access-control-allow-credentials"], "true");
  assert.equal((await request(app, "GET", "/healthz", { headers: { origin: "https://untrusted.test" } })).status, 403);
});

test("public capabilities keep every AI feature disabled regardless of credentials", async () => {
  const app = await createApp({
    env: { ...testEnv, ANTHROPIC_API_KEY: "configured-key", WORKBENCH_AI_ENABLED: "1", WORKBENCH_TRANSCRIPTION_ENABLED: "1" },
    recruitmentContextLoader: testRecruitmentContext,
  });
  const response = await request(app, "GET", "/api/capabilities");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ai: false, transcription: false, automation: true });
  assert.equal(response.headers["cache-control"], "no-store");
});

test("private Supabase bootstrap and Better Auth Google sign-in report separate capabilities", async () => {
  const app = await createApp({
    env: {
      ...testEnv,
      WORKBENCH_LOCAL_SESSION_ENABLED: "1",
      WORKBENCH_LOCAL_SESSION_OWNER_ID: supabaseUserId,
      WORKBENCH_LOCAL_SESSION_SECRET_FILE: "/private/session-secret",
    },
    authConfig: authenticated,
    recruitmentContextLoader: testRecruitmentContext,
  });
  const response = await request(app, "GET", "/api/auth/workbench-status");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { googleSignIn: "configured", localDataSession: "configured" });
  assert.doesNotMatch(JSON.stringify(response.body), /secret|token|email|owner/i);
});

test("auth malformed environment fails closed without throwing", async () => {
  assert.equal(parseExactHttpsOrigins("https://console.test,https://console.test").length, 1);
  assert.equal(parseExactHttpsOrigins("https://console.test/path"), null);
  assert.deepEqual(parseAllowedGoogleEmails(" REVIEW@example.invalid,review@example.invalid, work@example.invalid "), ["review@example.invalid", "work@example.invalid"]);
  assert.equal(parseAllowedGoogleEmails(""), null);
  assert.equal(parseAllowedGoogleEmails("not-an-email"), null);
  assert.equal(parseAllowedGoogleEmails("review@" + "double..example.invalid"), null);
  assert.equal(parseAllowedGoogleEmails("review@" + "example.invalid."), null);
  assert.equal((await createConfiguredAuth({ BETTER_AUTH_URL: "not-a-url" })).enabled, false);
  assert.equal((await createConfiguredAuth({ DATABASE_URL: "configured", BETTER_AUTH_URL: browserOrigin, BETTER_AUTH_SECRET: "short", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", AUTH_TRUSTED_ORIGINS: browserOrigin })).enabled, false);
  assert.equal((await createConfiguredAuth({ DATABASE_URL: "configured", BETTER_AUTH_URL: browserOrigin, BETTER_AUTH_SECRET: "x".repeat(32), GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", AUTH_TRUSTED_ORIGINS: browserOrigin })).enabled, false);
});

test("API routes require the appropriate approved app or Google session", async () => {
  const noAuth = await createApp({ env: testEnv, recruitmentContextLoader: testRecruitmentContext });
  assert.equal((await request(noAuth, "GET", "/api/mcp/discovery")).status, 503);
  const app = await createApp({ env: testEnv, recruitmentContextLoader: testRecruitmentContext, authConfig: authenticated });
  assert.equal((await request(app, "GET", "/api/mcp/discovery")).status, 401);
  assert.equal((await request(app, "GET", "/api/meetings/status")).status, 401);
  assert.equal((await request(app, "POST", "/api/workflows/after-call/prepare", { body: {} })).status, 401);
  assert.equal((await request(app, "POST", "/api/meetings/transcribe", { rawBody: Buffer.from("audio"), headers: { "content-type": "audio/mp4" } })).status, 401);
  assert.equal((await request(app, "POST", "/api/meetings/capture/start", { body: { jobId: "job-1", candidateId: "candidate-1" } })).status, 401);
  assert.equal((await request(app, "POST", "/mcp", { body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } })).status, 401);
  assert.equal((await request(app, "GET", "/api/mcp/discovery", { headers: { authorization: "Bearer synthetic-unapproved" } })).status, 403);
  assert.equal((await request(app, "GET", "/api/mcp/discovery", { headers: { authorization: "Bearer synthetic-missing-email" } })).status, 403);
  const discovery = await request(app, "GET", "/api/mcp/discovery", { headers: { authorization: "Bearer synthetic-review" } });
  assert.equal(discovery.status, 200);
  assert.deepEqual(discovery.body.tools.map((tool) => tool.id), ["recruiter", "workspace_status"]);
});

test("Tracker import gateway wiring permits Supabase-only file imports and keeps Sheets behind Google auth", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const importId = "22222222-2222-4222-8222-222222222222";
  const userEmail = "review@example.invalid";
  const importCalls = [];
  const authConfig = {
    enabled: true,
    isApprovedEmail: (email) => email === userEmail,
    handler: (_req, res) => res.status(404).end(),
    async getSession() { return null; },
    async getAuthoritativeSession(req) {
      if (req.headers.cookie === "google-session=connected") return { session: { id: "google-session", userId }, user: { id: userId, email: userEmail } };
      return null;
    },
    async getGoogleProviderAccessToken() { return { accessToken: "google-read-token", scopes: ["https://www.googleapis.com/auth/spreadsheets"] }; },
  };
  const candidateFetch = async (url) => ({
    ok: true, status: 200,
    async json() {
      if (String(url).endsWith("/auth/v1/user")) return { id: userId, email: userEmail, role: "authenticated" };
      return true;
    },
  });
  const store = {
    async verifyUser(token) {
      if (token !== "supabase-user-session") throw Object.assign(new Error("Invalid user"), { status: 401, code: "UNAUTHORIZED" });
      return { id: userId, email: userEmail };
    },
    async request(_token, path, options = {}) {
      importCalls.push({ path, options });
      if (path === "tracker_imports") return [{ id: importId, status: "preview" }];
      if (path === "rpc/save_tracker_import_preview") return { rowCount: 1 };
      if (path.startsWith("tracker_import_source_rows?")) return [];
      if (path.startsWith("tracker_imports?")) return [];
      if (path === "rpc/confirm_tracker_import") return { status: "confirmed", importedCount: 1, updatedCount: 0, unchangedCount: 0, skippedCount: 0, failedCount: 0, rows: [] };
      throw new Error(`Unexpected import request: ${path}`);
    },
  };
  const app = await createApp({
    env: { ...testEnv, SUPABASE_URL: "https://supabase.example", SUPABASE_PUBLISHABLE_KEY: "publishable-key" },
    authConfig,
    candidateFetch,
    trackerImportDependencies: { store },
    recruitmentContextLoader: testRecruitmentContext,
  });
  const noToken = await request(app, "GET", "/api/tracker-imports");
  assert.equal(noToken.status, 401);
  const noGoogleMeta = await request(app, "GET", "/api/tracker-imports/sheets/metadata?spreadsheetId=123456789012345678901234567890", { headers: { authorization: "Bearer supabase-user-session" } });
  assert.equal(noGoogleMeta.status, 401);
  const noGoogleSheet = await request(app, "POST", "/api/tracker-imports/preview", {
    headers: { authorization: "Bearer supabase-user-session" },
    body: { type: "candidates", source: { kind: "sheet", spreadsheetId: "123456789012345678901234567890", sheetId: 8, sheetTitle: "Candidates", sourceKey: "sheet:123456789012345678901234567890:8", sourceLabel: "Tracker" } },
  });
  assert.equal(noGoogleSheet.status, 401);
  assert.equal(importCalls.length, 0);

  const filePreview = await request(app, "POST", "/api/tracker-imports/preview", {
    headers: { authorization: "Bearer supabase-user-session" },
    body: { type: "candidates", source: { kind: "file", sourceKey: "upload:33333333-3333-4333-8333-333333333333", sourceLabel: "Candidates.csv" }, headers: ["Candidate Name"], rows: [["Jamie Recruiter"]] },
  });
  assert.equal(filePreview.status, 201);
  const history = await request(app, "GET", "/api/tracker-imports", { headers: { authorization: "Bearer supabase-user-session" } });
  assert.equal(history.status, 200);
  const confirm = await request(app, "POST", `/api/tracker-imports/${importId}/confirm`, {
    headers: { authorization: "Bearer supabase-user-session" },
    body: { confirm: true, rows: [{ sourceRowKey: filePreview.body.rows[0].sourceRowKey, action: "insert", reviewedIdentity: true }] },
  });
  assert.equal(confirm.status, 200);
  assert.equal(importCalls.some((call) => call.path === "rpc/confirm_tracker_import"), true);
});

test("meeting transcription and status never invoke the model adapter", async () => {
  let modelCalls = 0;
  const forbidden = async () => { modelCalls += 1; throw new Error("No model operation may run"); };
  const app = await createApp({
    env: { ...supabaseMeetingEnv, ANTHROPIC_API_KEY: "configured-key" },
    recruitmentContextLoader: testRecruitmentContext,
    authConfig: authenticated,
    candidateFetch: supabaseFetch,
    captureManager: { available: async () => false },
    transcriptionAdapter: { available: forbidden, transcribe: forbidden, transcribeFile: forbidden },
  });
  const headers = { authorization: "Bearer synthetic-review" };
  const response = await request(app, "POST", "/api/meetings/transcribe", {
    rawBody: Buffer.from("synthetic-audio"), headers: { ...headers, "content-type": "audio/mp4" },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "AI_DISABLED");
  const status = await request(app, "GET", "/api/meetings/status", { headers });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { available: false, transcription: false, transcriptionStatus: "disabled", enhanced: false, captureAvailable: false });
  assert.equal(modelCalls, 0);
});

test("meeting status reports capture availability separately from disabled transcription", async () => {
  const app = await createApp({
    env: { ...supabaseMeetingEnv, WORKBENCH_NATIVE_MEETING_ENHANCEMENTS: "1" },
    recruitmentContextLoader: testRecruitmentContext,
    authConfig: authenticated,
    candidateFetch: supabaseFetch,
    captureManager: { available: async () => true },
    transcriptionAdapter: { available: async () => { throw new Error("Do not inspect the model"); } },
  });
  const response = await request(app, "GET", "/api/meetings/status", {
    headers: { authorization: "Bearer synthetic-review" },
  });
  assert.deepEqual(response.body, { available: false, transcription: false, transcriptionStatus: "disabled", enhanced: true, captureAvailable: true });
  assert.doesNotMatch(JSON.stringify(response.body), /path|native\/bin/i);
});

test("native stop is owner-bound, finalizes once, and preserves audio without transcription", async () => {
  let stops = 0;
  let modelCalls = 0;
  let saved = null;
  const forbidden = async () => { modelCalls += 1; throw new Error("No model operation may run"); };
  const captureManager = {
    initialize: async () => {},
    available: async () => true,
    start: async ({ jobId, candidateId, ownerId }) => {
      assert.equal(ownerId, supabaseUserId);
      return { id: "capture-1", state: "recording", jobId, candidateId, usedSystemAudio: true };
    },
    stop: async (_id, ownerId) => {
      assert.equal(ownerId, supabaseUserId);
      stops += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { id: "capture-1", state: "captured", jobId: "job-1", candidateId: "candidate-1", warning: null };
    },
    audioInfo: async (_id, _source, ownerId) => {
      assert.equal(ownerId, supabaseUserId);
      const audio = Buffer.from("saved-audio");
      return { path: "/private/recording.wav", contentType: "audio/wav", size: audio.length, stream: () => Readable.from([audio]) };
    },
    loadFinalizedResponse: async (_id, ownerId) => { assert.equal(ownerId, supabaseUserId); return saved; },
    saveFinalizedResponse: async (_id, ownerId, response) => { assert.equal(ownerId, supabaseUserId); saved = response; },
  };
  const appOptions = {
    env: supabaseMeetingEnv,
    recruitmentContextLoader: testRecruitmentContext,
    authConfig: authenticated,
    candidateFetch: supabaseFetch,
    captureManager,
    transcriptionAdapter: { available: forbidden, transcribe: forbidden, transcribeFile: forbidden },
  };
  const app = await createApp(appOptions);
  const headers = { authorization: "Bearer synthetic-review" };
  const started = await request(app, "POST", "/api/meetings/capture/start", { headers, body: { jobId: "job-1", candidateId: "candidate-1" } });
  assert.equal(started.status, 201);
  const [first, second] = await Promise.all([
    request(app, "POST", "/api/meetings/capture/capture-1/stop", { headers }),
    request(app, "POST", "/api/meetings/capture/capture-1/stop", { headers }),
  ]);
  assert.equal(first.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(first.body.transcription.status, "disabled");
  assert.equal(first.body.transcript, "");
  assert.deepEqual(first.body.segments, []);
  assert.equal(first.body.capture.audioUrl, "/api/meetings/capture/capture-1/audio");
  assert.equal(stops, 1);
  const audio = await request(app, "GET", first.body.capture.audioUrl, { headers, rawResponse: true });
  assert.equal(audio.status, 200);
  assert.equal(audio.headers["content-type"], "audio/wav");
  assert.equal(audio.body, "saved-audio");
  assert.equal((await request(app, "GET", first.body.capture.audioUrl)).status, 401);
  const retried = await request(app, "POST", "/api/meetings/capture/capture-1/stop", { headers });
  assert.deepEqual(retried.body, first.body);
  const restarted = await createApp(appOptions);
  const recovered = await request(restarted, "POST", "/api/meetings/capture/capture-1/stop", { headers });
  assert.deepEqual(recovered.body, first.body);
  assert.equal(stops, 1);
  assert.equal(modelCalls, 0);
});

test("disabled transcription retains Supabase authentication even in local trusted mode", async () => {
  const app = await createApp({
    env: { ...supabaseMeetingEnv, LOCAL_TRUSTED_MODE: "1" },
    recruitmentContextLoader: testRecruitmentContext,
    authConfig: { enabled: false, reason: "Authentication unavailable" },
    candidateFetch: supabaseFetch,
    transcriptionAdapter: { transcribe: async () => { throw new Error("No model operation may run"); } },
  });
  const transcription = await request(app, "POST", "/api/meetings/transcribe", {
    rawBody: Buffer.from("synthetic-audio"),
    headers: { "content-type": "audio/wav", origin: "__same__", authorization: "Bearer synthetic-review" },
  });
  assert.equal(transcription.status, 409);
  assert.equal(transcription.body.error.code, "AI_DISABLED");
  assert.equal((await request(app, "GET", "/api/mcp/discovery")).status, 503);
  assert.equal((await request(app, "POST", "/api/meetings/transcribe", {
    rawBody: Buffer.from("synthetic-audio"), headers: { "content-type": "audio/wav" },
  })).status, 401);
});

test("MCP initializes and lists only recruiter plus read-only status", async () => {
  const app = await createApp({ env: testEnv, authConfig: authenticated });
  const headers = { authorization: "Bearer synthetic-review", accept: "application/json, text/event-stream" };
  const initialize = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "synthetic", version: "1" } } } });
  assert.equal(initialize.status, 200);
  const listed = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.result.tools.map((tool) => tool.name).sort(), ["recruiter", "workspace_status"]);
  const status = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "workspace_status", arguments: {} } } });
  assert.equal(status.status, 200);
  assert.match(status.body.result.content[0].text, /Supabase-backed candidate review/);
  assert.match(status.body.result.content[0].text, /does not check current connectivity/);
  assert.match(status.body.result.content[0].text, /Loxo changes queue for review/);
  assert.doesNotMatch(status.body.result.content[0].text, /review-only|Durable storage is unavailable/);
  const router = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "recruiter", arguments: {} } } });
  assert.equal(router.status, 200);
  assert.match(router.body.result.content[0].text, /recruiter/i);
  const material = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "recruiter", arguments: { capability: "interview-prep-material" } } } });
  assert.equal(material.status, 200);
  assert.match(material.body.result.content[0].text, /# Interview Prep Material/);
  assert.doesNotMatch(JSON.stringify(listed.body), /gmail|loxo|submit|approve|neo4j/i);
});

test("Recruiter context loads once at startup and only the requested guide loads later", async () => {
  let contextLoads = 0;
  const readPaths = [];
  const assertedPaths = [];
  const context = {
    authority: {
      id: "recruiter",
      routerPath: "recruiter/SKILL.md",
      policies: ["_JA-RULES.md", "_TOOL-MAP.md"],
      capabilities: [{ id: "vet", path: "recruiter/modules/vet/GUIDE.md", status: "active" }],
    },
    pkg: {
      readSkillText: async (path) => {
        readPaths.push(path);
        if (path === "_JA-RULES.md") return "# Ja rules\nThese rules override defaults.";
        if (path === "recruiter/SKILL.md") return "# Recruiter\nThe sole recruiting front door.";
        if (path === "recruiter/modules/vet/GUIDE.md") return "# Vet guide\nReturn a source-backed verdict.";
        throw new Error(`Unexpected skill read: ${path}`);
      },
      assertSkillFile: async (path) => { assertedPaths.push(path); },
    },
  };
  const app = await createApp({
    env: testEnv,
    candidateFetch: supabaseFetch,
    authConfig: authenticated,
    recruitmentContextLoader: async () => { contextLoads += 1; return context; },
  });
  const headers = { authorization: "Bearer synthetic-review", accept: "application/json, text/event-stream" };
  const supabaseHeaders = { authorization: "Bearer synthetic-supabase", accept: "application/json" };

  assert.equal(contextLoads, 1);
  assert.deepEqual(readPaths, ["_JA-RULES.md", "recruiter/SKILL.md"]);
  const discovery = await request(app, "GET", "/api/mcp/discovery", { headers });
  assert.deepEqual(discovery.body.tools.map((tool) => tool.id), ["recruiter", "workspace_status"]);
  const listed = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } });
  assert.deepEqual(listed.body.result.tools.map((tool) => tool.name).sort(), ["recruiter", "workspace_status"]);
  const routerOnly = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "recruiter", arguments: {} } } });
  assert.ok(routerOnly.body.result.content[0].text.indexOf("# Ja rules") < routerOnly.body.result.content[0].text.indexOf("# Recruiter"));
  assert.match(routerOnly.body.result.content[0].text, /sole recruiting front door/i);
  const routed = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "recruiter", arguments: { capability: "vet" } } } });
  assert.match(routed.body.result.content[0].text, /Vet guide/);
  assert.ok(routed.body.result.content[0].text.indexOf("# Ja rules") < routed.body.result.content[0].text.indexOf("# Recruiter"));
  assert.ok(routed.body.result.content[0].text.indexOf("# Recruiter") < routed.body.result.content[0].text.indexOf("# Vet guide"));

  assert.equal(contextLoads, 1);
  assert.deepEqual(readPaths, ["_JA-RULES.md", "recruiter/SKILL.md", "recruiter/modules/vet/GUIDE.md"]);
  assert.doesNotMatch(readPaths.join("\n"), /_TOOL-MAP/);
  assert.deepEqual(assertedPaths, ["_JA-RULES.md", "recruiter/modules/vet/GUIDE.md"]);
});

test("MCP fails closed while AI remains disabled when recruiter startup fails", async () => {
  let contextLoads = 0;
  let factoryCalls = 0;
  const app = await createApp({
    env: testEnv,
    candidateFetch: supabaseFetch,
    authConfig: authenticated,
    recruitmentContextLoader: async () => { contextLoads += 1; return testRecruitmentContext(); },
    mcpHandlerFactory: async () => { factoryCalls += 1; throw new Error("synthetic router read failure"); },
  });
  const headers = { authorization: "Bearer synthetic-review", accept: "application/json, text/event-stream" };
  const supabaseHeaders = { authorization: "Bearer synthetic-supabase", accept: "application/json" };

  assert.equal((await request(app, "GET", "/api/mcp/discovery", { headers })).status, 503);
  assert.equal((await request(app, "POST", "/api/workflows/after-call/prepare", { headers: supabaseHeaders, body: {} })).body.error.code, "AI_DISABLED");
  assert.equal((await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } })).status, 503);
  assert.equal(contextLoads, 1);
  assert.equal(factoryCalls, 1);
});

test("external package manifest and every packaged asset validate", async () => {
  const authority = await loadRecruitmentAuthority();
  assert.equal(authority.id, "recruiter");
  assert.equal(authority.capabilities.find((item) => item.id === "interview-prep-material")?.path, "recruiter/modules/interview-prep-material/GUIDE.md");
  assert.throws(() => discoverMcp({ id: "other" }));
  assert.throws(() => validateRecruitmentManifest({ front_door: { id: "resume", path: "x" }, policies: [], capabilities: [] }));
  assert.throws(() => validateRecruitmentManifest({ front_door: { id: "recruiter", path: "x" }, policies: ["_TOOL-MAP.md"], capabilities: [] }), /mandatory Ja rules/);
  await assert.rejects(() => validatePublishedRecruitmentAssets({ readSkillText: async () => JSON.stringify({ front_door: { id: "recruiter", path: "recruiter/SKILL.md" }, policies: ["_JA-RULES.md"], capabilities: [{ id: "valid", path: "missing.md" }] }), assertSkillFile: async () => { throw new Error("missing packaged asset"); } }), /missing packaged asset/);
});

test("Gmail routes are not registered and test-only storage does not expose durability", async () => {
  const app = await createApp({ env: testEnv, recruitmentContextLoader: testRecruitmentContext });
  const paths = app._router.stack.flatMap((layer) => layer.route ? [layer.route.path] : []);
  assert.equal(paths.some((path) => String(path).startsWith("/api/mail")), false);
});

test("public safety status contains only supported fields", async () => {
  const app = await createApp({ env: testEnv, recruitmentContextLoader: testRecruitmentContext });
  const response = await request(app, "GET", "/api/safety");
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["auth", "externalWrites", "storage"]);
  assert.equal(response.body.externalWrites, false);
});

test("after-call endpoint is disabled even when model credentials are configured", async () => {
  const app = await createApp({ env: { ...testEnv, ANTHROPIC_API_KEY: "configured-key" }, candidateFetch: supabaseFetch, authConfig: authenticated, recruitmentContextLoader: testRecruitmentContext });
  const response = await request(app, "POST", "/api/workflows/after-call/prepare", {
    headers: { authorization: "Bearer synthetic-supabase" },
    body: { candidateId: "sourcing:7", name: "Avery Sampleton", title: "Maintenance Supervisor", resumeText: "Avery Sampleton led 12 maintenance technicians.", jobDescription: "Maintenance Manager" },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, "AI_DISABLED");
  assert.match(response.body.error.message, /disabled/i);
});

test("after-call gateway accepts bounded source bundles and returns a clear 413 beyond its JSON ceiling", async () => {
  const app = await createApp({ env: testEnv, candidateFetch: supabaseFetch, authConfig: authenticated, recruitmentContextLoader: testRecruitmentContext });
  const headers = { authorization: "Bearer synthetic-supabase" };
  const bounded = await request(app, "POST", "/api/workflows/after-call/prepare", {
    headers,
    body: { candidateId: "sourcing:7", name: "Avery Sampleton", title: "Maintenance Supervisor", resumeText: "Resume evidence. ".repeat(9000), jobDescription: "Maintenance Manager", transcriptText: "Call evidence. ".repeat(700) },
  });
  assert.equal(bounded.status, 409);
  assert.equal(bounded.body.error.code, "AI_DISABLED");

  const oversized = await request(app, "POST", "/api/workflows/after-call/prepare", {
    headers,
    body: { candidateId: "sourcing:7", resumeText: "x".repeat(5 * 1024 * 1024 + 1) },
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, "PAYLOAD_TOO_LARGE");
  assert.match(oversized.body.error.message, /shorten the source text or split the transcript/i);
});

test("real gateway parser accepts reviewed import confirmations through the 10,000-row cap", async () => {
  const confirmSizes = [];
  const importStore = {
    async verifyUser() { return { id: supabaseUserId, email: "review@example.invalid" }; },
    async request(_token, path, options = {}) {
      assert.equal(path, "rpc/confirm_tracker_import");
      const count = options.body?.p_rows?.length || 0;
      confirmSizes.push(count);
      return { status: "confirmed", importedCount: count, rows: [] };
    },
  };
  const app = await createApp({
    env: { ...testEnv, SUPABASE_URL: "https://supabase.example", SUPABASE_PUBLISHABLE_KEY: "public-key" },
    candidateFetch: supabaseFetch,
    authConfig: authenticated,
    trackerImportDependencies: { store: importStore },
    recruitmentContextLoader: testRecruitmentContext,
  });
  const runId = "33333333-3333-4333-8333-333333333333";
  const makeRows = (count) => Array.from({ length: count }, (_, index) => ({
    sourceRowKey: `upload:44444444-4444-4444-8444-444444444444:email:candidate${index + 1}@example.test`,
    action: "insert",
  }));
  const headers = { authorization: "Bearer synthetic-supabase" };

  const ordinaryBatch = await request(app, "POST", `/api/tracker-imports/${runId}/confirm`, {
    headers, body: { confirm: true, rows: makeRows(1536) },
  });
  assert.equal(ordinaryBatch.status, 200);
  assert.equal(confirmSizes.at(-1), 1536);

  const maximumBatch = await request(app, "POST", `/api/tracker-imports/${runId}/confirm`, {
    headers, body: { confirm: true, rows: makeRows(10000) },
  });
  assert.equal(maximumBatch.status, 200);
  assert.equal(confirmSizes.at(-1), 10000);

  const overLimitBatch = await request(app, "POST", `/api/tracker-imports/${runId}/confirm`, {
    headers, body: { confirm: true, rows: makeRows(10001) },
  });
  assert.equal(overLimitBatch.status, 400);
  assert.deepEqual(confirmSizes, [1536, 10000]);
});
