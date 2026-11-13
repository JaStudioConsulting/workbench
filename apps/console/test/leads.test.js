import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteLead, findLeadDuplicates, groupTrackerJobs, LEADS_STORAGE_KEY, listLeads, loadLeadsWithStatus, normalizeLead, saveLead } from "../src/features/leads/leadsService.js";

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
    company: "North Plant", contact: "Pat", email: "", linkedinUrl: "", externalId: "", externalIdSource: "", companyWebsite: "", role: "", status: "", nextAction: "", nextDate: "2026-11-20", notes: "",
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

test("auth lookup failure never falls back to a local save", async () => {
  const storage = memoryStorage();
  const client = { auth: { getUser: async () => ({ data: { user: null }, error: { message: "offline" } }) } };
  await assert.rejects(saveLead({ company: "North Plant" }, { client, storage }), /Sign-in status could not be checked/);
  await assert.rejects(loadLeadsWithStatus({ client, storage }), /Sign-in status could not be checked/);
  assert.equal(storage.getItem(LEADS_STORAGE_KEY), null);
});

test("lead matches use stable contact identifiers and treat company domains as possible only", () => {
  const existing = [
    { id: "one", company: "North Plant", email: "pat@example.invalid", linkedinUrl: "https://www.linkedin.com/in/pat/", externalId: "42", externalIdSource: "Loxo", companyWebsite: "https://northplant.example" },
    { id: "two", company: "North Plant", contact: "Pat", companyWebsite: "https://www.northplant.example/about" },
  ];
  const matches = findLeadDuplicates({ email: "PAT@example.invalid", linkedinUrl: "linkedin.com/in/PAT", externalId: "42", externalIdSource: "loxo", companyWebsite: "https://northplant.example/new" }, existing);
  assert.deepEqual(matches.exact.map(({ lead }) => lead.id), ["one"]);
  assert.deepEqual(matches.possible.map((lead) => lead.id), ["two"]);
  assert.deepEqual(findLeadDuplicates({ company: "North Plant", contact: "Pat Smith" }, existing), { exact: [], possible: [] });
});

test("saving a cloud lead removes only its matching device copy", async () => {
  const storage = memoryStorage();
  storage.setItem(LEADS_STORAGE_KEY, JSON.stringify([
    { id: "to-sync", company: "North Plant", contact: "Pat" },
    { id: "keep-local", company: "East Works", contact: "Lee" },
  ]));
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({ upsert: (row) => ({ select: () => ({ single: async () => ({ data: { ...row, created_at: "2026-11-13T00:00:00Z", updated_at: row.updated_at }, error: null }) }) }) }),
  };
  const saved = await saveLead({ id: "to-sync", company: "North Plant", email: "pat@example.invalid" }, { client, storage });
  assert.equal(saved.persistence, "supabase");
  assert.deepEqual(JSON.parse(storage.getItem(LEADS_STORAGE_KEY)).map((item) => item.id), ["keep-local"]);
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
  assert.match(source, /Saved on this device only\. Sign in to sync\./);
  assert.match(source, /Review possible matches before saving/);
  assert.match(source, /Keep as a separate lead/);
  assert.match(source, /Device only/);
  assert.doesNotMatch(source, /\u2014/);
});

test("leads migration is additive and owner-only", async () => {
  const [sql, identifiers] = await Promise.all([
    readFile(new URL("../../gateway/migrations/004_leads.sql", import.meta.url), "utf8"),
    readFile(new URL("../../gateway/migrations/026_lead_identifiers.sql", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /CREATE TABLE public\.leads/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /TO authenticated/);
  assert.match(sql, /auth\.uid\(\)\) = owner_id/g);
  assert.doesNotMatch(sql, /DROP|ALTER COLUMN|DISABLE ROW LEVEL SECURITY/i);
  assert.match(identifiers, /ADD COLUMN IF NOT EXISTS email text/);
  assert.match(identifiers, /ADD COLUMN IF NOT EXISTS linkedin_url text/);
  assert.match(identifiers, /ADD COLUMN IF NOT EXISTS external_id text/);
  assert.match(identifiers, /ADD COLUMN IF NOT EXISTS external_id_source text/);
  assert.match(identifiers, /ADD COLUMN IF NOT EXISTS company_website text/);
  assert.doesNotMatch(identifiers, /UNIQUE|DROP|DEFAULT/i);
});
