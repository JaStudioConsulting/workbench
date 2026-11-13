import { supabase } from "../../supabase-client.js";

const STORAGE_KEY = "workbench.leads.v1";
const LEAD_FIELDS = ["company", "contact", "email", "linkedinUrl", "externalId", "externalIdSource", "companyWebsite", "role", "status", "nextAction", "nextDate", "notes"];

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

function normalizeEmail(value) {
  return text(value).toLowerCase();
}

function normalizeLinkedIn(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return raw.toLowerCase().replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${url.pathname.toLowerCase().replace(/\/+$/, "")}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

function companyDomain(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function findLeadDuplicates(value, leads = []) {
  const email = normalizeEmail(value?.email);
  const linkedIn = normalizeLinkedIn(value?.linkedinUrl);
  const externalId = text(value?.externalId);
  const externalIdSource = text(value?.externalIdSource).toLowerCase();
  const domain = companyDomain(value?.companyWebsite);
  const exact = [];
  const possible = [];
  for (const lead of leads || []) {
    if (value?.id && String(value.id) === String(lead.id)) continue;
    const sameEmail = email && normalizeEmail(lead.email) === email;
    const sameLinkedIn = linkedIn && normalizeLinkedIn(lead.linkedinUrl) === linkedIn;
    const sameExternalId = externalId && text(lead.externalId) === externalId
      && text(lead.externalIdSource).toLowerCase() === externalIdSource;
    const matchedBy = [sameEmail && "email", sameLinkedIn && "LinkedIn", sameExternalId && "external ID"].filter(Boolean);
    if (matchedBy.length) exact.push({ lead, matchedBy });
    else if (domain && companyDomain(lead.companyWebsite) === domain) possible.push(lead);
  }
  return { exact, possible };
}

function fromLeadRow(row) {
  return {
    id: String(row.id),
    persistence: "supabase",
    company: row.company || "",
    contact: row.contact || "",
    email: row.email || "",
    linkedinUrl: row.linkedin_url || "",
    externalId: row.external_id || "",
    externalIdSource: row.external_id_source || "",
    companyWebsite: row.company_website || "",
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
    if (error) throw error;
    return data?.user || null;
  } catch {
    throw new Error("Sign-in status could not be checked. Check your connection and try again.");
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

export async function loadLeadsWithStatus({ client = supabase, storage = browserStorage() } = {}) {
  const user = await currentUser(client);
  if (!user) {
    return { leads: readLocal(storage).map((lead) => ({ ...lead, persistence: "local" })), storage: "local", signedIn: false, reason: "signed_out" };
  }
  const { data, error } = await client
    .from("leads")
    .select("id,company,contact,email,linkedin_url,external_id,external_id_source,company_website,role,status,next_action,next_date,notes,created_at,updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });
  if (isMissingTable(error)) {
    return { leads: readLocal(storage).map((lead) => ({ ...lead, persistence: "local" })), storage: "local", signedIn: true, reason: "table_missing" };
  }
  if (error) throw new Error("My leads could not be loaded");
  const remoteLeads = (data || []).map(fromLeadRow);
  const remoteIds = new Set(remoteLeads.map((lead) => lead.id));
  const localLeads = readLocal(storage).filter((lead) => !remoteIds.has(String(lead.id))).map((lead) => ({ ...lead, persistence: "local" }));
  return { leads: [...remoteLeads, ...localLeads], storage: "supabase", signedIn: true, reason: "", localCount: localLeads.length };
}

export async function listLeads(options = {}) {
  return (await loadLeadsWithStatus(options)).leads;
}

export async function saveLead(value, { client = supabase, storage = browserStorage() } = {}) {
  const lead = normalizeLead(value);
  const user = await currentUser(client);
  const now = new Date().toISOString();
  const id = value.id ? String(value.id) : globalThis.crypto?.randomUUID?.() || `lead-${Date.now()}`;
  const localRecord = { id, ...lead, persistence: "local", createdAt: value.createdAt || now, updatedAt: now };
  const saveLocally = () => {
    if (!storage) throw new Error("This browser cannot save leads on this device. Sign in and try cloud saving again.");
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
    email: lead.email,
    linkedin_url: lead.linkedinUrl,
    external_id: lead.externalId,
    external_id_source: lead.externalIdSource,
    company_website: lead.companyWebsite,
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
    .select("id,company,contact,email,linkedin_url,external_id,external_id_source,company_website,role,status,next_action,next_date,notes,created_at,updated_at")
    .single();
  if (isMissingTable(error)) return saveLocally();
  if (error) throw new Error("Lead could not be saved");
  writeLocal(storage, readLocal(storage).filter((item) => String(item.id) !== id));
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
