import { parseCandidateSourceKey } from "@ja/shared-types";
import { supabase } from "../../supabase-client.js";
import { buildCandidatePresentationSummary } from "../candidate-review/candidateReviewService.js";
import { matchCandidateToOpenJobs } from "./jobMatcher.js";

const PAGE_SIZE = 1000;
const CANDIDATE_COLUMNS = "id,current_title,role_context,location,industry,notes";
const PRESENTATION_COLUMNS = "id,presentation_state,source,source_id,candidate_source,candidate_source_id,client_name,job_id,job_title,presented_on,queued_at,source_status";
const JOB_COLUMNS = "job_id,job_title,company,location,status";

function validCandidateItems(searchState) {
  const group = searchState?.groups?.find((item) => item?.key === "candidates");
  return (group?.items || []).filter((item) => item?.entityType === "candidate" && parseCandidateSourceKey(item.entityId));
}

async function readPage(query) {
  const { data, error } = await query;
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Search evidence returned invalid rows");
  return data;
}

async function readAllPages(queryFactory) {
  const result = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const page = await readPage(queryFactory().range(start, start + PAGE_SIZE - 1));
    result.push(...page);
    if (page.length < PAGE_SIZE) return result;
  }
}

export function buildCandidateSearchEvidence(
  item,
  {
    candidateRows = [],
    presentationRows = [],
    jobRows = [],
    candidatesAvailable = true,
    presentationsAvailable = true,
    jobsAvailable = true,
  } = {},
) {
  const parsed = parseCandidateSourceKey(item?.entityId);
  if (!parsed) return null;
  const candidate = candidatesAvailable
    ? candidateRows.find((row) => row?.id === parsed.id)
    : null;
  const summary = presentationsAvailable && candidate
    ? buildCandidatePresentationSummary(parsed.id, presentationRows)
    : null;
  const matches = candidate && jobsAvailable
    ? matchCandidateToOpenJobs({
        id: parsed.id,
        title: candidate.current_title || candidate.role_context || "",
        location: candidate.location || "",
        industry: candidate.industry || "",
        notes: candidate.notes || "",
      }, jobRows.map((row) => ({
        id: row.job_id,
        title: row.job_title,
        company: row.company,
        location: row.location,
        status: row.status,
      })), { limit: 2 })
    : [];
  return Object.freeze({
    candidateId: parsed.id,
    presentationStatus: summary
      ? summary.isPresented ? "presented" : summary.pendingPresentations.length > 0 ? "pending" : "none"
      : "unavailable",
    presentationLabel: summary
      ? summary.isPresented
        ? `Presented to: ${summary.presentedClientLabels.join(", ")}`
        : "No confirmed presentation on record"
      : "Presentation history unavailable",
    pendingLabel: summary?.pendingPresentations.length ? "Pending confirmation" : null,
    matchesStatus: candidate && jobsAvailable ? "loaded" : "unavailable",
    matches,
  });
}

export async function loadSearchEvidence(searchState, { client = supabase } = {}) {
  const items = validCandidateItems(searchState);
  if (items.length === 0) return Object.freeze({});
  const ids = [...new Set(items.map((item) => parseCandidateSourceKey(item.entityId).id))];
  const numericIds = [...new Set(items.map((item) => parseCandidateSourceKey(item.entityId))
    .filter((parsed) => !parsed.is_manual)
    .map((parsed) => Number(parsed.candidate_source_id)))];

  const [candidatesResult, presentationsResult, jobsResult] = await Promise.allSettled([
    readPage(client.from("candidates_all").select(CANDIDATE_COLUMNS).in("id", ids).limit(ids.length)),
    numericIds.length > 0
      ? readAllPages(() => client.from("presentations").select(PRESENTATION_COLUMNS).in("candidate_source_id", numericIds).order("id", { ascending: true }))
      : readPage(client.from("presentations").select("id").limit(1)).then(() => []),
    readAllPages(() => client.from("tracker_jobs").select(JOB_COLUMNS).order("job_id", { ascending: true })),
  ]);

  const candidatesAvailable = candidatesResult.status === "fulfilled";
  const presentationsAvailable = presentationsResult.status === "fulfilled";
  const jobsAvailable = jobsResult.status === "fulfilled";
  const candidateRows = candidatesAvailable ? candidatesResult.value : [];
  const presentationRows = presentationsAvailable ? presentationsResult.value : [];
  const jobRows = jobsAvailable ? jobsResult.value : [];

  return Object.freeze(Object.fromEntries(items.map((item) => [
    item.entityId,
    buildCandidateSearchEvidence(item, {
      candidateRows,
      presentationRows,
      jobRows,
      candidatesAvailable,
      presentationsAvailable,
      jobsAvailable,
    }),
  ])));
}
