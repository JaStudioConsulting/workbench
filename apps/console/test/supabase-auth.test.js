import assert from "node:assert/strict";
import test from "node:test";
import { getWorkbenchSession, subscribeToWorkbenchSession } from "../src/supabase-auth.js";

test("session restore and listener cleanup use the Supabase Auth client", async () => {
  const session = { access_token: "synthetic-test-token" };
  let callback;
  let unsubscribed = false;
  const client = { auth: {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (handler) => { callback = handler; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; },
  } };

  assert.equal(await getWorkbenchSession(client), session);
  let observed = undefined;
  const unsubscribe = subscribeToWorkbenchSession((value) => { observed = value; }, client);
  callback("SIGNED_IN", session);
  assert.equal(observed, session);
  unsubscribe();
  assert.equal(unsubscribed, true);
});

test("session errors are sanitized", async () => {
  const client = { auth: { getSession: async () => ({ data: { session: null }, error: new Error("private provider detail") }) } };
  await assert.rejects(getWorkbenchSession(client), /Unable to check the Workbench session/);
});
