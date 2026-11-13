import test from "node:test";
import assert from "node:assert/strict";
import { getVerifiedLocalWorkbenchSession, openLocalWorkbenchSession, LOCAL_SESSION_ERROR } from "../src/local-session.js";

function createClient() {
  let saved = null;
  return {
    auth: {
      async setSession(tokens) {
        saved = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, user: { id: "existing-owner" } };
        return { data: { session: saved }, error: null };
      },
      async getSession() { return { data: { session: saved }, error: null }; },
      async getUser() { return { data: { user: { id: "existing-owner", email: "verified@example.invalid" } }, error: null }; },
    },
  };
}

test("local bootstrap installs and returns the persisted Supabase session", async () => {
  const client = createClient();
  let request;
  const session = await openLocalWorkbenchSession({
    client,
    expectedUserId: "existing-owner",
    fetchImpl: async (...args) => {
      request = args;
      return { ok: true, json: async () => ({ session: { access_token: "access", refresh_token: "refresh" } }) };
    },
  });
  assert.equal(session.user.id, "existing-owner");
  assert.equal(request[0], "/api/auth/local-session");
  assert.deepEqual(request[1], {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
});

test("malformed and failed bootstrap responses fail closed without installing a session", async () => {
  let setCalls = 0;
  const client = {
    auth: {
      async setSession() { setCalls += 1; return { error: null }; },
      async getSession() { return { data: { session: null }, error: null }; },
    },
  };
  for (const response of [
    { ok: false, json: async () => ({ message: "private server detail" }) },
    { ok: true, json: async () => ({ session: { access_token: "", refresh_token: "refresh" } }) },
    { ok: true, json: async () => ({ session: { access_token: "access" } }) },
  ]) {
    await assert.rejects(openLocalWorkbenchSession({ client, fetchImpl: async () => response }), { message: LOCAL_SESSION_ERROR });
  }
  assert.equal(setCalls, 0);
});

test("failed local bootstrap can be retried and then persists normally", async () => {
  const client = createClient();
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ session: { access_token: "access-2", refresh_token: "refresh-2" } }) };
  };
  await assert.rejects(openLocalWorkbenchSession({ client, fetchImpl, expectedUserId: "existing-owner" }), { message: LOCAL_SESSION_ERROR });
  const session = await openLocalWorkbenchSession({ client, fetchImpl, expectedUserId: "existing-owner" });
  assert.equal(attempts, 2);
  assert.equal(session.user.id, "existing-owner");
});

test("returned session must match the configured existing owner", async () => {
  let signedOut = false;
  const client = createClient();
  client.auth.signOut = async () => { signedOut = true; return { error: null }; };
  await assert.rejects(openLocalWorkbenchSession({
    client,
    expectedUserId: "different-owner",
    fetchImpl: async () => ({ ok: true, json: async () => ({ session: { access_token: "access", refresh_token: "refresh" } }) }),
  }), { message: LOCAL_SESSION_ERROR });
  assert.equal(signedOut, true);
});

test("concurrent StrictMode bootstrap calls share one mint request", async () => {
  const client = createClient();
  let releaseResponse;
  let requests = 0;
  const fetchImpl = () => {
    requests += 1;
    return new Promise((resolve) => { releaseResponse = resolve; });
  };
  const first = openLocalWorkbenchSession({ client, fetchImpl, expectedUserId: "existing-owner" });
  const second = openLocalWorkbenchSession({ client, fetchImpl, expectedUserId: "existing-owner" });
  assert.equal(first, second);
  assert.equal(requests, 1);
  releaseResponse({ ok: true, json: async () => ({ session: { access_token: "access", refresh_token: "refresh" } }) });
  const [firstSession, secondSession] = await Promise.all([first, second]);
  assert.equal(firstSession.user.id, "existing-owner");
  assert.equal(secondSession.user.id, "existing-owner");
});

test("a restored session is reused only after Auth verifies the configured owner", async () => {
  const client = createClient();
  await client.auth.setSession({ access_token: "stored-access", refresh_token: "stored-refresh" });
  const verified = await getVerifiedLocalWorkbenchSession({ client, expectedUserId: "existing-owner" });
  assert.equal(verified.user.email, "verified@example.invalid");
  assert.equal(verified.access_token, "stored-access");

  client.auth.getUser = async () => ({ data: { user: { id: "different-owner" } }, error: null });
  assert.equal(await getVerifiedLocalWorkbenchSession({ client, expectedUserId: "existing-owner" }), null);
});
