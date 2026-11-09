-- One row per source record. Names alone never merge people across imports.
-- Owner edits overlay imported facts at read time, so a Tracker re-import
-- cannot replace an explicit Workbench correction.
CREATE VIEW public.candidates_all WITH (security_invoker = true) AS
WITH imported AS (
  SELECT
    'tracker_candidates'::text AS candidate_source,
    'tracker_candidates'::text AS tracker_source,
    c.id::text AS candidate_source_id,
    c.tracker_row,
    c.candidate_name,
    c.current_title,
    c.current_company,
    c.location,
    c.industry,
    c.shift,
    c.email,
    c.phone,
    c.compensation_target,
    c.current_compensation,
    NULL::text AS compensation_context,
    c.notes,
    NULL::text AS profile_url,
    NULL::text AS role_context,
    NULL::text AS client_context,
    NULL::text AS source_candidate_key,
    c.imported_at AS source_updated_at
  FROM public.tracker_candidates c

  UNION ALL

  SELECT
    'sourcing'::text,
    'tracker_sourcing'::text,
    s.id::text,
    s.tracker_row,
    s.candidate_name,
    s.current_title,
    s.current_company,
    NULL::text,
    NULL::text,
    NULL::text,
    COALESCE(NULLIF(s.personal_email, ''), NULLIF(s.business_email, ''), NULLIF(s.email, '')),
    COALESCE(NULLIF(s.mobile_number, ''), NULLIF(s.phone, ''), NULLIF(s.work_number, ''), NULLIF(s.other_phone, '')),
    NULL::text,
    NULL::text,
    NULL::text,
    s.source_notes,
    s.profile_url,
    s.role,
    NULL::text,
    s.candidate_key,
    s.imported_at
  FROM public.tracker_sourcing s

  UNION ALL

  SELECT
    'submission'::text,
    'tracker_submissions'::text,
    s.id::text,
    s.tracker_row,
    s.candidate_name,
    s.current_title,
    s.current_company,
    s.location,
    s.industry,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text,
    s.target_current_compensation,
    s.additional_notes,
    NULL::text,
    s.role_submitted_for,
    s.client_submitted_to,
    s.candidate_key,
    s.imported_at
  FROM public.tracker_submissions s
), overlaid AS (
  SELECT
    b.candidate_source || ':' || b.candidate_source_id AS id,
    b.candidate_source,
    b.tracker_source,
    b.candidate_source_id,
    b.tracker_row,
    CASE WHEN e.edits ? 'candidate_name' THEN e.edits ->> 'candidate_name' ELSE b.candidate_name END AS candidate_name,
    CASE WHEN e.edits ? 'current_title' THEN e.edits ->> 'current_title' ELSE b.current_title END AS current_title,
    CASE WHEN e.edits ? 'current_company' THEN e.edits ->> 'current_company' ELSE b.current_company END AS current_company,
    CASE WHEN e.edits ? 'location' THEN e.edits ->> 'location' ELSE b.location END AS location,
    CASE WHEN e.edits ? 'industry' THEN e.edits ->> 'industry' ELSE b.industry END AS industry,
    CASE WHEN e.edits ? 'shift' THEN e.edits ->> 'shift' ELSE b.shift END AS shift,
    CASE WHEN e.edits ? 'email' THEN e.edits ->> 'email' ELSE b.email END AS email,
    CASE WHEN e.edits ? 'phone' THEN e.edits ->> 'phone' ELSE b.phone END AS phone,
    CASE WHEN e.edits ? 'compensation_target' THEN e.edits ->> 'compensation_target' ELSE b.compensation_target END AS compensation_target,
    CASE WHEN e.edits ? 'current_compensation' THEN e.edits ->> 'current_compensation' ELSE b.current_compensation END AS current_compensation,
    CASE WHEN e.edits ? 'compensation_context' THEN e.edits ->> 'compensation_context' ELSE b.compensation_context END AS compensation_context,
    CASE WHEN e.edits ? 'notes' THEN e.edits ->> 'notes' ELSE b.notes END AS notes,
    CASE WHEN e.edits ? 'profile_url' THEN e.edits ->> 'profile_url' ELSE b.profile_url END AS profile_url,
    CASE WHEN e.edits ? 'role_context' THEN e.edits ->> 'role_context' ELSE b.role_context END AS role_context,
    CASE WHEN e.edits ? 'client_context' THEN e.edits ->> 'client_context' ELSE b.client_context END AS client_context,
    b.source_candidate_key,
    b.source_updated_at,
    e.updated_at AS edited_at,
    false AS is_manual
  FROM imported b
  LEFT JOIN public.candidate_edits e
    ON e.owner_id = (SELECT auth.uid())
   AND e.tracker_source = b.tracker_source
   AND e.tracker_row = b.tracker_row
)
SELECT * FROM overlaid
UNION ALL
SELECT
  'manual:' || m.id::text AS id,
  'manual'::text AS candidate_source,
  NULL::text AS tracker_source,
  m.id::text AS candidate_source_id,
  NULL::integer AS tracker_row,
  m.candidate_name,
  m.current_title,
  m.current_company,
  m.location,
  m.industry,
  m.shift,
  m.email,
  m.phone,
  m.compensation_target,
  m.current_compensation,
  NULL::text AS compensation_context,
  m.notes,
  NULL::text AS profile_url,
  NULL::text AS role_context,
  NULL::text AS client_context,
  NULL::text AS source_candidate_key,
  m.updated_at AS source_updated_at,
  m.updated_at AS edited_at,
  true AS is_manual
FROM public.candidates_manual m;

COMMENT ON VIEW public.candidates_all IS
  'Source-preserving candidate rows with owner edits over Tracker imports and manual additions.';

REVOKE ALL ON TABLE public.candidates_all FROM anon;
GRANT SELECT ON TABLE public.candidates_all TO authenticated;
