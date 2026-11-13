import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseRecruiterAccess } from "../src/supabase-recruiter-auth.js";

const userId = "11111111-1111-4111-8111-111111111111";
const config = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

function response(status, value) {
  return { status, ok: status >= 200 && status < 300, json: async () => value };
}

function invoke(middleware, token) {
  const state = { headers: {}, status: 200, body: null, nextCalled: false };
  const res = {
    set(name, value) { state.headers[name] = value; return this; },
    status(value) { state.status = value; return this; },
    json(value) { state.body = value; return this; },
  };
  const req = { get: (name) => name.toLowerCase() === "authorization" ? token : undefined };
  return middleware(req, res, () => { state.nextCalled = true; }).then(() => state);
}

test("approved Supabase user bearer reaches recruiter-only AI routes", async () => {
  const calls = [];
  const middleware = createSupabaseRecruiterAccess({ env: config, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("/auth/v1/user")
      ? response(200, { id: userId, email: "ja@example.invalid" })
      : response(200, true);
  } });
  const state = await invoke(middleware, "Bearer user-access-token");
  assert.equal(state.nextCalled, true);
  assert.equal(state.headers["Cache-Control"], "private, no-store");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, "Bearer user-access-token");
  assert.equal(calls[1].options.headers.apikey, "sb_publishable_test");
});

test("missing, expired, and unapproved Supabase sessions fail closed", async (t) => {
  await t.test("missing token", async () => {
    const state = await invoke(createSupabaseRecruiterAccess({ env: config }), undefined);
    assert.equal(state.nextCalled, false);
    assert.equal(state.status, 401);
    assert.equal(state.body.error.code, "UNAUTHORIZED");
  });
  await t.test("expired token", async () => {
    const middleware = createSupabaseRecruiterAccess({ env: config, fetchImpl: async () => response(401, {}) });
    const state = await invoke(middleware, "Bearer expired");
    assert.equal(state.nextCalled, false);
    assert.equal(state.status, 401);
  });
  await t.test("RPC says recruiter is not approved", async () => {
    const middleware = createSupabaseRecruiterAccess({ env: config, fetchImpl: async (url) => url.endsWith("/auth/v1/user")
      ? response(200, { id: userId })
      : response(200, false) });
    const state = await invoke(middleware, "Bearer valid-user");
    assert.equal(state.nextCalled, false);
    assert.equal(state.status, 403);
    assert.equal(state.body.error.code, "ACCOUNT_FORBIDDEN");
  });
});
