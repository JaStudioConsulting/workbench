import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteLead, groupTrackerJobs, LEADS_STORAGE_KEY, listLeads, normalizeLead, saveLead } from "../src/features/leads/leadsService.js";

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

test("Leads page exposes real loading, empty, error and editor states", async () => {
  const source = await readFile(new URL("../src/features/leads/LeadsPage.jsx", import.meta.url), "utf8");
  assert.match(source, /Loading leads/);
  assert.match(source, /Leads could not be loaded/);
  assert.match(source, /No client companies found in active Tracker jobs/);
  assert.match(source, /No leads added/);
  assert.match(source, /Add lead/);
  assert.doesNotMatch(source, /purple|violet|indigo|—/i);
});

test("leads migration is additive and owner-only", async () => {
  const sql = await readFile(new URL("../../gateway/migrations/004_leads.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE public\.leads/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /TO authenticated/);
  assert.match(sql, /auth\.uid\(\)\) = owner_id/g);
  assert.doesNotMatch(sql, /DROP|ALTER COLUMN|DISABLE ROW LEVEL SECURITY/i);
});
