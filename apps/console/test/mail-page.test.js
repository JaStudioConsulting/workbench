import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildFollowUp, channelLabel, FOLLOW_UP_SUBJECT, mailtoUrl, repliedAtFor } from "../src/features/mail/mailPageService.js";

test("follow-up draft is short, signed and uses the required subject", () => {
  const draft = buildFollowUp({ signature: "Ja\nTop Tier Talent Group" });
  assert.equal(draft.subject, "Following up");
  assert.equal(FOLLOW_UP_SUBJECT, "Following up");
  assert.match(draft.body, /Following up on my previous note/);
  assert.match(draft.body, /Top Tier Talent Group/);
  assert.ok(draft.body.length < 300);
  assert.doesNotMatch(draft.body, /\u2014/);
});

test("reply flag only applies to inbound mail after the outreach", () => {
  const entry = { candidateEmail: "candidate@example.invalid", createdAt: "2026-11-01T15:00:00.000Z" };
  assert.equal(repliedAtFor(entry, { available: true, latestByEmail: { "candidate@example.invalid": "2026-11-02T15:00:00.000Z" } }), "2026-11-02T15:00:00.000Z");
  assert.equal(repliedAtFor(entry, { available: true, latestByEmail: { "candidate@example.invalid": "2026-10-30T15:00:00.000Z" } }), null);
  assert.equal(repliedAtFor(entry, { available: false, latestByEmail: {} }), null);
});

test("mail actions produce safe labels and mailto drafts", () => {
  assert.equal(channelLabel("gmail_draft"), "Gmail draft");
  assert.equal(channelLabel("mailto"), "Open in Mail");
  const url = mailtoUrl({ to: "candidate@example.invalid", subject: "Following up", body: "Hello" });
  assert.match(url, /^mailto:candidate%40example\.invalid\?/);
  assert.match(url, /subject=Following\+up/);
});

test("Mail page has complete states, reply status and draft-only actions", async () => {
  const source = await readFile(new URL("../src/features/mail/MailPage.jsx", import.meta.url), "utf8");
  assert.match(source, /Loading mail activity/);
  assert.match(source, /Mail activity could not be loaded/);
  assert.match(source, /No outreach logged/);
  assert.match(source, /Replied/);
  assert.match(source, /Draft follow-up/);
  assert.match(source, /Save Gmail draft/);
  assert.match(source, /logOutreach/);
  assert.doesNotMatch(source, /\u2014/);
});
