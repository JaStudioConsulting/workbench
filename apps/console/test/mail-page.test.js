import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { channelLabel, mailtoUrl } from "../src/features/mail/mailPageService.js";

test("outreach log labels existing channels and preserves mailto drafts", () => {
  assert.equal(channelLabel("copy"), "Copied");
  assert.equal(channelLabel("mailto"), "Open in Mail");
  assert.equal(channelLabel("gmail_draft"), "Draft saved");
  const url = mailtoUrl({ to: "candidate@example.invalid", subject: "Following up", body: "Hello" });
  assert.match(url, /^mailto:candidate%40example\.invalid\?/);
  assert.match(url, /subject=Following\+up/);
});

test("outreach log remains available without connection status or reply features", async () => {
  const source = await readFile(new URL("../src/features/mail/MailPage.jsx", import.meta.url), "utf8");
  assert.match(source, /listOutreach/);
  assert.match(source, /No outreach logged/);
  assert.match(source, /Messages copied or opened in your mail app/);
  assert.doesNotMatch(source, /Gmail|reply|Mail status|Follow-ups due/i);
});
