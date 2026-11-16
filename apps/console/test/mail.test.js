import test from "node:test";
import assert from "node:assert/strict";

import {
  _resetOutreachForTesting,
  listOutreach,
  logOutreach,
} from "../src/features/mail/mailClient.js";

test.beforeEach(() => _resetOutreachForTesting());

function unavailableClient() {
  return {
    auth: { async getUser() { return { data: { user: null }, error: null }; } },
  };
}

test("outreach logging never reports a local fallback as saved", async () => {
  await assert.rejects(() => logOutreach({
    jobId: "job-1",
    personId: "person-1",
    candidateEmail: "person@example.invalid",
    subject: "Following up",
    body: "Checking in about the role.",
    channel: "copy",
  }, { client: unavailableClient() }), /Workbench could not reach your workspace/);
  await assert.rejects(() => listOutreach({ client: unavailableClient() }), /Workbench could not reach your workspace/);
});

test("outreach database failures remain visible to the user", async () => {
  const client = {
    auth: { async getUser() { return { data: { user: { id: "user-1" } }, error: null }; } },
    from() {
      const query = {
        insert() { return query; },
        select() { return query; },
        single: async () => ({ data: null, error: { message: "offline" } }),
        eq() { return query; },
        order: async () => ({ data: null, error: { message: "offline" } }),
      };
      return query;
    },
  };
  await assert.rejects(() => logOutreach({
    jobId: "job-1", personId: "person-1", subject: "Follow-up", body: "Draft", channel: "copy",
  }, { client }), /draft is still available/);
  await assert.rejects(() => listOutreach({ client }), /could not be loaded/);
});
