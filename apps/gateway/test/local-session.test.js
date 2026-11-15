import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import test from "node:test";
import { getLocalSessionAvailability, isLoopbackAddress, isTrustedLocalSessionRequest, registerLocalSessionRoute } from "../src/local-session.js";

const OWNER = "5f00e2f9-fef4-4213-a54f-fc79dd8d7752";
const MACHINE_SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const envFor = (overrides = {}) => ({
  WORKBENCH_LOCAL_SESSION_ENABLED: "1",
  WORKBENCH_LOCAL_SESSION_OWNER_ID: OWNER,
  WORKBENCH_LOCAL_SESSION_SECRET_FILE: "/private/session-secret",
  ...overrides,
});
const forbiddenHeaders = [
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "forwarded", "via", "x-real-ip",
  "tailscale-user-login", "tailscale-user-name", "tailscale-user-profile-pic", "tailscale-headers-info",
];
const neverFetch = async () => { throw new Error("issuer must not be called"); };

test("local session availability requires loopback config, owner, and secret but no tailnet identity", () => {
  assert.equal(getLocalSessionAvailability({}), "unavailable");
  assert.equal(getLocalSessionAvailability(envFor()), "configured");
  for (const host of ["0.0.0.0", "192.168.1.8", "workbench.local"]) {
    assert.equal(getLocalSessionAvailability(envFor({ HOST: host })), "unavailable");
  }
});

test("trust accepts only exact origins with loopback local and remote sockets and no proxy signals", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  for (const address of ["192.168.1.4", "100.100.2.3", "8.8.8.8"]) assert.equal(isLoopbackAddress(address), false);
  assert.equal(isLoopbackAddress("::1%en0"), true);
  const request = (remoteAddress, origin, host, extra = {}, localAddress = "127.0.0.1") => isTrustedLocalSessionRequest({
    socket: { remoteAddress, localAddress },
    headers: { ...(origin === undefined ? {} : { origin }), ...(host === undefined ? {} : { host }), ...extra },
  }, { origins: ["http://127.0.0.1:8092", "http://localhost:8092"] });

  assert.equal(request("127.0.0.1", "http://127.0.0.1:8092", "127.0.0.1:8092"), true);
  assert.equal(request("127.0.0.1", "http://localhost:8092", "localhost:8092"), true);
  assert.equal(request("192.168.1.12", "http://127.0.0.1:8092", "127.0.0.1:8092", { "x-forwarded-for": "127.0.0.1" }), false);
  assert.equal(request("127.0.0.1", "http://127.0.0.1:8092", "127.0.0.1:8092", {}, "192.168.1.12"), false);
});

async function request(app, options = {}) {
  const origin = Object.hasOwn(options, "origin") ? options.origin : "http://127.0.0.1:8092";
  const host = Object.hasOwn(options, "host") ? options.host : "127.0.0.1:8092";
  const { headers = {}, method = "POST", path = "/api/auth/local-session" } = options;
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try {
    return await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: "127.0.0.1", port: server.address().port, path, method,
        headers: { ...(host === undefined ? {} : { Host: host }), ...(origin === undefined ? {} : { Origin: origin }), ...headers, "Content-Length": "0" },
      }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: body ? (() => { try { return JSON.parse(body); } catch { return body; } })() : null, headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function setup(t, { secretMode = 0o600, secretPath, secretContents = MACHINE_SECRET, env = {}, fetchImpl = neverFetch } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "workbench-local-session-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = secretPath || join(directory, "machine-secret");
  if (!secretPath || secretMode !== 0o600 || secretContents !== MACHINE_SECRET) {
    await writeFile(path, secretContents, { mode: secretMode });
    await chmod(path, secretMode);
  }
  const app = express();
  registerLocalSessionRoute(app, { env: envFor({ WORKBENCH_LOCAL_SESSION_SECRET_FILE: path, ...env }), fetchImpl });
  return app;
}

test("local bootstrap returns only five approved session fields for both loopback origins", async (t) => {
  const app = await setup(t, { fetchImpl: async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.equal(options.headers["x-workbench-session-token"], MACHINE_SECRET);
    return Response.json({ session: {
      access_token: "synthetic-user-access-token", refresh_token: "synthetic-user-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: 123,
      user: { id: OWNER }, service_role: "must not be returned",
    } });
  } });
  for (const host of ["127.0.0.1:8092", "localhost:8092"]) {
    const result = await request(app, { origin: `http://${host}`, host, headers: { "Sec-Fetch-Site": "same-origin" } });
    assert.equal(result.status, 200);
    assert.match(result.headers["cache-control"], /no-store/);
    assert.deepEqual(Object.keys(result.body.session).sort(), ["access_token", "expires_at", "expires_in", "refresh_token", "token_type"]);
  }
});

test("HTTP rejects missing, untrusted, proxy, and cross-site request metadata before issuer call", async (t) => {
  const app = await setup(t);
  const cases = [
    ["missing Origin", { origin: undefined }],
    ["null Origin", { origin: "null" }],
    ["evil Origin with matching Host", { origin: "http://evil.com:8092", host: "evil.com:8092" }],
    ["good Origin with evil Host", { host: "evil.com:8092" }],
    ["https tailnet Origin", { origin: "https://jcs-macbook-air.tailnet.ts.net", host: "jcs-macbook-air.tailnet.ts.net" }],
    ["port mismatch", { origin: "http://127.0.0.1:8093", host: "127.0.0.1:8093" }],
    ["IPv6 loopback Origin", { origin: "http://[::1]:8092", host: "[::1]:8092" }],
    ["trailing-dot host", { origin: "http://localhost.:8092", host: "localhost.:8092" }],
    ["uppercase host", { origin: "http://LOCALHOST:8092", host: "LOCALHOST:8092" }],
    ...forbiddenHeaders.map((header) => [`${header} present`, { headers: { [header]: "untrusted" } }]),
    ["mixed-case forwarded header present", { headers: { "X-Forwarded-For": "untrusted" } }],
    ["cross-site fetch", { headers: { "Sec-Fetch-Site": "cross-site" } }],
  ];
  for (const [label, options] of cases) {
    const result = await request(app, options);
    assert.equal(result.status, 403, label);
    assert.equal(result.body.error.code, "LOCAL_SESSION_FORBIDDEN", label);
    assert.match(result.headers["cache-control"], /no-store/, label);
  }
});

test("HTTP rejects same-site and none fetch metadata before issuer call", async (t) => {
  let issuerCalls = 0;
  const app = await setup(t, { fetchImpl: async () => {
    issuerCalls += 1;
    return Response.json({ session: { user: { id: OWNER }, access_token: "access", refresh_token: "refresh" } });
  } });
  for (const site of ["same-site", "none"]) {
    const result = await request(app, { headers: { "Sec-Fetch-Site": site } });
    assert.equal(result.status, 403, site);
    assert.equal(result.body.error.code, "LOCAL_SESSION_FORBIDDEN", site);
  }
  assert.equal(issuerCalls, 0);
});

test("disabled route is 404 and GET is not served", async (t) => {
  const disabled = await setup(t, { env: { WORKBENCH_LOCAL_SESSION_ENABLED: undefined } });
  const result = await request(disabled);
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, "NOT_FOUND");
  assert.match(result.headers["cache-control"], /no-store/);
  const enabled = await setup(t);
  assert.equal((await request(enabled, { method: "GET" })).status, 404);
});

test("issuer failures return 503 without exposing token fields", async (t) => {
  const cases = [
    ["different user", async () => Response.json({ session: { user: { id: "00000000-0000-4000-8000-000000000000" }, access_token: "secret-access", refresh_token: "secret-refresh" } })],
    ["HTTP 500", async () => Response.json({ access_token: "secret-access", refresh_token: "secret-refresh" }, { status: 500 })],
    ["non-JSON", async () => new Response("secret-access secret-refresh", { status: 200 })],
    ["missing refresh token", async () => Response.json({ session: { user: { id: OWNER }, access_token: "secret-access" } })],
    ["fetch rejects", async () => { throw new Error("network failure"); }],
  ];
  for (const [label, fetchImpl] of cases) {
    const app = await setup(t, { fetchImpl });
    const result = await request(app);
    assert.equal(result.status, 503, label);
    assert.equal(result.body.error.code, "LOCAL_SESSION_UNAVAILABLE", label);
    assert.doesNotMatch(JSON.stringify(result.body), /access_token|refresh_token|secret-access|secret-refresh/, label);
    assert.match(result.headers["cache-control"], /no-store/, label);
  }
});

test("missing, directory, symlink, permissive, malformed secrets and non-loopback binding fail before issuer", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "workbench-local-session-secrets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const realSecret = join(directory, "real-secret");
  await writeFile(realSecret, MACHINE_SECRET, { mode: 0o600 });
  await chmod(realSecret, 0o600);
  const secretDir = join(directory, "secret-dir");
  const link = join(directory, "secret-link");
  await mkdir(secretDir);
  await symlink(realSecret, link);
  const malformed = join(directory, "malformed");
  await writeFile(malformed, "bad", { mode: 0o600 });
  const cases = [
    ["missing", "/missing/workbench-session-key"], ["directory", secretDir], ["symlink", link],
    ["group readable", realSecret, 0o640], ["wrong length", malformed],
  ];
  for (const [label, secretPath, secretMode] of cases) {
    const app = await setup(t, { secretPath, secretMode });
    const result = await request(app);
    assert.equal(result.status, 503, label);
    assert.equal(result.body.error.code, "LOCAL_SESSION_UNAVAILABLE", label);
    assert.match(result.headers["cache-control"], /no-store/, label);
  }
  const invalidCharset = join(directory, "invalid-charset");
  await writeFile(invalidCharset, `${MACHINE_SECRET.slice(0, -1)}!`, { mode: 0o600 });
  const invalidApp = await setup(t, { secretPath: invalidCharset });
  assert.equal((await request(invalidApp)).status, 503);
  const longSecret = join(directory, "long-secret");
  await writeFile(longSecret, "A".repeat(44), { mode: 0o600 });
  const longSecretApp = await setup(t, { secretPath: longSecret });
  assert.equal((await request(longSecretApp)).status, 503);
  const nonLoopback = await setup(t, { env: { HOST: "0.0.0.0" } });
  assert.equal((await request(nonLoopback)).status, 503);
});
