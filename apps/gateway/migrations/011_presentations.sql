-- Confirmed Tracker presentations and unconfirmed Workbench Submitted actions.
-- Preserve source status and unknown client/job fields; do not infer by name.
CREATE VIEW public.presentations WITH (security_invoker = true) AS
WITH tracker_confirmed AS (
  SELECT s.*
  FROM public.tracker_submissions s
  WHERE lower(btrim(s.activity_status)) IN ('submitted', 'hired', 'rejected')
), tracker_job_match AS (
  SELECT
    s.id AS submission_id,
    CASE WHEN count(j.job_id) = 1 THEN min(j.job_id) ELSE NULL::bigint END AS job_id
  FROM tracker_confirmed s
  LEFT JOIN public.tracker_jobs j
    ON NULLIF(btrim(s.role_submitted_for), '') IS NOT NULL
   AND NULLIF(btrim(s.client_submitted_to), '') IS NOT NULL
   AND lower(btrim(j.job_title)) = lower(btrim(s.role_submitted_for))
   AND lower(btrim(j.company)) = lower(btrim(s.client_submitted_to))
  GROUP BY s.id
)
SELECT
  'tracker_submissions:' || s.id::text AS id,
  'confirmed'::text AS presentation_state,
  'tracker_submissions'::text AS source,
  s.id AS source_id,
  'submission'::text AS candidate_source,
  s.id AS candidate_source_id,
  s.candidate_key,
  s.candidate_name,
  NULLIF(btrim(s.client_submitted_to), '') AS client_name,
  jm.job_id,
  NULLIF(btrim(s.role_submitted_for), '') AS job_title,
  s.submission_date AS presented_on,
  NULL::timestamptz AS queued_at,
  s.activity_status AS source_status,
  s.submission_type,
  s.recruiter,
  s.additional_notes AS note
FROM tracker_confirmed s
JOIN tracker_job_match jm ON jm.submission_id = s.id

UNION ALL

SELECT
  'candidate_review_actions:' || a.id::text AS id,
  CASE WHEN a.status = 'failed' THEN 'failed'::text ELSE 'pending'::text END AS presentation_state,
  'candidate_review_actions'::text AS source,
  a.id AS source_id,
  a.candidate_source,
  a.candidate_source_id,
  CASE WHEN a.candidate_source = 'sourcing' THEN sourcing.candidate_key ELSE submission.candidate_key END AS candidate_key,
  CASE WHEN a.candidate_source = 'sourcing' THEN sourcing.candidate_name ELSE submission.candidate_name END AS candidate_name,
  NULLIF(btrim(j.company), '') AS client_name,
  a.job_id,
  j.job_title,
  NULL::date AS presented_on,
  a.created_at AS queued_at,
  a.status AS source_status,
  NULL::text AS submission_type,
  NULL::text AS recruiter,
  a.note
FROM public.candidate_review_actions a
LEFT JOIN public.tracker_jobs j ON j.job_id = a.job_id
LEFT JOIN public.tracker_sourcing sourcing
  ON a.candidate_source = 'sourcing' AND sourcing.id = a.candidate_source_id
LEFT JOIN public.tracker_submissions submission
  ON a.candidate_source = 'submission' AND submission.id = a.candidate_source_id
WHERE a.action_type = 'activity'
  AND lower(btrim(a.activity_type)) = 'submitted'
  AND NOT (
    a.candidate_source = 'submission'
    AND EXISTS (SELECT 1 FROM tracker_confirmed confirmed WHERE confirmed.id = a.candidate_source_id)
  );

COMMENT ON VIEW public.presentations IS
  'Confirmed Tracker presentation records plus pending or failed Workbench Submitted actions. Blank and ambiguous source facts remain unknown.';

REVOKE ALL ON TABLE public.presentations FROM anon;
GRANT SELECT ON TABLE public.presentations TO authenticated;
