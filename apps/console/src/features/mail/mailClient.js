import { supabase } from "../../supabase-client.js";

const CHANNELS = new Set(["copy", "mailto"]);

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
  if (error) throw new Error("Workbench could not reach your workspace. Reload the page, then try again.");
  const user = data?.user || null;
  if (!user) throw new Error("Workbench could not reach your workspace. Reload the page, then save outreach history again.");
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

export function _resetOutreachForTesting() {
  // Kept for compatibility with existing tests; there is no local success cache.
}
