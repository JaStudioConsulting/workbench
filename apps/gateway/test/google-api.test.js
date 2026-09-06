import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { createApp } from "../app.js";
import { createGoogleApiHandlers, createGoogleApiService } from "../src/google-api.js";
import { createGoogleWorkspaceHandlers } from "../src/google-workspace-routes.js";

function fakeRequest(body) {
  return { body, headers: {} };
}

const browserOrigin = "https://console.test";
const routeAuth = {
  enabled: true,
  handler: (_req, res) => res.status(404).end(),
  isApprovedEmail: (email) => email === "review@example.invalid",
  getSession: async (req) => sessionFor(req),
  getAuthoritativeSession: async (req) => sessionFor(req),
};
function sessionFor(req) {
  if (req.headers.authorization === "Bearer approved") return { session: { id: "s1", userId: "u1" }, user: { id: "u1", email: "review@example.invalid" } };
  if (req.headers.authorization === "Bearer unapproved") return { session: { id: "s2", userId: "u2" }, user: { id: "u2", email: "other@example.invalid" } };
  return null;
}
async function routeRequest(app, method, path, body, authorization) {
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const req = httpRequest({ port: server.address().port, path, method, headers: { ...(authorization ? { authorization } : {}), ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      });
      req.on("error", reject);
      req.end(payload);
    });
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("Google API service reads bounded Sheets values through the injected client", async () => {
  let call;
  const service = createGoogleApiService({
    auth: { getGoogleProviderAccessToken: async () => ({ accessToken: "user-token", scopes: ["https://www.googleapis.com/auth/spreadsheets"] }) },
    apiClientsFactory: async (token) => ({
      sheets: { spreadsheets: { values: { get: async (options) => { call = { token, options }; return { data: { values: [["Ja", 42], ["x".repeat(3000)]] } }; } } } },
    }),
  });
  const result = await service.sync(fakeRequest({ service: "sheets", spreadsheetId: "tracker-id", range: "Tracker!A1:B2" }));
  assert.deepEqual(call, { token: "user-token", options: { spreadsheetId: "tracker-id", range: "Tracker!A1:B2" } });
  assert.equal(result.rows[0][1], "42");
  assert.equal(result.rows[1][0].length, 2000);
});

test("Google API service reads only Gmail thread IDs and enforces the required scope", async () => {
  const service = createGoogleApiService({
    auth: { getGoogleProviderAccessToken: async () => ({ accessToken: "user-token", scopes: ["https://www.googleapis.com/auth/gmail.readonly"] }) },
    apiClientsFactory: async () => ({
      gmail: { users: { threads: { list: async () => ({ data: { threads: [{ id: "thread-1", snippet: "private" }] } }) } } },
    }),
  });
  assert.deepEqual(await service.sync(fakeRequest({ service: "gmail", query: "is:unread", maxResults: 1 })), { service: "gmail", threads: [{ id: "thread-1" }] });

  const denied = createGoogleApiService({
    auth: { getGoogleProviderAccessToken: async () => ({ accessToken: "user-token", scopes: [] }) },
    apiClientsFactory: async () => ({}),
  });
  await assert.rejects(() => denied.sync(fakeRequest({ service: "gmail" })), { code: "GOOGLE_SCOPE_REQUIRED" });
});

test("Google API service rejects malformed or disconnected requests", async () => {
  const disconnected = createGoogleApiService({ auth: { getGoogleProviderAccessToken: async () => null } });
  await assert.rejects(() => disconnected.sync(fakeRequest({ service: "gmail", unexpected: true })), { name: "ZodError" });
  await assert.rejects(() => disconnected.sync(fakeRequest({ service: "gmail" })), { code: "GOOGLE_ACCOUNT_NOT_CONNECTED" });
});

test("/api/gws/sync enforces authoritative sessions and rejects browser token/account fields", async () => {
  const base = { env: { APP_TRUSTED_ORIGINS: browserOrigin }, authConfig: routeAuth, recruitmentContextLoader: async () => ({ authority: { id: "recruiter", capabilities: [] }, pkg: { readSkillText: async () => "# Recruiter", assertSkillFile: async () => {} } }) };
  const noSession = await routeRequest(await createApp(base), "POST", "/api/gws/sync", { service: "gmail" });
  assert.equal(noSession.status, 401);
  const unapproved = await routeRequest(await createApp(base), "POST", "/api/gws/sync", { service: "gmail" }, "Bearer unapproved");
  assert.equal(unapproved.status, 403);
  const malformedHandlers = createGoogleApiHandlers({ auth: { getGoogleProviderAccessToken: async () => ({ accessToken: "server-token", scopes: ["https://www.googleapis.com/auth/gmail.readonly"] }) }, apiClientsFactory: async () => ({ gmail: { users: { threads: { list: async () => ({ data: { threads: [] } }) } } } }) });
  const forbiddenAccountKey = "account" + "Id";
  const forbiddenTokenKey = "access" + "Token";
  const malformed = await routeRequest(await createApp({ ...base, googleApiHandlers: malformedHandlers }), "POST", "/api/gws/sync", { service: "gmail", [forbiddenTokenKey]: "browser-token", [forbiddenAccountKey]: "other-user" }, "Bearer approved");
  assert.equal(malformed.status, 400);
});

test("/api/gws/sync fails closed without provider helper and accepts approved injected handler", async () => {
  const context = async () => ({ authority: { id: "recruiter", capabilities: [] }, pkg: { readSkillText: async () => "# Recruiter", assertSkillFile: async () => {} } });
  const noHelper = await createApp({ env: { APP_TRUSTED_ORIGINS: browserOrigin }, authConfig: { ...routeAuth }, recruitmentContextLoader: context });
  assert.equal((await routeRequest(noHelper, "POST", "/api/gws/sync", { service: "gmail" }, "Bearer approved")).status, 503);
  const injected = await createApp({ env: { APP_TRUSTED_ORIGINS: browserOrigin }, authConfig: routeAuth, recruitmentContextLoader: context, googleApiHandlers: { sync: (_req, res) => res.status(200).json({ service: "gmail", threads: [{ id: "thread-1" }] }) } });
  const success = await routeRequest(injected, "POST", "/api/gws/sync", { service: "gmail" }, "Bearer approved");
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, { service: "gmail", threads: [{ id: "thread-1" }] });
});

test("Calendar status and upcoming reads prefer the current Better Auth provider grant", async () => {
  const calls = [];
  const auth = {
    enabled: true,
    pool: {},
    isApprovedEmail: () => true,
    getGoogleProviderAccessToken: async (req) => ({ accessToken: req.workbenchSession.user.id === "u1" ? "u1-token" : "u2-token", scopes: ["https://www.googleapis.com/auth/calendar.readonly"] }),
  };
  const handlers = createGoogleWorkspaceHandlers({
    auth,
    env: { GOOGLE_WORKSPACE_CLIENT_ID: "client.apps.googleusercontent.com", GOOGLE_WORKSPACE_CLIENT_SECRET: "1234567890123456", GOOGLE_WORKSPACE_REDIRECT_URI: "https://gateway.test/oauth/callback", GOOGLE_WORKSPACE_RETURN_URI: "https://console.test/settings", APP_TRUSTED_ORIGINS: "https://console.test" },
    credentialStore: { load: async () => { throw new Error("legacy store must not be called"); } },
    stateStore: {},
    providerCalendar: { readUpcomingEvents: async ({ accessToken }) => { calls.push(accessToken); return { connected: true, range: { from: "2026-09-05T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z" }, events: [] }; } },
  });
  const req = { workbenchSession: { session: { id: "s1", userId: "u1" }, user: { id: "u1", email: "review@example.invalid" } } };
  let statusBody;
  await handlers.status(req, { set: () => {}, json: (body) => { statusBody = body; }, status: () => ({ json: () => {} }) });
  assert.equal(statusBody.connected, true);
  let upcomingBody;
  await handlers.upcomingEvents(req, { set: () => {}, json: (body) => { upcomingBody = body; }, status: () => ({ json: () => {} }) });
  assert.equal(upcomingBody.connected, true);
  assert.deepEqual(calls, ["u1-token"]);
});

test("Default Better Auth Workspace mode needs no legacy OAuth configuration", async () => {
  const auth = {
    enabled: true,
    pool: {},
    isApprovedEmail: () => true,
    getGoogleProviderAccessToken: async () => ({ accessToken: "provider-token", scopes: ["https://www.googleapis.com/auth/calendar.readonly"] }),
  };
  const handlers = createGoogleWorkspaceHandlers({ auth, env: {}, providerCalendar: { readUpcomingEvents: async () => ({ connected: true, range: { from: "2026-09-05T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z" }, events: [] }) } });
  assert.equal(handlers.enabled, true);
  assert.equal(handlers.legacyEnabled, false);
  let statusBody;
  await handlers.status({ workbenchSession: { session: { id: "s1", userId: "u1" }, user: { id: "u1", email: "review@example.invalid" } } }, { set: () => {}, json: (body) => { statusBody = body; } });
  assert.equal(statusBody.connected, true);
});
