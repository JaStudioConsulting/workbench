import test from "node:test";
import assert from "node:assert/strict";
import { loadSettingsStatus, readCanadaFilter, saveCanadaFilter } from "../src/features/settings/settingsService.js";

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
    if (String(url).includes("/api/auth/workbench-status")) return { ok: true, status: 200, async json() { return { googleSignIn: "unavailable", localDataSession: "configured" }; } };
    if (String(url).includes("/api/mail/status")) return { ok: false, async json() { return { error: { code: "AUTH_UNAVAILABLE" } }; } };
    return { ok: false, async json() { return {}; } };
  };
  const status = await loadSettingsStatus({ client, request });
  assert.equal(status.supabase.connected, false);
  assert.equal(status.google.connected, false);
  assert.equal(status.google.signIn, "unavailable");
  assert.equal(status.google.localDataSession, "configured");
  assert.equal(status.google.code, "AUTH_UNAVAILABLE");
  assert.equal(status.ai.label, "AI check not set up");
  assert.equal(status.meetings.available, false);
  assert.match(status.loxo.label, /Queued mode/);
});

test("settings reports the installed meeting helper through its explicit loader", async () => {
  const client = { auth: { async getSession() { return { data: { session: {} }, error: null }; } } };
  const request = async (url) => {
    if (String(url).includes("/api/auth/workbench-status")) return { ok: true, status: 200, async json() { return { googleSignIn: "configured", localDataSession: "configured" }; } };
    if (String(url).includes("/api/mail/status")) return { ok: true, async json() { return { connected: false, canRead: false, canDraft: false }; } };
    return { ok: false, async json() { return {}; } };
  };
  const status = await loadSettingsStatus({ client, request, meetingsStatusLoader: async () => ({ available: true, enhanced: true, captureAvailable: false }) });
  assert.equal(status.meetings.available, true);
  assert.equal(status.meetings.label, "M1 transcription available; recording uses this device's microphone");
  assert.equal(status.google.signIn, "configured");
});
