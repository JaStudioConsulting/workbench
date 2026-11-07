import { supabase } from "../../supabase-client.js";
import { LOXO_PIPELINE_STAGES } from "../candidate-review/constants.js";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function candidateKey(row) {
  return `${row.candidate_source || "unknown"}:${row.candidate_source_id || "unknown"}`;
}

export function hasCandidateProfileData(candidate) {
  return Boolean(
    text(candidate.profile_url)
    || text(candidate.profile_summary)
    || text(candidate.fit_evidence)
    || text(candidate.current_title)
    || text(candidate.current_company)
  );
}

export function buildProcessSummary({ jobs = [], candidates = [], actions = [] }, now = new Date()) {
  const activeJobs = jobs.filter((job) => text(job.status).toLowerCase() === "active");
  const jobIds = new Set(activeJobs.map((job) => String(job.job_id)));
  const activeCandidates = candidates.filter((candidate) => jobIds.has(String(candidate.job_id)));
  const candidateLookup = new Map(activeCandidates.map((candidate) => [
    `${candidate.job_id}:${candidateKey(candidate)}`,
    candidate,
  ]));

  const jobSummaries = activeJobs.map((job) => {
    const rows = activeCandidates.filter((candidate) => String(candidate.job_id) === String(job.job_id));
    const stageCounts = Object.fromEntries(LOXO_PIPELINE_STAGES.map((stage) => [stage, 0]));
    for (const candidate of rows) {
      if (Object.hasOwn(stageCounts, candidate.stage)) stageCounts[candidate.stage] += 1;
    }
    return {
      id: String(job.job_id),
      title: text(job.job_title) || "Job title not on file",
      company: text(job.company) || "Company not on file",
      candidateCount: rows.length,
      stageCounts,
    };
  });

  const cutoff = now.getTime() - TWO_DAYS_MS;
  const staleActions = actions
    .filter((action) => (
      action.status === "waiting_for_loxo"
      && jobIds.has(String(action.job_id))
      && Number.isFinite(Date.parse(action.created_at))
      && Date.parse(action.created_at) < cutoff
    ))
    .map((action) => {
      const candidate = candidateLookup.get(`${action.job_id}:${candidateKey(action)}`);
      return {
        type: "waiting_action",
        id: `action:${action.id || `${action.job_id}:${candidateKey(action)}:${action.created_at}`}`,
        jobId: String(action.job_id),
        label: text(candidate?.candidate_name) || "Candidate record unavailable",
        detail: "Waiting for Loxo for more than 2 days",
      };
    });

  const missingSources = activeCandidates
    .filter((candidate) => !text(candidate.resume_text) && !hasCandidateProfileData(candidate))
    .map((candidate) => ({
      type: "missing_source",
      id: `source:${candidate.job_id}:${candidateKey(candidate)}`,
      jobId: String(candidate.job_id),
      label: text(candidate.candidate_name) || "Candidate name not on file",
      detail: "No resume or profile data",
    }));

  const emptyJobs = jobSummaries
    .filter((job) => job.candidateCount === 0)
    .map((job) => ({
      type: "empty_job",
      id: `job:${job.id}`,
      jobId: job.id,
      label: `${job.title} at ${job.company}`,
      detail: "No candidates",
    }));

  return {
    jobs: jobSummaries,
    blocked: [...staleActions, ...missingSources, ...emptyJobs],
  };
}

export async function loadProcessData(client = supabase, now = new Date()) {
  const [jobsResult, candidatesResult, actionsResult] = await Promise.all([
    client
      .from("tracker_jobs")
      .select("job_id,job_title,company,status")
      .eq("status", "Active")
      .order("date_opened", { ascending: false, nullsFirst: false }),
    client
      .from("candidate_review_feed")
      .select("job_id,candidate_source,candidate_source_id,candidate_name,stage,resume_text,profile_url,profile_summary,fit_evidence,current_title,current_company")
      .limit(5000),
    client
      .from("candidate_review_actions")
      .select("id,job_id,candidate_source,candidate_source_id,created_at,status")
      .eq("status", "waiting_for_loxo")
      .order("created_at", { ascending: true }),
  ]);

  if (jobsResult.error) throw new Error("Could not load active Tracker jobs");
  if (candidatesResult.error) throw new Error("Could not load candidate stages");
  if (actionsResult.error) throw new Error("Could not load queued Loxo actions");

  return buildProcessSummary({
    jobs: jobsResult.data || [],
    candidates: candidatesResult.data || [],
    actions: actionsResult.data || [],
  }, now);
}
