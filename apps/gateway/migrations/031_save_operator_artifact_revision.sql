-- Append an immutable, recruiter-authored draft version only when the expected
-- owner-scoped artifact is still the latest revision. The caller's Supabase
-- role and RLS remain in force; this function does not use SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.save_operator_artifact_revision(
  artifact_id uuid,
  expected_updated_at timestamptz,
  content jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid := auth.uid();
  v_case_id uuid;
  v_case_type text;
  v_artifact public.case_artifacts%ROWTYPE;
  v_inserted public.case_artifacts%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL OR NOT public.is_authorized_recruiter() THEN
    RAISE EXCEPTION 'Authorized recruiter session required';
  END IF;
  IF content IS NULL OR jsonb_typeof(content) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Artifact content must be a JSON object';
  END IF;

  SELECT c.id, c.case_type INTO v_case_id, v_case_type
    FROM public.operator_cases c
    JOIN public.case_artifacts a ON a.case_id = c.id AND a.owner_id = c.owner_id
    WHERE a.id = $1 AND a.owner_id = v_owner_id
    FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artifact is unavailable';
  END IF;

  SELECT a.* INTO v_artifact
    FROM public.case_artifacts a
    WHERE a.case_id = v_case_id AND a.owner_id = v_owner_id
      AND a.artifact_type = (
        SELECT current_artifact.artifact_type
        FROM public.case_artifacts current_artifact
        WHERE current_artifact.id = $1 AND current_artifact.case_id = v_case_id
          AND current_artifact.owner_id = v_owner_id
      )
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1
    FOR UPDATE;
  IF NOT FOUND OR v_artifact.id IS DISTINCT FROM $1
    OR v_artifact.updated_at IS DISTINCT FROM $2 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'STALE_ARTIFACT';
  END IF;

  INSERT INTO public.case_artifacts (
    case_id, artifact_type, source_ref, content, generated_by, review_state, reviewed_at
  ) VALUES (
    v_case_id, v_artifact.artifact_type,
    'human-edit:' || v_artifact.id::text || ':' || gen_random_uuid()::text,
    $3, 'human', 'draft', NULL
  ) RETURNING * INTO v_inserted;

  RETURN to_jsonb(v_inserted);
END;
$$;

REVOKE ALL ON FUNCTION public.save_operator_artifact_revision(uuid, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_operator_artifact_revision(uuid, timestamptz, jsonb) TO authenticated;
