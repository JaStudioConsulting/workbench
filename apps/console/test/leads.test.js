import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteLead, groupTrackerJobs, LEADS_STORAGE_KEY, listLeads, loadLeadsWithStatus, normalizeLead, saveLead } from "../src/features/leads/leadsService.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const signedOutClient = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };

test("Tracker jobs group into real client company summaries", () => {
  const companies = groupTrackerJobs([
    { company: "North Plant", owners: "Ja; Lee", date_opened: "2026-10-02", loxo_link: "https://loxo.test/job/1" },
    { company: "North Plant", owners: ["Ja"], date_opened: "2026-11-02", loxo_link: "https://loxo.test/job/2" },
    { company: "", owners: "Nobody", date_opened: "2026-11-03" },
    { company: "East Works", owners: "Sam", date_opened: "2026-09-01", loxo_link: "javascript:alert(1)" },
  ]);
  assert.deepEqual(companies, [
    { company: "North Plant", openJobsCount: 2, owners: ["Ja", "Lee"], newestJobDate: "2026-11-02", loxoLink: "https://loxo.test/job/2" },
    { company: "East Works", openJobsCount: 1, owners: ["Sam"], newestJobDate: "2026-09-01", loxoLink: "" },
  ]);
});

test("lead input stays source-entered and validates company and date", () => {
  assert.deepEqual(normalizeLead({ company: "  North Plant ", contact: " Pat ", nextDate: "2026-11-20" }), {
    company: "North Plant", contact: "Pat", role: "", status: "", nextAction: "", nextDate: "2026-11-20", notes: "",
  });
  assert.throws(() => normalizeLead({ company: "" }), /Company is required/);
  assert.throws(() => normalizeLead({ company: "North Plant", nextDate: "2026-02-30" }), /valid date/);
});

test("My leads CRUD works locally when the table is unavailable", async () => {
  const storage = memoryStorage();
  const first = await saveLead({ company: "North Plant", contact: "Pat" }, { client: signedOutClient, storage });
  assert.equal((await listLeads({ client: signedOutClient, storage }))[0].contact, "Pat");
  const updated = await saveLead({ ...first, contact: "Taylor", nextAction: "Call" }, { client: signedOutClient, storage });
  assert.equal(updated.contact, "Taylor");
  assert.equal(JSON.parse(storage.getItem(LEADS_STORAGE_KEY)).length, 1);
  await deleteLead(first.id, { client: signedOutClient, storage });
  assert.deepEqual(await listLeads({ client: signedOutClient, storage }), []);
});

test("leads expose whether they are synced or local-only", async () => {
  const storage = memoryStorage();
  await saveLead({ company: "North Plant", contact: "Pat" }, { client: signedOutClient, storage });
  const signedOut = await loadLeadsWithStatus({ client: signedOutClient, storage });
  assert.equal(signedOut.storage, "local");
  assert.equal(signedOut.signedIn, false);
  assert.equal(signedOut.reason, "signed_out");
  assert.equal(signedOut.leads[0].contact, "Pat");

  const signedInClient = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: [], error: { code: "PGRST205", message: "Could not find the table" } }) }) }),
    }),
  };
  const signedIn = await loadLeadsWithStatus({ client: signedInClient, storage });
  assert.equal(signedIn.storage, "local");
  assert.equal(signedIn.signedIn, true);
  assert.equal(signedIn.reason, "table_missing");
});

test("Leads page exposes real loading, empty, error and editor states", async () => {
  const source = await readFile(new URL("../src/features/leads/LeadsPage.jsx", import.meta.url), "utf8");
  assert.match(source, /Loading leads/);
  assert.match(source, /Leads could not be loaded/);
  assert.match(source, /No client companies found in active Tracker jobs/);
  assert.match(source, /No leads added/);
  assert.match(source, /Add lead/);
  assert.match(source, /Saved on this device only - sign in to sync/);
  assert.doesNotMatch(source, /\u2014/);
});

test("leads migration is additive and owner-only", async () => {
  const sql = await readFile(new URL("../../gateway/migrations/004_leads.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE public\.leads/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /TO authenticated/);
  assert.match(sql, /auth\.uid\(\)\) = owner_id/g);
  assert.doesNotMatch(sql, /DROP|ALTER COLUMN|DISABLE ROW LEVEL SECURITY/i);
});
