import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import test from "node:test";

test("console has no local persistence or send authority", async () => {
  const files = await Promise.all([
    "../src/App.jsx",
    "../src/components/HomeWidgets.jsx",
    "../src/components/MailInbox.jsx",
    "../src/components/PageStubs.jsx",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  const source = files.join("\n");
  assert.doesNotMatch(source, /localStorage|sessionStorage|sendEmail|candidateSubmit/i);
  assert.doesNotMatch(source, /Marcus|Meridian|BrightPath|Marketing Director/i);
  assert.match(source, /No workbench data/);
  assert.match(source, /No mail connected/);
  assert.match(source, /selectedNode !== null/);
});

test("console entrypoint and all local static references resolve", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const src = html.match(/src="([^"]+)"/)?.[1];
  assert.equal(src, "/src/main.jsx");
  await access(new URL(`..${src}`, import.meta.url));
});

test("Better Auth client and configured proxy use gateway or same-origin without local persistence", async () => {
  const [client, vite] = await Promise.all([
    readFile(new URL("../src/auth-client.js", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
  ]);
  assert.match(client, /createAuthClient/);
  assert.match(client, /VITE_GATEWAY_URL \|\| window\.location\.origin/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
  assert.match(vite, /"\/api"/);
  assert.match(vite, /"\/mcp"/);
});
