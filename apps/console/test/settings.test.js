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

test("settings status stays honest when optional services are unavailable", async () => {
  const client = { auth: { async getSession() { return { data: { session: null }, error: null }; } } };
  const request = async (url) => {
    return { ok: false, async json() { return {}; } };
  };
  const status = await loadSettingsStatus({ client, request });
  assert.equal(status.supabase.connected, false);
  assert.equal("google" in status, false);
  assert.equal(status.ai.label, "AI check not set up");
  assert.equal(status.meetings.available, false);
  assert.match(status.loxo.label, /Queued mode/);
});

test("AI status request uses the workspace Supabase bearer token", async () => {
  const client = { auth: { async getSession() { return { data: { session: { access_token: "workspace-access-token" } }, error: null }; } } };
  let requestOptions;
  const request = async (_url, options) => {
    requestOptions = options;
    return { ok: true, async json() { return { available: true }; } };
  };
  const status = await loadSettingsStatus({ client, request });
  assert.equal(requestOptions.headers.Authorization, "Bearer workspace-access-token");
  assert.equal(status.ai.label, "Fit check ready");
});

test("settings reports the installed meeting helper through its explicit loader", async () => {
  const client = { auth: { async getSession() { return { data: { session: {} }, error: null }; } } };
  const request = async (url) => {
    return { ok: false, async json() { return {}; } };
  };
  const status = await loadSettingsStatus({ client, request, meetingsStatusLoader: async () => ({ available: true, enhanced: true, captureAvailable: false }) });
  assert.equal(status.meetings.available, true);
  assert.equal(status.meetings.label, "M1 transcription available; recording uses this device's microphone");
  assert.equal("google" in status, false);
});
