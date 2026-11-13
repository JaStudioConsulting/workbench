import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import test from "node:test";
import { isLoopbackAddress, isTrustedLocalSessionRequest, registerLocalSessionRoute } from "../src/local-session.js";

const ORIGIN = "https://jcs-macbook-air.tail8a223f.ts.net";
const OWNER = "5f00e2f9-fef4-4213-a54f-fc79dd8d7752";
const LOGIN = "ja@example.invalid";
const LOGIN_HASH = createHash("sha256").update(LOGIN).digest("hex");
const MACHINE_SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function request(app, { origin = ORIGIN, host = "jcs-macbook-air.tail8a223f.ts.net", login = LOGIN } = {}) {
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try {
    return await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: "127.0.0.1",
        port: server.address().port,
        path: "/api/auth/local-session",
        method: "POST",
        headers: { Host: host, Origin: origin, "Tailscale-User-Login": login, "Content-Length": "0" },
      }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body), headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function setup(t, { secretPath = "", fetchImpl } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "workbench-local-session-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = secretPath || join(directory, "machine-secret");
  if (!secretPath) await writeFile(path, MACHINE_SECRET, { mode: 0o600 });
  const app = express();
  registerLocalSessionRoute(app, {
    env: {
      WORKBENCH_LOCAL_SESSION_ENABLED: "1",
      WORKBENCH_LOCAL_SESSION_OWNER_ID: OWNER,
      WORKBENCH_TAILSCALE_LOGIN_SHA256: LOGIN_HASH,
      WORKBENCH_LOCAL_SESSION_SECRET_FILE: path,
      APP_TRUSTED_ORIGINS: ORIGIN,
    },
    fetchImpl,
  });
  return app;
}

test("local session bootstrap is one-origin, one-tailnet-identity, loopback-only", async (t) => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  for (const address of ["192.168.1.4", "100.100.2.3", "8.8.8.8", "::1%en0"]) {
    assert.equal(isLoopbackAddress(address), address.startsWith("::1%"));
  }
  const app = await setup(t, { fetchImpl: async () => { throw new Error("upstream must not run"); } });
  assert.equal((await request(app, { host: "evil.example" })).status, 403);
  assert.equal((await request(app, { origin: "https://evil.example" })).status, 403);
  assert.equal((await request(app, { login: "other@example.invalid" })).status, 403);

  const requestFromLan = {
    socket: { remoteAddress: "192.168.1.12" },
    headers: {
      origin: ORIGIN,
      host: "jcs-macbook-air.tail8a223f.ts.net",
      "tailscale-user-login": LOGIN,
      "x-forwarded-for": "127.0.0.1",
    },
  };
  assert.equal(isTrustedLocalSessionRequest(requestFromLan, { origins: [ORIGIN], loginHash: LOGIN_HASH }), false);
  assert.equal(isTrustedLocalSessionRequest({
    socket: { remoteAddress: "127.0.0.1" },
    headers: { origin: ORIGIN, host: "jcs-macbook-air.tail8a223f.ts.net", "x-forwarded-for": "127.0.0.1" },
  }, { origins: [ORIGIN], loginHash: LOGIN_HASH }), false);
  assert.equal(isTrustedLocalSessionRequest({
    socket: { remoteAddress: "127.0.0.1" },
    headers: { origin: ORIGIN, host: "jcs-macbook-air.tail8a223f.ts.net:8092", "tailscale-user-login": LOGIN },
  }, { origins: [ORIGIN], loginHash: LOGIN_HASH }), false);
});

test("local bootstrap returns only the approved existing user's ordinary session", async (t) => {
  const app = await setup(t, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://abnfffkmxqixrwzackjf.supabase.co/functions/v1/workbench-local-session");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.apikey, "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0");
      assert.equal(options.headers.Authorization, "Bearer sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0");
      assert.equal(options.headers["x-workbench-session-token"], MACHINE_SECRET);
      assert.equal(options.body, undefined);
      return new Response(JSON.stringify({ session: {
        access_token: "synthetic-user-access-token",
        refresh_token: "synthetic-user-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: { id: OWNER },
        service_role: "must not be returned",
      } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await request(app);
  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "no-store, private");
  assert.deepEqual(Object.keys(result.body.session).sort(), ["access_token", "expires_in", "refresh_token", "token_type"].sort());
  assert.equal(result.body.session.access_token, "synthetic-user-access-token");
});

test("bootstrap fails closed for missing secret and issuer errors", async (t) => {
  const noSecret = await setup(t, { secretPath: "/missing/workbench-session-key", fetchImpl: async () => { throw new Error("must not call issuer"); } });
  assert.equal((await request(noSecret)).status, 503);

  const failedIssuer = await setup(t, { fetchImpl: async () => new Response("{}", { status: 500 }) });
  const failed = await request(failedIssuer);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error.code, "LOCAL_SESSION_UNAVAILABLE");

  const wrongOwner = await setup(t, { fetchImpl: async () => new Response(JSON.stringify({ session: {
    access_token: "synthetic-token", refresh_token: "synthetic-refresh", user: { id: "11111111-1111-4111-8111-111111111111" },
  } }), { status: 200 }) });
  assert.equal((await request(wrongOwner)).status, 503);
});
