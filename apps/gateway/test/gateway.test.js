import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { createApp } from "../app.js";
import { createConfiguredAuth, parseAllowedGoogleEmails, parseExactHttpsOrigins } from "../src/auth.js";
import { prepareAfterCallWorkflow } from "../src/after-call.js";
import { createDraftOnlyMailService } from "../src/gmail.js";
import { assertReadOnlyCypher, createReadOnlyNeo4jAdapter, stripCypherLiteralsAndComments } from "../src/neo4j.js";
import { discoverMcp, loadRecruitmentAuthority, validatePublishedRecruitmentAssets, validateRecruitmentManifest } from "../src/recruitment-package.js";
import { createMemoryTestStorage, requireDurableStorage } from "../src/storage.js";

const browserOrigin = "https://console.test";
const testEnv = { APP_TRUSTED_ORIGINS: browserOrigin };
const testAuthority = async () => ({ id: "recruiter", routerPath: "recruiter/SKILL.md", capabilities: [] });
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

async function request(app, method, path, { body, rawBody, headers = {} } = {}) {
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    return await new Promise((resolve, reject) => {
      const resolvedHeaders = { ...headers };
      if (resolvedHeaders.origin === "__same__") resolvedHeaders.origin = `http://localhost:${server.address().port}`;
      const req = httpRequest({ port: server.address().port, path, method, headers: { ...resolvedHeaders, ...(payload ? { ...(!headers["content-type"] ? { "content-type": "application/json" } : {}), "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
      });
      req.on("error", reject);
      req.end(payload);
    });
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("public routes work server-to-server while browser CORS is strict", async () => {
  const app = await createApp({ env: testEnv, recruitmentContextLoader: testRecruitmentContext });
  assert.equal((await request(app, "GET", "/healthz")).status, 200);
  const allowed = await request(app, "OPTIONS", "/mcp", { headers: { origin: browserOrigin } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], browserOrigin);
  assert.equal(allowed.headers["access-control-allow-credentials"], "true");
  assert.equal((await request(app, "GET", "/healthz", { headers: { origin: "https://untrusted.test" } })).status, 403);
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

test("every non-public API route requires Better Auth session", async () => {
  const noAuth = await createApp({ env: testEnv, recruitmentContextLoader: testRecruitmentContext });
  assert.equal((await request(noAuth, "GET", "/api/mcp/discovery")).status, 503);
  const app = await createApp({ env: testEnv, recruitmentContextLoader: testRecruitmentContext, authConfig: authenticated });
  assert.equal((await request(app, "GET", "/api/mcp/discovery")).status, 401);
  assert.equal((await request(app, "POST", "/api/meetings/transcribe", { rawBody: Buffer.from("audio"), headers: { "content-type": "audio/mp4" } })).status, 401);
  assert.equal((await request(app, "POST", "/mcp", { body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } })).status, 401);
  assert.equal((await request(app, "GET", "/api/mcp/discovery", { headers: { authorization: "Bearer synthetic-unapproved" } })).status, 403);
  assert.equal((await request(app, "GET", "/api/mcp/discovery", { headers: { authorization: "Bearer synthetic-missing-email" } })).status, 403);
  const discovery = await request(app, "GET", "/api/mcp/discovery", { headers: { authorization: "Bearer synthetic-review" } });
  assert.equal(discovery.status, 200);
  assert.deepEqual(discovery.body.tools.map((tool) => tool.id), ["recruiter", "workspace_status"]);
});

test("meeting transcription stays authenticated and uses the injected local adapter", async () => {
  const calls = [];
  const app = await createApp({
    env: testEnv,
    recruitmentContextLoader: testRecruitmentContext,
    authConfig: authenticated,
    transcriptionAdapter: {
      available: async () => true,
      transcribe: async (input) => {
        calls.push(input);
        return { transcript: "Source audio words.", source: "muesli_cli" };
      },
    },
  });
  const response = await request(app, "POST", "/api/meetings/transcribe", {
    rawBody: Buffer.from("synthetic-audio"),
    headers: { authorization: "Bearer synthetic-review", "content-type": "audio/mp4" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, transcript: "Source audio words.", source: "muesli_cli" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].contentType, "audio/mp4");
  assert.deepEqual(calls[0].audio, Buffer.from("synthetic-audio"));
});

test("explicit local trusted mode bypasses login only for meeting transcription", async () => {
  const app = await createApp({
    env: { LOCAL_TRUSTED_MODE: "1" },
    recruitmentContextLoader: testRecruitmentContext,
    authConfig: { enabled: false, reason: "Authentication unavailable" },
    transcriptionAdapter: {
      available: async () => true,
      transcribe: async () => ({ transcript: "Local source audio.", source: "muesli_cli" }),
    },
  });
  const transcription = await request(app, "POST", "/api/meetings/transcribe", {
    rawBody: Buffer.from("synthetic-audio"),
    headers: { "content-type": "audio/wav", origin: "__same__" },
  });
  assert.equal(transcription.status, 200);
  assert.equal(transcription.body.transcript, "Local source audio.");
  assert.equal((await request(app, "GET", "/api/mcp/discovery")).status, 503);

  const wrongFlag = await createApp({
    env: { LOCAL_TRUSTED_MODE: "true" },
    recruitmentContextLoader: testRecruitmentContext,
    authConfig: { enabled: false, reason: "Authentication unavailable" },
  });
  assert.equal((await request(wrongFlag, "POST", "/api/meetings/transcribe", {
    rawBody: Buffer.from("synthetic-audio"),
    headers: { "content-type": "audio/wav" },
  })).status, 503);
});

test("MCP initializes and lists only recruiter plus read-only status", async () => {
  const app = await createApp({ env: testEnv, authConfig: authenticated });
  const headers = { authorization: "Bearer synthetic-review", accept: "application/json, text/event-stream" };
  const initialize = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "synthetic", version: "1" } } } });
  assert.equal(initialize.status, 200);
  const listed = await request(app, "POST", "/mcp", { headers, body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.result.tools.map((tool) => tool.name).sort(), ["recruiter", "workspace_status"]);
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
    authConfig: authenticated,
    recruitmentContextLoader: async () => { contextLoads += 1; return context; },
  });
  const headers = { authorization: "Bearer synthetic-review", accept: "application/json, text/event-stream" };

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

test("all recruiter routes fail together when MCP startup initialization fails", async () => {
  let contextLoads = 0;
  let factoryCalls = 0;
  const app = await createApp({
    env: testEnv,
    authConfig: authenticated,
    recruitmentContextLoader: async () => { contextLoads += 1; return testRecruitmentContext(); },
    mcpHandlerFactory: async () => { factoryCalls += 1; throw new Error("synthetic router read failure"); },
  });
  const headers = { authorization: "Bearer synthetic-review", accept: "application/json, text/event-stream" };

  assert.equal((await request(app, "GET", "/api/mcp/discovery", { headers })).status, 503);
  assert.equal((await request(app, "POST", "/api/workflows/after-call/prepare", { headers, body: {} })).status, 503);
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

test("draft-only mail and test-only storage do not expose external write methods", async () => {
  const service = createDraftOnlyMailService({ createDraft: async (message) => message });
  assert.deepEqual((await service.createDraft({ to: "review@example.invalid", subject: "Draft", body: "Review" })).labels, ["DRAFT"]);
  assert.equal("send" in service, false);
  const storage = createMemoryTestStorage();
  await storage.put("x", { value: 1 });
  assert.deepEqual(await storage.get("x"), { value: 1 });
  assert.throws(() => requireDurableStorage(storage), { code: "STORAGE_UNAVAILABLE" });
});

test("Neo4j stays disabled without a driver and blocks bypass attempts", async () => {
  const graph = createReadOnlyNeo4jAdapter();
  assert.deepEqual(await graph.read("MATCH (n) RETURN n"), { available: false, records: [] });
  for (const query of ["MATCH (n) SET n.x = 1 RETURN n", "WITH 1 AS n CREATE (x) RETURN x", "MATCH (n) RETURN n; MATCH (m) RETURN m", "CALL db.labels()", "MATCH (n) // SET n.x = 1\n RETURN n"]) {
    if (query.includes("//")) assert.doesNotThrow(() => assertReadOnlyCypher(query));
    else assert.throws(() => assertReadOnlyCypher(query), { code: "NEO4J_WRITE_REJECTED" });
  }
  assert.equal(stripCypherLiteralsAndComments("MATCH (n {note: 'CREATE'}) RETURN n").includes("CREATE"), false);
  await assert.rejects(() => graph.write("anything"), { code: "NEO4J_WRITE_REJECTED" });
});

test("full synthetic after-call output is recruiter-authorized, draft-only, and source-backed", () => {
  const facts = [
    { label: "Team leadership", value: "Led 12 maintenance technicians", source: "resume", evidence: "led 12 maintenance technicians" },
    { label: "Availability", value: "Two weeks notice", source: "transcript", evidence: "two weeks notice" },
    { label: "Work preference", value: "Open to Exampleton", source: "call_notes", evidence: "open to exampleton" },
  ];
  const output = prepareAfterCallWorkflow({ name: "Avery Sampleton", title: "Maintenance Supervisor", resumeText: "Synthetic resume: Led   12 maintenance TECHNICIANS.", transcriptText: "Synthetic transcript: Two weeks notice.", jobDescription: "Synthetic job", callNotes: "Synthetic call notes: Open to Exampleton.", verifiedFacts: facts }, { id: "recruiter" });
  assert.equal(output.authority, "recruiter");
  assert.equal(output.reviewRequired, true);
  assert.deepEqual(output.audit.providedSources, ["resume", "transcript", "call_notes"]);
  assert.deepEqual(output.audit.missingSources, []);
  assert.deepEqual(output.audit.supportedClaims, facts);
  const text = JSON.stringify(output);
  for (const fact of facts) assert.match(text, new RegExp(fact.value));
  assert.equal(output.brandedResume.status, "draft");
  assert.equal(output.submission.status, "draft");
  assert.equal(output.presentationEmail.status, "draft");
  assert.equal(output.loxoDraft.status, "draft");
  assert.doesNotMatch(text, /send|submit|write|external action/i);
});

test("after-call preparation rejects fabricated evidence and evidence without its declared source", () => {
  const baseline = { name: "Avery Sampleton", title: "Maintenance Supervisor", resumeText: "Led 12 maintenance technicians.", jobDescription: "Synthetic job", verifiedFacts: [] };
  assert.throws(() => prepareAfterCallWorkflow({ ...baseline, verifiedFacts: [{ label: "Fabricated evidence", value: "Led 12 maintenance technicians", source: "resume", evidence: "managed a plant" }] }, { id: "recruiter" }), /evidence is not present/);
  assert.throws(() => prepareAfterCallWorkflow({ ...baseline, verifiedFacts: [{ label: "Fabricated value", value: "Managed a plant", source: "resume", evidence: "led 12 maintenance technicians" }] }, { id: "recruiter" }), /value is not present/);
  assert.throws(() => prepareAfterCallWorkflow({ ...baseline, verifiedFacts: [{ label: "Availability", value: "Two weeks notice", source: "transcript", evidence: "two weeks notice" }] }, { id: "recruiter" }), /source is missing/);
});
