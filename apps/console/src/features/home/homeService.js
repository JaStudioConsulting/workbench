import { supabase } from "../../supabase-client.js";
import { listMailReplies, listOutreach } from "../mail/mailClient.js";
import { listOperatorCases } from "../operator-cases/operatorCaseService.js";

function candidateKey(value = {}) {
  return `${value.candidate_source || value.candidateSource || ""}:${value.candidate_source_id || value.candidateSourceId || ""}`;
}

function startOfDay(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
  return new Date(`${key}T00:00:00.000Z`);
}

export function businessDaysSince(value, now = new Date()) {
  const start = startOfDay(value);
  const end = startOfDay(now);
  if (!start || !end || start >= end) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function followUpsDue(outreach, replies, now = new Date()) {
  return (outreach || []).flatMap((entry) => {
    if (businessDaysSince(entry.createdAt, now) < 3) return [];
    const email = String(entry.candidateEmail || "").trim().toLowerCase();
    const replyKnown = Boolean(replies?.available && email);
    const repliedAt = replyKnown ? replies.latestByEmail?.[email] : null;
    if (repliedAt && Date.parse(repliedAt) >= Date.parse(entry.createdAt)) return [];
    return [{ ...entry, replyStatus: replyKnown ? "not_detected" : "unknown" }];
  });
}

export function leadRemindersDue(leads, now = new Date()) {
  const today = startOfDay(now);
  if (!today) return [];
  return (leads || []).filter((lead) => {
    const due = startOfDay(lead.next_date);
    return due && due <= today;
  }).sort((left, right) => String(left.next_date).localeCompare(String(right.next_date)));
}

export function latestReadyCaseDrafts(artifacts = [], cases = []) {
  const caseById = new Map(cases.map((record) => [record.id, record]));
  const latest = new Map();
  for (const artifact of [...artifacts].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    const key = `${artifact.case_id}:${artifact.artifact_type}`;
    if (!latest.has(key)) latest.set(key, artifact);
  }
  return [...latest.values()].filter((artifact) => {
    const status = artifact.content?.status || artifact.content?.readiness;
    return artifact.review_state === "draft" && caseById.has(artifact.case_id)
      && !["needs_information", "needs_input", "failed", "not_available"].includes(status);
  }).map((artifact) => ({ ...artifact, kind: artifact.artifact_type, title: caseById.get(artifact.case_id).title }));
}

export function groupWaitingActions(actions, candidates = []) {
  const names = new Map(candidates.map((candidate) => [candidateKey(candidate), candidate.candidate_name || "Candidate name not on file"]));
  const groups = new Map();
  for (const action of actions || []) {
    const key = `${action.job_id}:${candidateKey(action)}`;
    const current = groups.get(key) || {
      key,
      jobId: action.job_id,
      candidateName: names.get(candidateKey(action)) || "Candidate name not on file",
      count: 0,
      oldestAt: action.created_at || null,
      actions: [],
    };
    current.count += 1;
    current.actions.push(action);
    if (action.created_at && (!current.oldestAt || action.created_at < current.oldestAt)) current.oldestAt = action.created_at;
    groups.set(key, current);
  }
  return [...groups.values()];
}

export function waitingAgeLabel(value, now = new Date()) {
  const age = now.getTime() - Date.parse(value);
  if (!Number.isFinite(age) || age < 0) return "Age unavailable";
  const hours = Math.floor(age / 3_600_000);
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

async function checked(query, message) {
  const { data, error } = await query;
  if (error) throw new Error(message);
  return data || [];
}

export async function loadHomeData({ client = supabase, now = new Date(), includeCases = true, includeMailReplies = false } = {}) {
  const [actions, candidates, outreach, cases, leads] = await Promise.all([
    checked(
      client.from("candidate_review_actions").select("id,job_id,candidate_source,candidate_source_id,action_type,activity_type,note,created_at,status").eq("status", "waiting_for_loxo").order("created_at", { ascending: true }),
      "Waiting actions could not be loaded",
    ),
    checked(
      client.from("candidate_review_feed").select("candidate_source,candidate_source_id,candidate_name").limit(1000),
      "Candidate names could not be loaded",
    ),
    listOutreach({ client }),
    includeCases ? listOperatorCases({ client }) : Promise.resolve([]),
    checked(
      client.from("leads").select("id,company,contact,next_action,next_date,status").lte("next_date", startOfDay(now).toISOString().slice(0, 10)).order("next_date", { ascending: true }),
      "Recorded reminders could not be loaded",
    ),
  ]);
  const emails = [...new Set(outreach.map((entry) => entry.candidateEmail).filter(Boolean))];
  const [replies, artifacts] = await Promise.all([
    includeMailReplies ? listMailReplies(emails) : Promise.resolve({ available: false, latestByEmail: {} }),
    cases.length ? checked(
      client.from("case_artifacts").select("id,case_id,artifact_type,review_state,generated_by,created_at,content->status,content->readiness")
        .in("case_id", cases.map((record) => record.id)).order("created_at", { ascending: false }).limit(250),
      "Ready drafts could not be loaded",
    ) : Promise.resolve([]),
  ]);
  return {
    waiting: groupWaitingActions(actions, candidates),
    drafts: latestReadyCaseDrafts(artifacts.map((artifact) => ({ ...artifact, content: { status: artifact.status, readiness: artifact.readiness } })), cases),
    outreach,
    replies,
    followUps: followUpsDue(outreach, replies, now),
    reminders: leadRemindersDue(leads, now),
    cases,
  };
}

export async function listMpcCandidates({ client = supabase } = {}) {
  const rows = await checked(
    client.from("candidate_review_feed")
      .select("candidate_source,candidate_source_id,candidate_name,current_title,current_company")
      .limit(5000),
    "Candidates could not be loaded. Retry, or check that live Tracker data is available.",
  );
  const unique = new Map();
  for (const row of rows) {
    const candidateId = Number(row.candidate_source_id);
    if (!["sourcing", "submission"].includes(row.candidate_source) || !/^[1-9]\d*$/.test(String(row.candidate_source_id || "")) || !Number.isSafeInteger(candidateId)) continue;
    const id = `${row.candidate_source}:${candidateId}`;
    if (!unique.has(id)) unique.set(id, { ...row, id });
  }
  return [...unique.values()].sort((a, b) => String(a.candidate_name || "").localeCompare(String(b.candidate_name || "")));
}
