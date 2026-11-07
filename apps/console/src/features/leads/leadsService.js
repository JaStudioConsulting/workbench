import { supabase } from "../../supabase-client.js";

const STORAGE_KEY = "workbench.leads.v1";
const LEAD_FIELDS = ["company", "contact", "role", "status", "nextAction", "nextDate", "notes"];

function text(value) {
  return String(value || "").trim();
}

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function isMissingTable(error) {
  return error?.code === "42P01"
    || error?.code === "PGRST205"
    || /leads.*(not find|does not exist|schema cache)/i.test(error?.message || "");
}

function validDate(value) {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Next date must be a valid date");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Next date must be a valid date");
  }
  return value;
}

export function normalizeLead(value = {}) {
  const lead = LEAD_FIELDS.reduce((result, field) => {
    result[field] = text(value[field]);
    return result;
  }, {});
  if (!lead.company) throw new Error("Company is required");
  lead.nextDate = validDate(lead.nextDate);
  return lead;
}

function fromLeadRow(row) {
  return {
    id: String(row.id),
    company: row.company || "",
    contact: row.contact || "",
    role: row.role || "",
    status: row.status || "",
    nextAction: row.next_action || "",
    nextDate: row.next_date || "",
    notes: row.notes || "",
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function readLocal(storage) {
  if (!storage) return [];
  try {
    const records = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(records) ? records.filter((item) => item && item.id && item.company) : [];
  } catch {
    return [];
  }
}

function writeLocal(storage, records) {
  storage?.setItem(STORAGE_KEY, JSON.stringify(records));
  return records;
}

async function currentUser(client) {
  try {
    const { data, error } = await client.auth.getUser();
    if (error) return null;
    return data?.user || null;
  } catch {
    return null;
  }
}

function safeLoxoLink(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function ownerList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,;]/);
  return values.map(text).filter(Boolean);
}

export function groupTrackerJobs(rows = []) {
  const companies = new Map();
  for (const row of rows) {
    const company = text(row?.company);
    if (!company) continue;
    const existing = companies.get(company) || {
      company,
      openJobsCount: 0,
      owners: new Set(),
      newestJobDate: "",
      loxoLink: "",
    };
    existing.openJobsCount += 1;
    for (const owner of ownerList(row.owners)) existing.owners.add(owner);
    const opened = text(row.date_opened);
    if (opened && (!existing.newestJobDate || opened > existing.newestJobDate)) {
      existing.newestJobDate = opened;
      existing.loxoLink = safeLoxoLink(row.loxo_link) || existing.loxoLink;
    } else if (!existing.loxoLink) {
      existing.loxoLink = safeLoxoLink(row.loxo_link);
    }
    companies.set(company, existing);
  }
  return [...companies.values()]
    .map((item) => ({ ...item, owners: [...item.owners].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => b.newestJobDate.localeCompare(a.newestJobDate) || a.company.localeCompare(b.company));
}

export async function loadClientCompanies({ client = supabase } = {}) {
  const { data, error } = await client
    .from("tracker_jobs")
    .select("job_id,company,status,date_opened,owners,loxo_link")
    .eq("status", "Active")
    .order("date_opened", { ascending: false, nullsFirst: false });
  if (error) throw new Error("Tracker client companies could not be loaded");
  return groupTrackerJobs(data || []);
}

export async function listLeads({ client = supabase, storage = browserStorage() } = {}) {
  const user = await currentUser(client);
  if (!user) return readLocal(storage);
  const { data, error } = await client
    .from("leads")
    .select("id,company,contact,role,status,next_action,next_date,notes,created_at,updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  if (isMissingTable(error)) return readLocal(storage);
  if (error) throw new Error("My leads could not be loaded");
  return (data || []).map(fromLeadRow);
}

export async function saveLead(value, { client = supabase, storage = browserStorage() } = {}) {
  const lead = normalizeLead(value);
  const user = await currentUser(client);
  const now = new Date().toISOString();
  const id = value.id ? String(value.id) : globalThis.crypto?.randomUUID?.() || `lead-${Date.now()}`;
  const localRecord = { id, ...lead, createdAt: value.createdAt || now, updatedAt: now };
  const saveLocally = () => {
    const records = readLocal(storage);
    const index = records.findIndex((item) => item.id === id);
    if (index >= 0) records[index] = localRecord;
    else records.unshift(localRecord);
    writeLocal(storage, records);
    return localRecord;
  };
  if (!user) return saveLocally();

  const row = {
    id,
    owner_id: user.id,
    company: lead.company,
    contact: lead.contact,
    role: lead.role,
    status: lead.status,
    next_action: lead.nextAction,
    next_date: lead.nextDate || null,
    notes: lead.notes,
    updated_at: now,
  };
  const { data, error } = await client
    .from("leads")
    .upsert(row, { onConflict: "id" })
    .select("id,company,contact,role,status,next_action,next_date,notes,created_at,updated_at")
    .single();
  if (isMissingTable(error)) return saveLocally();
  if (error) throw new Error("Lead could not be saved");
  storage?.removeItem(STORAGE_KEY);
  return fromLeadRow(data || row);
}

export async function deleteLead(id, { client = supabase, storage = browserStorage() } = {}) {
  const leadId = text(id);
  if (!leadId) throw new Error("Lead is required");
  const user = await currentUser(client);
  const removeLocally = () => {
    writeLocal(storage, readLocal(storage).filter((item) => item.id !== leadId));
    return { ok: true };
  };
  if (!user) return removeLocally();
  const { error } = await client.from("leads").delete().eq("id", leadId).eq("owner_id", user.id);
  if (isMissingTable(error)) return removeLocally();
  if (error) throw new Error("Lead could not be deleted");
  return { ok: true };
}

export const LEADS_STORAGE_KEY = STORAGE_KEY;
