import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import test from "node:test";

test("console has no local persistence or send authority", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /localStorage|sessionStorage|sendEmail|candidateSubmit/i);
  assert.match(app, /Authentication is unavailable/);
  assert.match(app, /disabled[^>]*>Create case/);
  assert.match(app, /Sign in with Google/);
  assert.match(app, /Signed in/);
  assert.match(app, /Signed out/);
  assert.match(app, /Synthetic sandbox/);
  assert.match(app, /No uploads, storage, login, Gmail, Loxo, Neo4j, sends, or submissions/);
  assert.doesNotMatch(app, /<input|<textarea/);
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
