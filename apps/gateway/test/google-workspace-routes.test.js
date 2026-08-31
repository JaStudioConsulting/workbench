import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { createApp } from "../app.js";

const browserOrigin = "https://console.test";
const calendarScope = "https://www.googleapis.com/auth/calendar.readonly";
const env = Object.freeze({
  APP_TRUSTED_ORIGINS: browserOrigin,
  AUTH_TRUSTED_ORIGINS: browserOrigin,
  GOOGLE_WORKSPACE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  GOOGLE_WORKSPACE_CLIENT_SECRET: "synthetic-client-secret-for-tests",
  GOOGLE_WORKSPACE_REDIRECT_URI: "https://gateway.test/api/google-workspace/oauth/callback",
  GOOGLE_WORKSPACE_RETURN_URI: "https://console.test/settings",
});

const sessions = Object.freeze({
  review: { session: { id: "session-a", userId: "user-a" }, user: { id: "user-a", email: "review@example.invalid" } },
  alternate: { session: { id: "session-b", userId: "user-a" }, user: { id: "user-a", email: "review@example.invalid" } },
  forbidden: { session: { id: "session-c", userId: "user-b" }, user: { id: "user-b", email: "other@example.invalid" } },
  mismatched: { session: { id: "session-d", userId: "user-a" }, user: { id: "user-b", email: "review@example.invalid" } },
});

function createAuth() {
  const getSession = async (req) => sessions[req.headers.authorization?.replace("Bearer ", "")] ?? null;
  return {
    enabled: true,
    pool: {},
    handler: (_req, res) => res.status(404).end(),
    isApprovedEmail: (email) => email === "review@example.invalid",
    getSession,
    getAuthoritativeSession: getSession,
  };
}

class MemoryStateStore {
  constructor(now) { this.now = now; this.rows = new Map(); this.created = []; }
  async create(value) {
    const row = { ...value, expiresAt: new Date(this.now().getTime() + 600_000) };
    this.created.push(row);
    this.rows.set(row.state, row);
    return { expiresAt: row.expiresAt };
  }
  async consume(value) {
    const row = this.rows.get(value.state);
    if (!row || row.accountId !== value.accountId || row.sessionId !== value.sessionId || row.initiatingEmail !== value.initiatingEmail || row.expiresAt <= this.now()) return null;
    this.rows.delete(value.state);
    return { consumed: true };
  }
}

class MemoryCredentialStore {
  constructor() { this.rows = new Map(); this.revision = 0; this.saved = []; this.forceRevisionRace = false; this.disconnectCalls = 0; this.onMissingLoad = null; }
  async save(value) {
    this.revision += 1;
    const row = { credentials: value.credentials, scopes: value.scopes ?? [], revision: this.revision, connected: true };
    this.rows.set(value.accountId, row);
    this.saved.push(value);
    return { connected: true };
  }
  async load(value) {
    const row = this.rows.get(value) ?? null;
    if (!row && this.onMissingLoad) await this.onMissingLoad(value);
    return row;
  }
  async disconnect(value, options = {}) {
    this.disconnectCalls += 1;
    const row = this.rows.get(value);
    if (!row) return { disconnected: false };
    if (this.forceRevisionRace || (options.revision !== undefined && options.revision !== row.revision)) return { disconnected: false };
    this.rows.delete(value);
    return { disconnected: true };
  }
}

async function request(app, method, path, { body, authorization, origin } = {}) {
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const headers = {
        ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
        ...(origin ? { origin } : {}),
        ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
      };
      const req = httpRequest({ port: server.address().port, path, method, headers }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          const json = res.headers["content-type"]?.includes("application/json") && data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, headers: res.headers, body: json, text: data });
        });
      });
      req.on("error", reject);
      req.end(payload);
    });
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function fixture({ identityEmail = "review@example.invalid", revokeFailure = false } = {}) {
  let currentTime = new Date("2026-08-31T12:00:00.000Z");
  const now = () => new Date(currentTime);
  const states = new MemoryStateStore(now);
  const credentials = new MemoryCredentialStore();
  const observed = { generated: [], exchanged: [], revoked: [] };
  const oauth = {
    generateAuthorizationUrl(value) {
      observed.generated.push(value);
      return `https://accounts.example/authorize?state=${encodeURIComponent(value.state)}`;
    },
    async exchangeCode(value) {
      observed.exchanged.push(value);
      return { oauth2Client: {}, credentials: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", id_token: "synthetic-id", expiry_date: 1_788_200_000_000 } };
    },
    async verifyGrant() { return { subject: "synthetic-subject", email: identityEmail, scopes: ["openid", "email", "profile", calendarScope] }; },
    async revokeCredentials(value) {
      observed.revoked.push(value.credentials.refresh_token);
      if (revokeFailure) throw Object.assign(new Error("hidden provider detail"), { code: "GOOGLE_WORKSPACE_REVOCATION_FAILED" });
      return { revoked: true };
    },
  };
  const app = await createApp({
    env,
    authConfig: createAuth(),
    googleWorkspaceOptions: {
      credentialStore: credentials,
      stateStore: states,
      randomBytesFn: () => Buffer.alloc(32, 9),
      now,
      oauth,
    },
  });
  return { app, states, credentials, observed, advance(ms) { currentTime = new Date(currentTime.getTime() + ms); } };
}

async function start(fx, authorization = "review", body) {
  return request(fx.app, "POST", "/api/google-workspace/oauth/start", { authorization, body, origin: browserOrigin });
}

test("Workspace routes require an approved, internally consistent authoritative session", async () => {
  const fx = await fixture();
  assert.equal((await request(fx.app, "POST", "/api/google-workspace/oauth/start", { origin: browserOrigin })).status, 401);
  assert.equal((await start(fx, "forbidden")).status, 403);
  assert.equal((await start(fx, "mismatched")).status, 401);
});

test("start binds a 256-bit state to the exact session and fixes identity plus Calendar readonly", async () => {
  const fx = await fixture();
  const response = await start(fx, "review", { stages: ["gmail", "drive"] });
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal(fx.states.created.length, 1);
  const created = fx.states.created[0];
  assert.equal(Buffer.from(created.state, "base64url").length, 32);
  assert.equal(created.accountId, sessions.review.user.id);
  assert.equal(created.sessionId, sessions.review.session.id);
  assert.equal(created.initiatingEmail, sessions.review.user.email);
  assert.equal(created.expiresAt.toISOString(), "2026-08-31T12:10:00.000Z");
  assert.deepEqual(fx.observed.generated[0].stages, ["calendar"]);
  assert.equal(fx.observed.generated[0].loginHint, sessions.review.user.email);
  assert.doesNotMatch(response.text, /gmail|drive|synthetic-refresh|synthetic-access/i);
});

test("callback rejects wrong session without consuming, then accepts once for the initiating account", async () => {
  const fx = await fixture();
  const started = await start(fx);
  const state = new URL(started.body.authorizationUrl).searchParams.get("state");
  assert.equal((await request(fx.app, "GET", `/api/google-workspace/oauth/callback?code=synthetic-code&state=${state}`, { authorization: "alternate" })).status, 400);
  assert.equal(fx.states.rows.size, 1);
  const completed = await request(fx.app, "GET", `/api/google-workspace/oauth/callback?code=synthetic-code&state=${state}`, { authorization: "review" });
  assert.equal(completed.status, 303);
  assert.equal(completed.headers.location, "https://console.test/settings?googleWorkspace=connected");
  assert.deepEqual(fx.credentials.saved[0].scopes, ["openid", "email", "profile", calendarScope]);
  assert.equal(fx.credentials.saved[0].accountId, sessions.review.user.id);
  assert.doesNotMatch(completed.text + completed.headers.location, /synthetic-code|synthetic-access|synthetic-refresh|synthetic-id/);
  assert.equal((await request(fx.app, "GET", `/api/google-workspace/oauth/callback?code=synthetic-code&state=${state}`, { authorization: "review" })).status, 400);
});

test("expired, denied, unapproved, and different returned identities never store credentials", async () => {
  const expired = await fixture();
  let response = await start(expired);
  let state = new URL(response.body.authorizationUrl).searchParams.get("state");
  expired.advance(600_001);
  assert.equal((await request(expired.app, "GET", `/api/google-workspace/oauth/callback?code=synthetic-code&state=${state}`, { authorization: "review" })).status, 400);
  assert.equal(expired.credentials.saved.length, 0);

  const denied = await fixture();
  response = await start(denied);
  state = new URL(response.body.authorizationUrl).searchParams.get("state");
  const deniedResponse = await request(denied.app, "GET", `/api/google-workspace/oauth/callback?error=access_denied&state=${state}`, { authorization: "review" });
  assert.equal(deniedResponse.status, 303);
  assert.equal(denied.states.rows.size, 0);

  const forbidden = await fixture({ identityEmail: "other@example.invalid" });
  response = await start(forbidden);
  state = new URL(response.body.authorizationUrl).searchParams.get("state");
  const forbiddenResponse = await request(forbidden.app, "GET", `/api/google-workspace/oauth/callback?code=synthetic-code&state=${state}`, { authorization: "review" });
  assert.equal(forbiddenResponse.status, 403);
  assert.equal(forbidden.credentials.saved.length, 0);
});

test("status is private and token-free, while disconnect revokes before revision-bound removal", async () => {
  const fx = await fixture();
  let response = await request(fx.app, "GET", "/api/google-workspace/status", { authorization: "review", origin: browserOrigin });
  assert.deepEqual(response.body, { connected: false });
  await fx.credentials.save({ accountId: sessions.review.user.id, credentials: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" }, scopes: [calendarScope] });
  response = await request(fx.app, "GET", "/api/google-workspace/status", { authorization: "review", origin: browserOrigin });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { connected: true, account: { email: "review@example.invalid" }, scopes: [calendarScope] });
  assert.doesNotMatch(response.text, /token|synthetic-access|synthetic-refresh/i);
  response = await request(fx.app, "POST", "/api/google-workspace/disconnect", { authorization: "review", origin: browserOrigin });
  assert.deepEqual(response.body, { connected: false });
  assert.deepEqual(fx.observed.revoked, ["synthetic-refresh"]);
  assert.equal(fx.credentials.rows.size, 0);
});

test("status never claims Calendar is connected when the stored grant lacks Calendar scope", async () => {
  const fx = await fixture();
  await fx.credentials.save({
    accountId: sessions.review.user.id,
    credentials: { refresh_token: "synthetic-refresh" },
    scopes: ["openid", "email"],
  });
  const response = await request(fx.app, "GET", "/api/google-workspace/status", { authorization: "review", origin: browserOrigin });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { connected: false });
});

test("revocation failure preserves encrypted connection and revision races do not delete newer credentials", async () => {
  const failed = await fixture({ revokeFailure: true });
  await failed.credentials.save({ accountId: sessions.review.user.id, credentials: { refresh_token: "synthetic-refresh" }, scopes: [calendarScope] });
  let response = await request(failed.app, "POST", "/api/google-workspace/disconnect", { authorization: "review", origin: browserOrigin });
  assert.equal(response.status, 502);
  assert.equal(failed.credentials.rows.size, 1);
  assert.doesNotMatch(response.text, /hidden provider detail|synthetic-refresh/);

  const raced = await fixture();
  await raced.credentials.save({ accountId: sessions.review.user.id, credentials: { refresh_token: "synthetic-refresh" }, scopes: [calendarScope] });
  raced.credentials.forceRevisionRace = true;
  response = await request(raced.app, "POST", "/api/google-workspace/disconnect", { authorization: "review", origin: browserOrigin });
  assert.equal(response.status, 409);
  assert.equal(raced.credentials.rows.size, 1);
});

test("disconnect cannot delete a connection created after an initial missing-row read", async () => {
  const fx = await fixture();
  fx.credentials.onMissingLoad = async (accountId) => {
    await fx.credentials.save({ accountId, credentials: { refresh_token: "new-refresh" }, scopes: [calendarScope] });
  };
  const response = await request(fx.app, "POST", "/api/google-workspace/disconnect", { authorization: "review", origin: browserOrigin });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { connected: false });
  assert.equal(fx.credentials.disconnectCalls, 0);
  assert.equal(fx.credentials.rows.size, 1);
  assert.deepEqual(fx.observed.revoked, []);
});
