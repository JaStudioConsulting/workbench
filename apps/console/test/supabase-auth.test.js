import assert from "node:assert/strict";
import test from "node:test";
import {
  getWorkbenchSession,
  requestExistingAccountLink,
  signOutWorkbench,
  subscribeToWorkbenchSession,
  SIGN_IN_LINK_MESSAGE,
} from "../src/supabase-auth.js";

test("existing-account email login disables signup and uses one neutral response", async () => {
  const calls = [];
  const client = { auth: { signInWithOtp: async (options) => { calls.push(options); return { data: {}, error: null }; } } };
  const result = await requestExistingAccountLink(" Ja@Example.invalid ", { client, redirectTo: "https://workbench.example" });

  assert.equal(result.message, SIGN_IN_LINK_MESSAGE);
  assert.deepEqual(calls, [{
    email: "ja@example.invalid",
    options: { shouldCreateUser: false, emailRedirectTo: "https://workbench.example" },
  }]);
});

test("unknown-account and provider errors do not reveal account existence", async () => {
  for (const signInWithOtp of [
    async () => ({ error: { message: "User not found" } }),
    async () => { throw new Error("SMTP failure"); },
  ]) {
    const result = await requestExistingAccountLink("ja@example.invalid", { client: { auth: { signInWithOtp } }, redirectTo: "https://workbench.example" });
    assert.deepEqual(result, { message: SIGN_IN_LINK_MESSAGE });
  }
});

test("invalid email is rejected before contacting Supabase", async () => {
  let called = false;
  await assert.rejects(
    requestExistingAccountLink("not-an-email", { client: { auth: { signInWithOtp: async () => { called = true; } } } }),
    /valid email address/,
  );
  assert.equal(called, false);
});

test("session restore, listener cleanup, and signout use the Supabase Auth client", async () => {
  const session = { access_token: "synthetic-test-token" };
  let callback;
  let unsubscribed = false;
  let signedOut = false;
  const client = { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (handler) => { callback = handler; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; },
    signOut: async () => { signedOut = true; return { error: null }; },
  } };

  assert.equal(await getWorkbenchSession(client), session);
  let observed = undefined;
  const unsubscribe = subscribeToWorkbenchSession((value) => { observed = value; }, client);
  callback("SIGNED_IN", session);
  assert.equal(observed, session);
  unsubscribe();
  assert.equal(unsubscribed, true);
  await signOutWorkbench(client);
  assert.equal(signedOut, true);
});

test("session and signout errors are sanitized", async () => {
  const client = { auth: {
    getSession: async () => ({ data: { session: null }, error: new Error("private provider detail") }),
    signOut: async () => ({ error: new Error("private provider detail") }),
  } };
  await assert.rejects(getWorkbenchSession(client), /Unable to check the Workbench session/);
  await assert.rejects(signOutWorkbench(client), /Unable to sign out of Workbench/);
});
