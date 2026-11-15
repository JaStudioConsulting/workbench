import { supabase } from "../../supabase-client.js";
import { readThroughCache, scopedReadKey } from "../../lib/readCache.js";
import { listOperatorCases } from "../operator-cases/operatorCaseService.js";

function candidateKey(value = {}) {
  return `${value.candidate_source || value.candidateSource || ""}:${value.candidate_source_id || value.candidateSourceId || ""}`;
}

function startOfDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function businessDaysSince(value, now = new Date()) {
  const start = startOfDay(value);
  const end = startOfDay(now);
  if (!start || !end || start >= end) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
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

export async function loadHomeData({ client = supabase, includeCases = false, force = false } = {}) {
  const results = await Promise.allSettled([
    checked(
      client.from("candidate_review_actions").select("id,job_id,candidate_source,candidate_source_id,action_type,activity_type,note,created_at,status").eq("status", "waiting_for_loxo").order("created_at", { ascending: true }),
      "Waiting actions could not be loaded",
    ),
    checked(
      client.from("review_drafts").select("id,job_id,candidate_source,candidate_source_id,kind,status,created_at").eq("status", "ready").order("created_at", { ascending: false }),
      "Ready drafts could not be loaded",
    ),
    readThroughCache(scopedReadKey("home:candidate-names", client), () => checked(
      client.from("candidate_review_feed").select("candidate_source,candidate_source_id,candidate_name").limit(1000),
      "Candidate names could not be loaded",
    ), { force }),
    includeCases ? listOperatorCases({ client }) : Promise.resolve([]),
  ]);
  const [actionsResult, draftsResult, candidatesResult, casesResult] = results;
  const errors = {};
  for (const [key, result] of [["waiting", actionsResult], ["drafts", draftsResult], ["candidateNames", candidatesResult], ["cases", casesResult]]) {
    if (result.status === "rejected") errors[key] = result.reason?.message || "This part of Today could not be loaded.";
  }
  const actions = actionsResult.status === "fulfilled" ? actionsResult.value : [];
  const candidates = candidatesResult.status === "fulfilled" ? candidatesResult.value : [];
  return {
    waiting: groupWaitingActions(actions, candidates),
    drafts: draftsResult.status === "fulfilled" ? draftsResult.value : [],
    cases: casesResult.status === "fulfilled" ? casesResult.value : [],
    errors,
  };
}

export async function listMpcCandidates({ client = supabase, force = false } = {}) {
  const rows = await readThroughCache(scopedReadKey("home:mpc-candidates", client), () => checked(
    client.from("candidate_review_feed")
      .select("candidate_source,candidate_source_id,candidate_name,current_title,current_company")
      .limit(5000),
    "Candidates could not be loaded. Retry, or check that live Tracker data is available.",
  ), { force });
  const unique = new Map();
  for (const row of rows) {
    const candidateId = Number(row.candidate_source_id);
    if (!["sourcing", "submission"].includes(row.candidate_source) || !/^[1-9]\d*$/.test(String(row.candidate_source_id || "")) || !Number.isSafeInteger(candidateId)) continue;
    const id = `${row.candidate_source}:${candidateId}`;
    if (!unique.has(id)) unique.set(id, { ...row, id });
  }
  return [...unique.values()].sort((a, b) => String(a.candidate_name || "").localeCompare(String(b.candidate_name || "")));
}
