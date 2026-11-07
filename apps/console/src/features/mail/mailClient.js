import { supabase } from "../../supabase-client.js";

const outreachFallback = [];
const CHANNELS = new Set(["copy", "mailto", "gmail_draft"]);

function normalizeEntry(entry = {}) {
  const channel = String(entry.channel || "");
  if (!CHANNELS.has(channel)) throw new Error("Choose a valid outreach channel");
  if (!entry.jobId || !entry.personId) throw new Error("Job and candidate are required");
  return {
    jobId: String(entry.jobId),
    personId: String(entry.personId),
    candidateEmail: String(entry.candidateEmail || "").trim(),
    subject: String(entry.subject || "").trim(),
    body: String(entry.body || "").trim(),
    channel,
  };
}

function fromRow(row) {
  return {
    id: row.id,
    jobId: String(row.job_id),
    personId: String(row.person_id),
    candidateEmail: row.candidate_email || "",
    subject: row.subject || "",
    body: row.body || "",
    channel: row.channel,
    createdAt: row.created_at,
  };
}

function fallbackRecord(entry) {
  const record = {
    id: globalThis.crypto?.randomUUID?.() || `outreach-${Date.now()}-${outreachFallback.length}`,
    ...entry,
    createdAt: new Date().toISOString(),
  };
  outreachFallback.unshift(record);
  return record;
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

export async function logOutreach(entry, { client = supabase } = {}) {
  const cleaned = normalizeEntry(entry);
  const user = await currentUser(client);
  if (!user) return fallbackRecord(cleaned);

  const { data, error } = await client
    .from("outreach_log")
    .insert({
      owner_id: user.id,
      job_id: cleaned.jobId,
      person_id: cleaned.personId,
      candidate_email: cleaned.candidateEmail,
      subject: cleaned.subject,
      body: cleaned.body,
      channel: cleaned.channel,
    })
    .select("id,job_id,person_id,candidate_email,subject,body,channel,created_at")
    .single();

  return error ? fallbackRecord(cleaned) : fromRow(data);
}

export async function listOutreach({ client = supabase } = {}) {
  const user = await currentUser(client);
  if (!user) return [...outreachFallback];

  const { data, error } = await client
    .from("outreach_log")
    .select("id,job_id,person_id,candidate_email,subject,body,channel,created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  return error ? [...outreachFallback] : (data || []).map(fromRow);
}

export async function getMailStatus({ request = globalThis.fetch } = {}) {
  try {
    const response = await request("/api/mail/status", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("status unavailable");
    const status = await response.json();
    return {
      connected: Boolean(status.connected),
      canDraft: Boolean(status.canDraft),
      canRead: Boolean(status.canRead),
    };
  } catch {
    return { connected: false, canDraft: false, canRead: false };
  }
}

export async function saveGmailDraft({ to, subject, body }, { request = globalThis.fetch } = {}) {
  const status = await getMailStatus({ request });
  if (!status.canDraft) return { ok: false, reason: "no_scope" };

  const response = await request("/api/mail/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      to: String(to || "").trim(),
      subject: String(subject || "").trim(),
      body: String(body || ""),
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    return { ok: false, reason: detail.reason || "unavailable" };
  }
  return { ok: true, ...(await response.json()) };
}

export function _resetOutreachForTesting() {
  outreachFallback.splice(0, outreachFallback.length);
}
