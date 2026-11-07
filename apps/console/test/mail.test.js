import test from "node:test";
import assert from "node:assert/strict";

import {
  _resetOutreachForTesting,
  getMailStatus,
  listMailReplies,
  listOutreach,
  logOutreach,
  saveGmailDraft,
} from "../src/features/mail/mailClient.js";

test.beforeEach(() => _resetOutreachForTesting());

function unavailableClient() {
  return {
    auth: { async getUser() { return { data: { user: null }, error: null }; } },
  };
}

test("outreach logging uses the memory fallback when persistence is unavailable", async () => {
  const saved = await logOutreach({
    jobId: "job-1",
    personId: "person-1",
    candidateEmail: "person@example.invalid",
    subject: "Following up",
    body: "Checking in about the role.",
    channel: "copy",
  }, { client: unavailableClient() });

  assert.equal(saved.channel, "copy");
  assert.equal((await listOutreach({ client: unavailableClient() })).length, 1);
});

test("mail status is expressed as plain booleans", async () => {
  const status = await getMailStatus({
    request: async () => ({
      ok: true,
      async json() { return { connected: 1, canDraft: true, canRead: false }; },
    }),
  });
  assert.deepEqual(status, { connected: true, canDraft: true, canRead: false });
});

test("reply lookup normalizes candidate emails", async () => {
  const result = await listMailReplies([" Person@Example.Invalid ", "person@example.invalid"], {
    request: async (url) => {
      assert.match(String(url), /emails=person%40example.invalid/);
      return { ok: true, async json() { return { available: true, latestByEmail: { "person@example.invalid": "2026-11-06T12:00:00.000Z" } }; } };
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.latestByEmail["person@example.invalid"], "2026-11-06T12:00:00.000Z");
});

test("saveGmailDraft does not call the draft route without compose scope", async () => {
  let calls = 0;
  const result = await saveGmailDraft({
    to: "person@example.invalid",
    subject: "Following up",
    body: "Checking in.",
  }, {
    request: async () => {
      calls += 1;
      return {
        ok: true,
        async json() { return { connected: true, canDraft: false, canRead: true }; },
      };
    },
  });

  assert.deepEqual(result, { ok: false, reason: "no_scope" });
  assert.equal(calls, 1);
});

test("saveGmailDraft posts a draft after the status check", async () => {
  const calls = [];
  const result = await saveGmailDraft({
    to: "person@example.invalid",
    subject: "Following up",
    body: "Checking in.",
  }, {
    request: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).endsWith("/status")) {
        return { ok: true, async json() { return { connected: true, canDraft: true, canRead: false }; } };
      }
      return { ok: true, async json() { return { id: "draft-1" }; } };
    },
  });

  assert.deepEqual(result, { ok: true, id: "draft-1" });
  assert.equal(String(calls[1].url), "http://localhost/api/mail/draft");
  assert.equal(calls[1].options.method, "POST");
});
