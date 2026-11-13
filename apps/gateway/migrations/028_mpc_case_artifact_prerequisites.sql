ALTER TABLE public.operator_cases DROP CONSTRAINT IF EXISTS operator_cases_case_type_check;
ALTER TABLE public.operator_cases ADD CONSTRAINT operator_cases_case_type_check
  CHECK (case_type IN ('after_call', 'mpc', 'daily'));

CREATE OR REPLACE FUNCTION public.protect_operator_case_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.case_key IS DISTINCT FROM OLD.case_key OR NEW.case_type IS DISTINCT FROM OLD.case_type THEN
    RAISE EXCEPTION 'Operator case identity and ownership are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operator_cases_protect_identity BEFORE UPDATE ON public.operator_cases
  FOR EACH ROW EXECUTE FUNCTION public.protect_operator_case_identity();

-- The legacy queue has no 'completed' state. Record an explicit recruiter
-- report without implying a live Loxo sync.
ALTER TABLE public.candidate_review_actions DROP CONSTRAINT IF EXISTS candidate_review_actions_status_check;
ALTER TABLE public.candidate_review_actions ADD CONSTRAINT candidate_review_actions_status_check
  CHECK (status IN ('saved','waiting_for_loxo','failed','user_reported'));

CREATE OR REPLACE FUNCTION public.operator_case_primary_sources_current(p_case_id uuid, p_owner_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_case_type text;
  v_case_key text;
  v_match text[];
BEGIN
  IF p_owner_id IS DISTINCT FROM auth.uid() OR NOT public.is_authorized_recruiter() THEN RETURN false; END IF;
  SELECT c.case_type, c.case_key INTO v_case_type, v_case_key FROM public.operator_cases c
    WHERE c.id = p_case_id AND c.owner_id = p_owner_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_case_type = 'after_call' THEN
    v_match := regexp_match(v_case_key, '^after_call:(sourcing|submission):([1-9][0-9]*):([1-9][0-9]*)$');
    IF v_match IS NULL THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.case_sources candidate_source
      JOIN public.candidates_all candidate ON candidate.id = candidate_source.source_id
      JOIN public.case_sources job_source ON job_source.case_id = candidate_source.case_id AND job_source.owner_id = candidate_source.owner_id
      JOIN public.tracker_jobs job ON job.job_id::text = job_source.source_id
      JOIN public.case_sources transcript_source ON transcript_source.case_id = candidate_source.case_id AND transcript_source.owner_id = candidate_source.owner_id
      JOIN public.meeting_drafts meeting ON meeting.id::text = transcript_source.source_id
      WHERE candidate_source.case_id = p_case_id AND candidate_source.owner_id = p_owner_id
        AND candidate_source.source_type = 'candidate' AND candidate_source.required AND candidate_source.evidence_status = 'confirmed'
        AND candidate_source.source_id = v_match[1] || ':' || v_match[2]
        AND job_source.source_type = 'job' AND job_source.required AND job_source.evidence_status = 'confirmed'
        AND job_source.source_id = v_match[3] AND job.job_id::text = v_match[3]
        AND transcript_source.source_type = 'transcript' AND transcript_source.source_system = 'meeting_drafts'
        AND transcript_source.required AND transcript_source.evidence_status = 'confirmed'
        AND meeting.owner_id = p_owner_id AND length(btrim(meeting.transcript)) > 0
        AND meeting.candidate_source = v_match[1] AND meeting.candidate_source_id::text = v_match[2]
        AND meeting.job_id::text = v_match[3]
    );
  ELSIF v_case_type = 'mpc' THEN
    v_match := regexp_match(v_case_key, '^mpc:(sourcing|submission):([1-9][0-9]*):[a-zA-Z0-9_-]+$');
    IF v_match IS NULL THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.case_sources source
      JOIN public.candidates_all candidate ON candidate.id = source.source_id
      WHERE source.case_id = p_case_id AND source.owner_id = p_owner_id
        AND source.source_type = 'candidate' AND source.required AND source.evidence_status = 'confirmed'
        AND source.source_id = v_match[1] || ':' || v_match[2]
    );
  ELSIF v_case_type = 'daily' THEN
    v_match := regexp_match(v_case_key, '^daily:candidate_review_actions:([1-9][0-9]*)$');
    IF v_match IS NULL THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.candidate_review_actions task
      JOIN public.case_sources task_source ON task_source.case_id = p_case_id AND task_source.owner_id = p_owner_id
        AND task_source.source_type = 'draft' AND task_source.source_system = 'candidate_review_actions'
        AND task_source.source_id = task.id::text AND task_source.required AND task_source.evidence_status = 'confirmed'
      JOIN public.case_sources candidate_source ON candidate_source.case_id = p_case_id AND candidate_source.owner_id = p_owner_id
        AND candidate_source.source_type = 'candidate' AND candidate_source.required AND candidate_source.evidence_status = 'confirmed'
      JOIN public.candidates_all candidate ON candidate.id = candidate_source.source_id
      JOIN public.case_sources job_source ON job_source.case_id = p_case_id AND job_source.owner_id = p_owner_id
        AND job_source.source_type = 'job' AND job_source.required AND job_source.evidence_status = 'confirmed'
      JOIN public.tracker_jobs job ON job.job_id::text = job_source.source_id
      WHERE task.id::text = v_match[1] AND task.status IN ('waiting_for_loxo','user_reported')
        AND candidate_source.source_id = task.candidate_source || ':' || task.candidate_source_id::text
        AND job_source.source_id = task.job_id::text
    );
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.operator_case_primary_sources_current(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_case_primary_sources_current(uuid,uuid) TO authenticated;

-- Daily cases are anchored to an existing review queue item. Keep its exact
-- candidate/job linkage and queue state authoritative at evidence confirmation.
CREATE OR REPLACE FUNCTION public.validate_operator_case_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_case_key text;
  v_case_type text;
  v_match text[];
  v_candidate_id text;
  v_job_id bigint;
  v_action_id bigint;
  v_action record;
BEGIN
  IF NEW.evidence_status <> 'confirmed' THEN RETURN NEW; END IF;
  SELECT c.case_key, c.case_type INTO v_case_key, v_case_type FROM public.operator_cases c
    WHERE c.id = NEW.case_id AND c.owner_id = NEW.owner_id;
  IF v_case_key IS NULL THEN RAISE EXCEPTION 'Case source must belong to an existing case'; END IF;

  IF v_case_type = 'daily' THEN
    v_match := regexp_match(v_case_key, '^daily:candidate_review_actions:([1-9][0-9]*)$');
    IF v_match IS NULL THEN RAISE EXCEPTION 'Daily case is not linked to a supported review action'; END IF;
    v_action_id := v_match[1]::bigint;
    SELECT action.* INTO v_action FROM public.candidate_review_actions action
      WHERE action.id = v_action_id AND action.status IN ('waiting_for_loxo','user_reported');
    IF NOT FOUND THEN RAISE EXCEPTION 'Daily review action is missing or no longer active'; END IF;
    IF NEW.source_type = 'candidate' AND NEW.source_system = 'supabase_tracker' THEN
      v_candidate_id := v_action.candidate_source || ':' || v_action.candidate_source_id::text;
      IF NEW.source_id <> v_candidate_id OR NOT EXISTS (
        SELECT 1 FROM public.candidates_all candidate WHERE candidate.id = v_candidate_id
      ) THEN RAISE EXCEPTION 'Daily candidate source does not match the live review action'; END IF;
      RETURN NEW;
    ELSIF NEW.source_type = 'job' AND NEW.source_system = 'supabase_tracker' THEN
      IF NEW.source_id <> v_action.job_id::text OR NOT EXISTS (
        SELECT 1 FROM public.tracker_jobs job WHERE job.job_id = v_action.job_id
      ) THEN RAISE EXCEPTION 'Daily job source does not match the live review action'; END IF;
      RETURN NEW;
    ELSIF NEW.source_type = 'draft' AND NEW.source_system = 'candidate_review_actions' THEN
      IF NEW.source_id <> v_action_id::text THEN RAISE EXCEPTION 'Daily task source does not match its review action'; END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'This source kind cannot be confirmed for a daily case';
  END IF;

  IF NEW.source_type = 'candidate' AND NEW.source_system = 'supabase_tracker' THEN
    IF v_case_type = 'after_call' THEN
      v_match := regexp_match(v_case_key, '^after_call:(.+):([1-9][0-9]*)$');
      IF v_match IS NULL THEN RAISE EXCEPTION 'Candidate source is not linked to a supported case'; END IF;
      v_candidate_id := v_match[1];
    ELSIF v_case_type = 'mpc' THEN
      v_match := regexp_match(v_case_key, '^mpc:(sourcing|submission):([1-9][0-9]*):[a-zA-Z0-9_-]+$');
      IF v_match IS NULL THEN RAISE EXCEPTION 'Candidate source is not linked to a supported MPC case'; END IF;
      v_candidate_id := v_match[1] || ':' || v_match[2];
    END IF;
    v_candidate_id := coalesce(v_candidate_id, NEW.source_id);
    IF NEW.source_id <> v_candidate_id OR NOT EXISTS (
      SELECT 1 FROM public.candidates_all candidate WHERE candidate.id = v_candidate_id
    ) THEN RAISE EXCEPTION 'Confirmed candidate source does not match a live candidate'; END IF;
    RETURN NEW;
  ELSIF NEW.source_type = 'job' AND NEW.source_system = 'supabase_tracker' THEN
    IF v_case_type = 'after_call' THEN
      v_match := regexp_match(v_case_key, '^after_call:(.+):([1-9][0-9]*)$');
      IF v_match IS NULL THEN RAISE EXCEPTION 'Job source is not linked to a supported case'; END IF;
      v_job_id := v_match[2]::bigint;
    ELSE
      v_job_id := NEW.source_id::bigint;
    END IF;
    IF NEW.source_id <> v_job_id::text OR NOT EXISTS (
      SELECT 1 FROM public.tracker_jobs job WHERE job.job_id = v_job_id
    ) THEN RAISE EXCEPTION 'Confirmed job source does not match a live job'; END IF;
    RETURN NEW;
  ELSIF NEW.source_type IN ('transcript','notes') AND NEW.source_system = 'meeting_drafts' THEN
    IF NEW.source_id !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'Meeting evidence is not linked to a supported case'; END IF;
    IF v_case_type = 'after_call' THEN
      v_match := regexp_match(v_case_key, '^after_call:(sourcing|submission):([1-9][0-9]*):([1-9][0-9]*)$');
      IF v_match IS NULL THEN RAISE EXCEPTION 'Meeting evidence is not linked to a supported case'; END IF;
      v_job_id := v_match[3]::bigint;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.meeting_drafts meeting
      WHERE meeting.id = NEW.source_id::uuid AND meeting.owner_id = NEW.owner_id
        AND (v_case_type <> 'after_call' OR (meeting.job_id = v_job_id AND meeting.candidate_source = v_match[1]
          AND meeting.candidate_source_id = v_match[2]::bigint))
        AND CASE WHEN NEW.source_type = 'transcript' THEN length(btrim(meeting.transcript)) > 0
          ELSE length(btrim(meeting.notes)) > 0 END
    ) THEN RAISE EXCEPTION 'Confirmed meeting evidence does not match a saved meeting'; END IF;
    RETURN NEW;
  ELSIF NEW.source_system = 'human_review' AND NEW.source_type IN ('resume','notes','transcript','client','communication','draft') THEN
    IF NEW.metadata ->> 'reviewedBy' IS DISTINCT FROM NEW.owner_id::text
      OR NEW.observed_at IS NULL THEN
      RAISE EXCEPTION 'Human-reviewed evidence requires its reviewer and review time';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This source kind cannot be marked confirmed';
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_approved_case_action_manifest()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_case_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.approval_state <> 'proposed' OR NEW.approved_at IS NOT NULL
      OR NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL THEN
      RAISE EXCEPTION 'Approved action insert is forbidden; actions must be created proposed and unapproved';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.approval_state = 'approved' AND OLD.approval_state IS DISTINCT FROM 'approved' THEN
    NEW.approved_at := clock_timestamp();
  ELSIF TG_OP = 'UPDATE' AND OLD.approved_at IS NOT NULL THEN
    NEW.approved_at := OLD.approved_at;
  ELSIF NEW.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Approval timestamps are managed by the database';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL THEN
    IF NEW.approval_state IS DISTINCT FROM 'completed'
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.completed_by IS DISTINCT FROM OLD.completed_by THEN
      RAISE EXCEPTION 'Completion history is immutable';
    END IF;
    NEW.completed_at := OLD.completed_at;
    NEW.completed_by := OLD.completed_by;
  ELSIF TG_OP = 'UPDATE' AND NEW.approval_state = 'completed'
    AND OLD.approval_state IN ('approved','queued') THEN
    IF NEW.action_type <> 'loxo_queue'
      OR NEW.manifest ->> 'operation' <> 'manual_loxo_entry'
      OR NEW.manifest ->> 'execution' <> 'user_reported' THEN
      RAISE EXCEPTION 'Only a user-reported manual Loxo entry can be marked complete';
    END IF;
    NEW.completed_at := clock_timestamp();
    NEW.completed_by := auth.uid();
  ELSIF NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL THEN
    RAISE EXCEPTION 'Completion fields are managed by the database';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approved_at IS NOT NULL
    AND (NEW.manifest IS DISTINCT FROM OLD.manifest OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.action_type IS DISTINCT FROM OLD.action_type OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'Approved action manifests are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'Approval history is immutable';
  END IF;
  IF NEW.approval_state = 'approved' AND (TG_OP = 'INSERT' OR OLD.approval_state IS DISTINCT FROM 'approved') THEN
    IF TG_OP = 'UPDATE' AND OLD.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'An approved action cannot be reapproved; create a new exact action';
    END IF;
    IF NOT ((NEW.action_type = 'gmail_draft' AND NEW.manifest ->> 'operation' = 'create_draft_only')
      OR (NEW.action_type = 'loxo_queue' AND NEW.manifest ->> 'operation' = 'manual_loxo_entry'
        AND NEW.manifest ->> 'execution' = 'user_reported')
      OR (NEW.action_type = 'external_submission' AND NEW.manifest ->> 'operation' = 'review_submission')) THEN
      RAISE EXCEPTION 'Action type does not match an allowed draft, review, or manual queue operation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.case_artifacts a
      WHERE a.id = (NEW.manifest ->> 'artifactId')::uuid AND a.case_id = NEW.case_id
        AND a.owner_id = NEW.owner_id
        AND ((NEW.action_type = 'gmail_draft' AND a.artifact_type = 'presentation_email')
          OR (NEW.action_type = 'loxo_queue' AND a.artifact_type = 'loxo_update')
          OR (NEW.action_type = 'external_submission' AND a.artifact_type = 'candidate_submission'))
    ) THEN RAISE EXCEPTION 'Action type does not match its reviewed artifact'; END IF;
    IF NEW.manifest ->> 'caseId' IS DISTINCT FROM NEW.case_id::text THEN
      RAISE EXCEPTION 'Manifest case does not match action case';
    END IF;
    IF NOT (NEW.manifest ? 'artifactId' AND NEW.manifest ? 'artifactVersion' AND NEW.manifest ? 'contentSnapshot') THEN
      RAISE EXCEPTION 'Approval requires an exact artifact content snapshot';
    END IF;
    PERFORM 1 FROM public.case_artifacts a
      WHERE a.id = (NEW.manifest ->> 'artifactId')::uuid
        AND a.case_id = NEW.case_id AND a.owner_id = NEW.owner_id
        AND a.review_state = 'approved'
        AND a.created_at = (NEW.manifest ->> 'artifactVersion')::timestamptz
        AND a.content = NEW.manifest -> 'contentSnapshot';
    IF NOT FOUND THEN RAISE EXCEPTION 'Approved artifact snapshot is missing, changed, or unreviewed'; END IF;
    IF jsonb_typeof(NEW.manifest -> 'requiredSources') = 'array' THEN
      SELECT c.case_type INTO v_case_type FROM public.operator_cases c
        WHERE c.id = NEW.case_id AND c.owner_id = NEW.owner_id;
      IF NOT public.operator_case_primary_sources_current(NEW.case_id, NEW.owner_id) OR EXISTS (
        SELECT 1 FROM public.case_sources source
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.required AND source.evidence_status <> 'confirmed'
      ) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.manifest -> 'requiredSources') required(source_type)
        WHERE required.source_type = 'candidate'
      ) OR NOT EXISTS (
        SELECT 1 FROM public.case_sources candidate_source
        JOIN public.candidates_all candidate ON candidate.id = candidate_source.source_id
        WHERE candidate_source.case_id = NEW.case_id AND candidate_source.owner_id = NEW.owner_id
          AND candidate_source.source_type = 'candidate' AND candidate_source.required
          AND candidate_source.evidence_status = 'confirmed'
      ) OR (v_case_type IN ('after_call','daily') AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.manifest -> 'requiredSources') required(source_type)
        WHERE required.source_type = 'job'
      )) OR (v_case_type = 'after_call' AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.manifest -> 'requiredSources') required(source_type)
        WHERE required.source_type = 'transcript'
      )) OR (v_case_type = 'daily' AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.manifest -> 'requiredSources') required(source_type)
        WHERE required.source_type = 'draft'
      )) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.manifest -> 'requiredSources') required(source_type)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.case_sources source
          WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
            AND source.source_type = required.source_type AND source.required
            AND source.evidence_status = 'confirmed'
        )
      ) THEN RAISE EXCEPTION 'Required source evidence is not confirmed'; END IF;
    ELSE
      RAISE EXCEPTION 'Manifest must identify required source evidence';
    END IF;
  END IF;
  IF NEW.approval_state IN ('queued','completed')
    AND (NEW.approved_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.approval_state NOT IN ('approved','queued'))) THEN
    RAISE EXCEPTION 'Queued or completed actions require a current approval';
  END IF;
  IF NEW.approval_state = 'completed' AND (NEW.completed_at IS NULL OR NEW.completed_by IS NULL) THEN
    RAISE EXCEPTION 'Completed action requires a database-recorded user report';
  END IF;
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.require_confirmed_sources_for_case_artifact_review()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_case_type text;
  v_case_key text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.review_state <> 'draft' THEN
    RAISE EXCEPTION 'Approved artifact insert is forbidden; artifacts must be created as drafts';
  END IF;
  IF NEW.review_state = 'approved' AND (TG_OP = 'INSERT' OR OLD.review_state IS DISTINCT FROM 'approved') THEN
    IF NEW.reviewed_at IS NULL THEN RAISE EXCEPTION 'Artifact review timestamp is required'; END IF;
    SELECT c.case_type, c.case_key INTO v_case_type, v_case_key FROM public.operator_cases c
      WHERE c.id = NEW.case_id AND c.owner_id = NEW.owner_id;
      IF NOT public.operator_case_primary_sources_current(NEW.case_id, NEW.owner_id) OR EXISTS (
      SELECT 1 FROM public.case_sources source
      WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
        AND source.required AND source.evidence_status <> 'confirmed'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.case_sources source
      WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
        AND source.source_type = 'candidate' AND source.required AND source.evidence_status = 'confirmed'
        AND EXISTS (SELECT 1 FROM public.candidates_all candidate WHERE candidate.id = source.source_id)
    ) THEN
      RAISE EXCEPTION 'Required source evidence is not confirmed';
    END IF;
    IF v_case_type = 'after_call' AND (
      NOT EXISTS (
        SELECT 1 FROM public.case_sources source
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.source_type = 'job' AND source.required AND source.evidence_status = 'confirmed'
          AND source.source_id = split_part(v_case_key, ':', 4)
          AND EXISTS (SELECT 1 FROM public.tracker_jobs job WHERE job.job_id::text = source.source_id)
      ) OR NOT EXISTS (
        SELECT 1 FROM public.case_sources source
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.source_type = 'transcript' AND source.required AND source.evidence_status = 'confirmed'
          AND source.source_system = 'meeting_drafts'
          AND EXISTS (
            SELECT 1 FROM public.meeting_drafts meeting
            WHERE meeting.id::text = source.source_id AND meeting.owner_id = NEW.owner_id
              AND length(btrim(meeting.transcript)) > 0
              AND meeting.job_id::text = split_part(v_case_key, ':', 4)
              AND meeting.candidate_source = split_part(v_case_key, ':', 2)
              AND meeting.candidate_source_id::text = split_part(v_case_key, ':', 3)
          )
      )
    ) THEN
      RAISE EXCEPTION 'Required after-call source evidence is not confirmed';
    ELSIF v_case_type = 'daily' AND (
      NOT EXISTS (
        SELECT 1 FROM public.case_sources source
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.source_type = 'job' AND source.required AND source.evidence_status = 'confirmed'
          AND EXISTS (SELECT 1 FROM public.tracker_jobs job WHERE job.job_id::text = source.source_id)
      ) OR NOT EXISTS (
        SELECT 1 FROM public.case_sources source
        JOIN public.candidate_review_actions action ON action.id::text = source.source_id
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.source_type = 'draft' AND source.source_system = 'candidate_review_actions'
          AND source.required AND source.evidence_status = 'confirmed'
          AND action.status IN ('waiting_for_loxo','user_reported')
          AND EXISTS (
            SELECT 1 FROM public.case_sources candidate_source
            WHERE candidate_source.case_id = source.case_id AND candidate_source.owner_id = source.owner_id
              AND candidate_source.source_type = 'candidate' AND candidate_source.required
              AND candidate_source.evidence_status = 'confirmed'
              AND candidate_source.source_id = action.candidate_source || ':' || action.candidate_source_id::text
              AND EXISTS (SELECT 1 FROM public.candidates_all candidate WHERE candidate.id = candidate_source.source_id)
          )
          AND EXISTS (
            SELECT 1 FROM public.case_sources job_source
            WHERE job_source.case_id = source.case_id AND job_source.owner_id = source.owner_id
              AND job_source.source_type = 'job' AND job_source.required
              AND job_source.evidence_status = 'confirmed'
              AND job_source.source_id = action.job_id::text
          )
      )
    ) THEN
      RAISE EXCEPTION 'Required daily review-action evidence is not confirmed';
    ELSIF v_case_type NOT IN ('after_call','mpc','daily') THEN
      RAISE EXCEPTION 'Unsupported operator case type';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Artifact/action approval prerequisites differ by workflow. Daily queue actions
-- are explicitly linked to the legacy candidate_review_actions record; they do
-- not invent a meeting transcript.

CREATE OR REPLACE FUNCTION public.complete_daily_review_action(p_case_action_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_action public.case_actions%ROWTYPE;
  v_case_type text;
  v_task_id bigint;
  v_queue_status text;
  v_task public.candidate_review_actions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized_recruiter() THEN
    RAISE EXCEPTION 'Authorized recruiter session required';
  END IF;
  SELECT action.* INTO v_action FROM public.case_actions action
    WHERE action.id = p_case_action_id AND action.owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Daily review action not found'; END IF;
  SELECT c.case_type INTO v_case_type FROM public.operator_cases c
    WHERE c.id = v_action.case_id AND c.owner_id = auth.uid();
  IF v_case_type IS DISTINCT FROM 'daily' OR v_action.action_type IS DISTINCT FROM 'loxo_queue'
    OR v_action.manifest ->> 'operation' IS DISTINCT FROM 'manual_loxo_entry'
    OR v_action.manifest ->> 'execution' IS DISTINCT FROM 'user_reported'
    OR NOT (v_action.manifest -> 'requiredSources' @> '["candidate","job","draft"]'::jsonb) THEN
    RAISE EXCEPTION 'This is not an approved daily manual Loxo entry';
  END IF;
  SELECT source.source_id::bigint INTO v_task_id FROM public.case_sources source
    WHERE source.case_id = v_action.case_id AND source.owner_id = auth.uid()
      AND source.source_type = 'draft' AND source.source_system = 'candidate_review_actions'
      AND source.required AND source.evidence_status = 'confirmed';
  IF v_task_id IS NULL THEN RAISE EXCEPTION 'The original Home queue item is missing'; END IF;
  SELECT task.* INTO v_task FROM public.candidate_review_actions task
    WHERE task.id = v_task_id FOR UPDATE;
  IF NOT FOUND OR v_task.status NOT IN ('waiting_for_loxo','user_reported') THEN
    RAISE EXCEPTION 'The original Home queue item changed before completion';
  END IF;
  IF NOT public.operator_case_primary_sources_current(v_action.case_id, auth.uid()) THEN
    RAISE EXCEPTION 'Daily review evidence changed; refresh and review the case';
  END IF;

  IF v_action.approval_state IN ('approved','queued') THEN
    UPDATE public.case_actions SET approval_state = 'completed'
      WHERE id = v_action.id AND owner_id = auth.uid();
  ELSIF v_action.approval_state <> 'completed' THEN
    RAISE EXCEPTION 'Approve the exact manual Loxo entry before reporting completion';
  END IF;

  UPDATE public.candidate_review_actions SET status = 'user_reported'
    WHERE id = v_task_id AND status = 'waiting_for_loxo';
  SELECT task.status INTO v_queue_status FROM public.candidate_review_actions task WHERE task.id = v_task_id;
  IF v_queue_status <> 'user_reported' THEN
    RAISE EXCEPTION 'The original Home queue item changed before completion';
  END IF;
  RETURN jsonb_build_object('caseActionId', v_action.id, 'queueActionId', v_task_id,
    'actionStatus', 'completed', 'queueStatus', 'user_reported', 'execution', 'user_reported');
END;
$$;
REVOKE ALL ON FUNCTION public.complete_daily_review_action(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_daily_review_action(uuid) TO authenticated;
