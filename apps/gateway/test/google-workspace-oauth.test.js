import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_WORKSPACE_SCOPES,
  createGoogleWorkspaceApiClients,
  exchangeGoogleWorkspaceAuthorizationCode,
  generateGoogleWorkspaceAuthorizationUrl,
  readGoogleWorkspaceOAuthConfig,
  scopesForGoogleWorkspaceStages,
} from "../src/google-workspace-oauth.js";

const oauthEnv = Object.freeze({
  GOOGLE_WORKSPACE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
  GOOGLE_WORKSPACE_CLIENT_SECRET: "synthetic-client-secret-for-tests",
  GOOGLE_WORKSPACE_REDIRECT_URI: "https://gateway.test/oauth/google-workspace/callback",
});

const state = "synthetic_state_value_1234567890_abcd";

test("Google Workspace OAuth configuration fails closed", () => {
  assert.deepEqual(readGoogleWorkspaceOAuthConfig(oauthEnv), {
    clientId: oauthEnv.GOOGLE_WORKSPACE_CLIENT_ID,
    clientSecret: oauthEnv.GOOGLE_WORKSPACE_CLIENT_SECRET,
    redirectUri: oauthEnv.GOOGLE_WORKSPACE_REDIRECT_URI,
  });

  for (const env of [
    {},
    { ...oauthEnv, GOOGLE_WORKSPACE_CLIENT_ID: "not-a-google-client" },
    { ...oauthEnv, GOOGLE_WORKSPACE_CLIENT_SECRET: "short" },
    { ...oauthEnv, GOOGLE_WORKSPACE_REDIRECT_URI: "http://gateway.test/callback" },
    { ...oauthEnv, GOOGLE_WORKSPACE_REDIRECT_URI: "https://gateway.test/" },
    { ...oauthEnv, GOOGLE_WORKSPACE_REDIRECT_URI: "https://gateway.test/callback?token=bad" },
  ]) {
    assert.throws(() => readGoogleWorkspaceOAuthConfig(env), { code: "GOOGLE_WORKSPACE_OAUTH_CONFIG_INVALID" });
  }

  assert.equal(
    readGoogleWorkspaceOAuthConfig({ ...oauthEnv, GOOGLE_WORKSPACE_REDIRECT_URI: "http://127.0.0.1:3000/oauth/callback" }).redirectUri,
    "http://127.0.0.1:3000/oauth/callback",
  );
});

test("OAuth scopes are staged, read-only, and never grant send authority", () => {
  assert.deepEqual(scopesForGoogleWorkspaceStages(["gmail"]), [...GOOGLE_WORKSPACE_SCOPES.identity, ...GOOGLE_WORKSPACE_SCOPES.gmail]);
  assert.deepEqual(scopesForGoogleWorkspaceStages(["calendar", "drive"]), [
    ...GOOGLE_WORKSPACE_SCOPES.identity,
    ...GOOGLE_WORKSPACE_SCOPES.calendar,
    ...GOOGLE_WORKSPACE_SCOPES.drive,
  ]);
  assert.throws(() => scopesForGoogleWorkspaceStages(["send"]), { code: "GOOGLE_WORKSPACE_OAUTH_INPUT_INVALID" });

  const allScopes = scopesForGoogleWorkspaceStages(["gmail", "calendar", "drive"]);
  assert.equal(allScopes.some((scope) => /gmail\.(?:send|compose|modify)$/.test(scope)), false);
  assert.equal(allScopes.some((scope) => /calendar\.events$/.test(scope)), false);
  assert.equal(allScopes.includes("https://www.googleapis.com/auth/drive"), false);
});

test("authorization URL requests offline incremental consent for only selected stages", () => {
  const value = generateGoogleWorkspaceAuthorizationUrl({ env: oauthEnv, stages: ["gmail"], state, loginHint: "review@example.invalid" });
  const url = new URL(value);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(url.searchParams.get("login_hint"), "review@example.invalid");
  assert.deepEqual(url.searchParams.get("scope").split(" "), [...GOOGLE_WORKSPACE_SCOPES.identity, ...GOOGLE_WORKSPACE_SCOPES.gmail]);
  assert.doesNotMatch(url.searchParams.get("scope"), /gmail\.(?:send|compose|modify)/);
  assert.throws(() => generateGoogleWorkspaceAuthorizationUrl({ env: oauthEnv, stages: ["gmail"], state: "weak" }), { code: "GOOGLE_WORKSPACE_OAUTH_INPUT_INVALID" });
});

test("code exchange sets credentials in memory without making a real network call", async () => {
  const observed = {};
  class FakeOAuth2Client {
    constructor(config) { observed.config = config; }
    async getToken(code) {
      observed.code = code;
      return { tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", expiry_date: 12345 } };
    }
    setCredentials(credentials) { observed.credentials = credentials; }
  }

  const result = await exchangeGoogleWorkspaceAuthorizationCode(
    { env: oauthEnv, code: "synthetic-authorization-code" },
    { OAuth2ClientClass: FakeOAuth2Client },
  );
  assert.deepEqual(observed.config, {
    clientId: oauthEnv.GOOGLE_WORKSPACE_CLIENT_ID,
    clientSecret: oauthEnv.GOOGLE_WORKSPACE_CLIENT_SECRET,
    redirectUri: oauthEnv.GOOGLE_WORKSPACE_REDIRECT_URI,
  });
  assert.equal(observed.code, "synthetic-authorization-code");
  assert.deepEqual(observed.credentials, result.credentials);
  assert.equal(Object.isFrozen(result.credentials), true);
  assert.equal("save" in result, false);
  assert.equal("persist" in result, false);
});

test("API clients are created for Gmail, Calendar, and Drive without API calls", () => {
  const observed = [];
  class FakeOAuth2Client {
    setCredentials(credentials) { this.credentials = credentials; }
  }
  const googleApis = Object.fromEntries(["gmail", "calendar", "drive"].map((service) => [
    service,
    (options) => { observed.push({ service, options }); return { service, options }; },
  ]));

  const clients = createGoogleWorkspaceApiClients(
    { env: oauthEnv, credentials: { refresh_token: "synthetic-refresh" } },
    { OAuth2ClientClass: FakeOAuth2Client, googleApis },
  );
  assert.deepEqual(observed.map(({ service, options }) => [service, options.version]), [
    ["gmail", "v1"],
    ["calendar", "v3"],
    ["drive", "v3"],
  ]);
  assert.equal(observed.every(({ options }) => options.auth === clients.oauth2Client), true);
  assert.deepEqual(clients.oauth2Client.credentials, { refresh_token: "synthetic-refresh" });
});
