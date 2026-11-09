# Candidate source keys

`public.candidates_all` preserves one row per source record. It does not merge
people by name. Its `id` is `candidate_source:candidate_source_id`:

| `candidate_source` | `candidate_source_id` | Existing compatibility |
| --- | --- | --- |
| `sourcing` | `tracker_sourcing.id` | Matches `candidate_review_feed` |
| `submission` | `tracker_submissions.id` | Matches `candidate_review_feed` |
| `tracker_candidates` | `tracker_candidates.id` | New source kind |
| `manual` | `candidates_manual.id` | New source kind |

The view joins `candidate_edits` by owner, Tracker table and `tracker_row`.
An explicit JSON key wins over the imported field, including JSON `null` to
clear a field. An absent key leaves the imported value unchanged. Source
provenance, import timestamps and source candidate keys remain unchanged.

`tracker_submissions.target_current_compensation` stays in
`compensation_context`. It is not split into target and current compensation
because the source does not say which amount is which.

The Tracker import process must preserve the mapping from a source row to a
person. If an import deletes and reinserts a row under a new identity ID, an
edit on the same `tracker_row` still overlays that row, but saved links using
the old `candidate_source_id` may break. This remains an import acceptance
check before M2 deployment. Do not silently merge people or remap links by
name.
