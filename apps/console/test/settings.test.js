import test from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { loadSettingsStatus, readCanadaFilter, saveCanadaFilter } from "../src/features/settings/settingsService.js";
import { googleWorkspaceEnabled } from "../src/featureFlags.js";

test("Google Workspace settings panel stays unrendered unless explicitly enabled", async () => {
  const source = await readFile(new URL("../src/features/settings/SettingsPage.jsx", import.meta.url), "utf8");
  assert.equal(googleWorkspaceEnabled, false);
  assert.match(source, /googleWorkspaceEnabled \? <GoogleWorkspacePanel \/> : null/);
});

test("Canada filter defaults on and persists an explicit choice", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readCanadaFilter(storage), true);
  saveCanadaFilter(false, storage);
  assert.equal(readCanadaFilter(storage), false);
});

test("settings reports workspace connectivity without AI, mail, or sign-in status", async () => {
  const client = { auth: { async getSession() { return { data: { session: null }, error: null }; } } };
  const status = await loadSettingsStatus({ client, request: async () => { throw new Error("No request expected"); } });
  assert.equal(status.supabase.connected, false);
  assert.equal(Object.hasOwn(status, "ai"), false);
  assert.equal(Object.hasOwn(status, "google"), false);
  assert.equal(Object.hasOwn(status, "meetings"), false);
  assert.match(status.loxo.label, /Queued mode/);
});

test("settings labels an active workspace connection Connected", async () => {
  const client = { auth: { async getSession() { return { data: { session: { access_token: "workspace-token" } }, error: null }; } } };
  const status = await loadSettingsStatus({ client });
  assert.equal(status.supabase.connected, true);
  const source = await readFile(new URL("../src/features/settings/SettingsPage.jsx", import.meta.url), "utf8");
  assert.match(source, /state\.status\.supabase\.connected \? "Connected"/);
  assert.doesNotMatch(source, /Signed in|Sign in|signed-in|Gmail/);
});
