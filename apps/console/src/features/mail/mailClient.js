import { supabase } from "../../supabase-client.js";
import { gatewayBaseURL } from "../../auth-client.js";

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

async function currentUser(client) {
  const { data, error } = await client.auth.getUser();
  if (error) throw new Error("Sign-in status could not be checked. Try again.");
  const user = data?.user || null;
  if (!user) throw new Error("Sign in to save outreach history.");
  return user;
}

export async function logOutreach(entry, { client = supabase } = {}) {
  const cleaned = normalizeEntry(entry);
  const user = await currentUser(client);

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

  if (error) throw new Error("Outreach history could not be saved. Your draft is still available; retry saving it to history.");
  return fromRow(data);
}

export async function listOutreach({ client = supabase } = {}) {
  const user = await currentUser(client);

  const { data, error } = await client
    .from("outreach_log")
    .select("id,job_id,person_id,candidate_email,subject,body,channel,created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error("Outreach history could not be loaded. Check your connection and try again.");
  return (data || []).map(fromRow);
}

export async function getMailStatus({ request = globalThis.fetch } = {}) {
  try {
    const response = await request(new URL("/api/mail/status", gatewayBaseURL), {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("status unavailable");
    const status = await response.json();
    return {
      connected: Boolean(status.connected),
      canDraft: Boolean(status.canDraft),
      canRead: Boolean(status.canRead),
    };
  } catch {
    return { connected: false, canDraft: false, canRead: false, error: true };
  }
}

export async function saveGmailDraft({ to, subject, body }, { request = globalThis.fetch } = {}) {
  const status = await getMailStatus({ request });
  if (!status.canDraft) return { ok: false, reason: "no_scope" };

  const response = await request(new URL("/api/mail/draft", gatewayBaseURL), {
    method: "POST",
    credentials: "include",
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

export async function listMailReplies(emails, { request = globalThis.fetch } = {}) {
  const normalized = [...new Set((emails || [])
    .map((email) => String(email || "").trim().toLowerCase())
    .filter(Boolean))];
  if (!normalized.length) return { available: true, latestByEmail: {} };
  try {
    const url = new URL("/api/mail/replies", gatewayBaseURL);
    url.searchParams.set("emails", normalized.join(","));
    const response = await request(url, {
      credentials: "include",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("replies unavailable");
    const payload = await response.json();
    return {
      available: Boolean(payload.available),
      latestByEmail: payload.latestByEmail && typeof payload.latestByEmail === "object"
        ? payload.latestByEmail
        : {},
    };
  } catch {
    return { available: false, latestByEmail: {} };
  }
}

export function _resetOutreachForTesting() {
  // Kept for compatibility with existing tests; there is no local success cache.
}
