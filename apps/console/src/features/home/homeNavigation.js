export function candidateReviewIdFromHomeItem(item = {}) {
  const source = item.candidate_source ?? item.candidateSource;
  const sourceId = item.candidate_source_id ?? item.candidateSourceId;
  if (source && sourceId !== undefined && sourceId !== null) return `${source}:${sourceId}`;
  return item.person_id ?? item.personId ?? item.candidateId ?? "";
}
