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
  const request = async (url) => String(url).includes("/api/mail/status")
    ? { ok: true, async json() { return { connected: false, canRead: false, canDraft: false }; } }
    : { ok: false, async json() { return {}; } };
  const status = await loadSettingsStatus({ client, request });
  assert.equal(status.supabase.connected, false);
  assert.equal(status.google.connected, false);
  assert.equal(status.ai.label, "AI check not set up");
  assert.equal(status.meetings.available, false);
  assert.match(status.loxo.label, /Queued mode/);
});
