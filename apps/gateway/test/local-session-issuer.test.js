import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { handleLocalSessionRequest, issueExistingUserSession, sha256Hex } from "../../../supabase/functions/workbench-local-session/issuer.js";

const OWNER = "5f00e2f9-fef4-4213-a54f-fc79dd8d7752";
const EMAIL = "owner@example.invalid";
const TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");
const EMAIL_HASH = createHash("sha256").update(EMAIL).digest("hex");
const session = {
  access_token: "ordinary-user-access-token",
  refresh_token: "ordinary-user-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 2_000_000_000,
  user: { id: OWNER, email: EMAIL },
  service_role_key: "must not escape",
};

function dependencies(overrides = {}) {
  const calls = { clientKeys: [], link: [], verify: [], rpc: 0 };
  const user = { id: OWNER, email: EMAIL, email_confirmed_at: "2025-01-01T00:00:00Z", ...overrides.user };
  const admin = {
    auth: { admin: {
      async getUserById(id) {
        calls.lookupId = id;
        return overrides.userResult || { data: { user }, error: null };
      },
      async generateLink(input) {
        calls.link.push(input);
        return overrides.linkResult || { data: { user: { id: OWNER, email: EMAIL }, properties: { hashed_token: "synthetic-one-time-hash" } }, error: null };
      },
    } },
  };
  const publicClient = {
    auth: { async verifyOtp(input) {
      calls.verify.push(input);
      return overrides.verifyResult || { data: { session }, error: null };
    } },
  };
  const scopedClient = { async rpc(name) { calls.rpc += 1; calls.rpcName = name; return overrides.rpcResult || { data: true, error: null }; } };
  const createClient = (url, key, options = {}) => {
    calls.clientKeys.push(key);
    if (key === "server-only-secret-key") return admin;
    if (options.global?.headers?.Authorization) return scopedClient;
    return publicClient;
  };
  return {
    calls,
    args: {
      createClient,
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "server-only-secret-key",
      publishableKey: "sb_publishable_public-key",
      ownerId: OWNER,
      expectedLoginHash: EMAIL_HASH,
      token: TOKEN,
      expectedTokenHash: TOKEN_HASH,
    },
  };
}

test("session issuer creates an ordinary RLS user session only after authorization", async () => {
  const { args, calls } = dependencies();
  const issued = await issueExistingUserSession(args);
  assert.deepEqual(calls.link, [{ type: "magiclink", email: EMAIL }]);
  assert.deepEqual(calls.verify, [{ token_hash: "synthetic-one-time-hash", type: "magiclink" }]);
  assert.equal(calls.lookupId, OWNER);
  assert.equal(calls.rpcName, "is_authorized_recruiter");
  assert.equal(calls.rpc, 1);
  assert.deepEqual(issued.user, { id: OWNER });
  assert.equal(issued.access_token, session.access_token);
  assert.equal(issued.refresh_token, session.refresh_token);
  assert.equal("service_role_key" in issued, false);
  assert.equal(calls.clientKeys.includes("server-only-secret-key"), true);
});

test("invalid machine token and owner mismatch never call Auth Admin", async () => {
  const invalid = dependencies();
  await assert.rejects(issueExistingUserSession({ ...invalid.args, token: "wrong" }));
  assert.equal(invalid.calls.lookupId, undefined);
  assert.equal(invalid.calls.link.length, 0);

  const mismatch = dependencies({ user: { id: "11111111-1111-4111-8111-111111111111" } });
  await assert.rejects(issueExistingUserSession(mismatch.args));
  assert.equal(mismatch.calls.lookupId, OWNER);
  assert.equal(mismatch.calls.link.length, 0);
});

test("missing, unconfirmed, disabled, or changed-email owner is not issued a link", async () => {
  const cases = [
    { userResult: { data: { user: null }, error: new Error("missing") } },
    { user: { email_confirmed_at: null } },
    { user: { deleted_at: "2026-01-01T00:00:00Z" } },
    { user: { banned_until: "2999-01-01T00:00:00Z" } },
    { user: { email: "changed@example.invalid" } },
    { user: { id: "11111111-1111-4111-8111-111111111111" } },
  ];
  for (const options of cases) {
    const { args, calls } = dependencies(options);
    await assert.rejects(issueExistingUserSession(args));
    assert.equal(calls.link.length, 0);
    assert.equal(calls.verify.length, 0);
  }
});

test("generated or verified sessions for another identity are rejected", async () => {
  const badLink = dependencies({
    linkResult: { data: { user: { id: "11111111-1111-4111-8111-111111111111", email: EMAIL }, properties: { hashed_token: "bad" } }, error: null },
  });
  await assert.rejects(issueExistingUserSession(badLink.args));
  assert.equal(badLink.calls.verify.length, 0);

  const badVerify = dependencies({
    verifyResult: { data: { session: { ...session, user: { id: "11111111-1111-4111-8111-111111111111", email: EMAIL } } }, error: null },
  });
  await assert.rejects(issueExistingUserSession(badVerify.args));
  assert.equal(badVerify.calls.rpc, 0);

  const emptyLink = dependencies({ linkResult: { data: { user: { id: OWNER, email: EMAIL }, properties: {} }, error: null } });
  await assert.rejects(issueExistingUserSession(emptyLink.args));
  assert.equal(emptyLink.calls.verify.length, 0);

  const emptySession = dependencies({ verifyResult: { data: { session: { ...session, refresh_token: "" } }, error: null } });
  await assert.rejects(issueExistingUserSession(emptySession.args));
  assert.equal(emptySession.calls.rpc, 0);
});

test("unauthorized user and Auth Admin failures fail without returning a session", async () => {
  const unauthorized = dependencies({ rpcResult: { data: false, error: null } });
  await assert.rejects(issueExistingUserSession(unauthorized.args));

  const rpcFailure = dependencies({ rpcResult: { data: null, error: new Error("private database detail") } });
  await assert.rejects(issueExistingUserSession(rpcFailure.args));

  const upstream = dependencies({ userResult: { data: null, error: new Error("private provider detail") } });
  await assert.rejects(issueExistingUserSession(upstream.args));
  assert.equal(upstream.calls.link.length, 0);
});

test("SHA-256 helper produces a stable lowercase digest", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("Edge Function handler accepts only empty POST with the machine token and returns sanitized user session", async () => {
  const { args, calls } = dependencies();
  const response = await handleLocalSessionRequest(new Request("https://function.invalid/workbench-local-session", {
    method: "POST",
    headers: { "x-workbench-session-token": TOKEN },
  }), args);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  const payload = await response.json();
  assert.equal(payload.session.user.id, OWNER);
  assert.equal(payload.session.access_token, session.access_token);
  assert.equal("service_role_key" in payload.session, false);
  assert.equal("email" in payload.session.user, false);
  assert.equal(calls.rpc, 1);

  const bodyRejected = await handleLocalSessionRequest(new Request("https://function.invalid/workbench-local-session", {
    method: "POST", headers: { "x-workbench-session-token": TOKEN }, body: "{}",
  }), args);
  assert.equal(bodyRejected.status, 400);
});

test("Edge Function handler keeps issuer errors private and rejects missing tokens/methods", async () => {
  const { args } = dependencies({ userResult: { data: null, error: new Error("provider secret detail") } });
  const missing = await handleLocalSessionRequest(new Request("https://function.invalid/workbench-local-session", { method: "POST" }), args);
  assert.equal(missing.status, 403);
  const method = await handleLocalSessionRequest(new Request("https://function.invalid/workbench-local-session", { method: "GET" }), args);
  assert.equal(method.status, 404);
  const failed = await handleLocalSessionRequest(new Request("https://function.invalid/workbench-local-session", {
    method: "POST", headers: { "x-workbench-session-token": TOKEN },
  }), args);
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /provider secret detail/);
});
