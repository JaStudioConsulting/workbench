import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { createApp } from "../app.js";
import { createConfiguredAuth, parseExactHttpsOrigins } from "../src/auth.js";
import { prepareAfterCallWorkflow } from "../src/after-call.js";
import { createDraftOnlyMailService } from "../src/gmail.js";
import { assertReadOnlyCypher, createReadOnlyNeo4jAdapter, stripCypherLiteralsAndComments } from "../src/neo4j.js";
import { discoverMcp, loadRecruitmentAuthority, validatePublishedRecruitmentAssets, validateRecruitmentManifest } from "../src/recruitment-package.js";
import { createMemoryTestStorage, requireDurableStorage } from "../src/storage.js";

const browserOrigin = "https://console.test";
const testEnv = { APP_TRUSTED_ORIGINS: browserOrigin };
const testAuthority = async () => ({ id: "recruiter", routerPath: "recruiter/SKILL.md", capabilities: [] });
const authenticated = {
  enabled: true,
  handler: (_req, res) => res.status(404).end(),
  getSession: async (req) => req.headers.authorization === "Bearer synthetic-review" ? { session: { id: "synthetic-session" } } : null,
};

async function request(app, method, path, { body, headers = {} } = {}) {
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const req = httpRequest({ port: server.address().port, path, method, headers: { ...headers, ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
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
  const app = await createApp({ env: testEnv, authorityLoader: testAuthority });
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
  assert.equal((await createConfiguredAuth({ BETTER_AUTH_URL: "not-a-url" })).enabled, false);
  assert.equal((await createConfiguredAuth({ DATABASE_URL: "configured", BETTER_AUTH_URL: browserOrigin, BETTER_AUTH_SECRET: "short", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", AUTH_TRUSTED_ORIGINS: browserOrigin })).enabled, false);
});

test("every non-public API route requires Better Auth session", async () => {
  const noAuth = await createApp({ env: testEnv, authorityLoader: testAuthority });
  assert.equal((await request(noAuth, "GET", "/api/mcp/discovery")).status, 503);
  const app = await createApp({ env: testEnv, authorityLoader: testAuthority, authConfig: authenticated });
  assert.equal((await request(app, "GET", "/api/mcp/discovery")).status, 401);
  assert.equal((await request(app, "POST", "/mcp", { body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } })).status, 401);
  const discovery = await request(app, "GET", "/api/mcp/discovery", { headers: { authorization: "Bearer synthetic-review" } });
  assert.equal(discovery.status, 200);
  assert.deepEqual(discovery.body.tools.map((tool) => tool.id), ["recruiter", "workspace_status"]);
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
  assert.doesNotMatch(JSON.stringify(listed.body), /gmail|loxo|submit|approve|neo4j/i);
});

test("external package manifest and every packaged asset validate", async () => {
  const authority = await loadRecruitmentAuthority();
  assert.equal(authority.id, "recruiter");
  assert.throws(() => discoverMcp({ id: "other" }));
  assert.throws(() => validateRecruitmentManifest({ front_door: { id: "resume", path: "x" }, policies: [], capabilities: [] }));
  await assert.rejects(() => validatePublishedRecruitmentAssets({ readSkillText: async () => JSON.stringify({ front_door: { id: "recruiter", path: "recruiter/SKILL.md" }, policies: [], capabilities: [{ id: "valid", path: "missing.md" }] }), assertSkillFile: async () => { throw new Error("missing packaged asset"); } }), /missing packaged asset/);
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
