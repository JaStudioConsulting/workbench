-- Operator cases are the approval layer over Tracker data imported from Google
-- Sheets. They store stable source references, generated drafts, and exact
-- action manifests; they do not duplicate the candidate or job record.

CREATE TABLE public.operator_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  case_key text NOT NULL CHECK (length(btrim(case_key)) BETWEEN 3 AND 300),
  case_type text NOT NULL CHECK (case_type IN ('after_call', 'mpc')),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 300),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'blocked', 'ready_for_review', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  UNIQUE (owner_id, case_key)
);

COMMENT ON TABLE public.operator_cases IS
  'Recruiter approval cases keyed by stable source IDs; Google Sheets remains the business source and Supabase is the operating database.';

CREATE TABLE public.case_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('candidate', 'job', 'meeting', 'transcript', 'resume', 'notes', 'client', 'communication', 'draft')),
  source_system text NOT NULL CHECK (length(btrim(source_system)) BETWEEN 1 AND 100),
  source_id text NOT NULL CHECK (length(btrim(source_id)) BETWEEN 1 AND 500),
  label text NOT NULL DEFAULT '' CHECK (length(label) <= 300),
  evidence_status text NOT NULL CHECK (evidence_status IN ('confirmed', 'missing', 'conflicting', 'stale')),
  required boolean NOT NULL DEFAULT true,
  observed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_sources_case_owner_fk FOREIGN KEY (case_id, owner_id)
    REFERENCES public.operator_cases (id, owner_id) ON DELETE CASCADE,
  UNIQUE (owner_id, case_id, source_type, source_system, source_id)
);

CREATE TABLE public.case_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  artifact_type text NOT NULL CHECK (artifact_type IN (
    'branded_resume', 'candidate_submission', 'presentation_email', 'loxo_update',
    'candidate_positioning', 'target_companies', 'contacts', 'hiring_signals', 'outreach_draft'
  )),
  source_ref text NOT NULL CHECK (length(btrim(source_ref)) BETWEEN 1 AND 500),
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  review_state text NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'approved', 'rejected')),
  generated_by text NOT NULL DEFAULT 'local_draft_preparer' CHECK (generated_by IN ('local_draft_preparer', 'recruitment_mcp', 'human')),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_artifacts_case_owner_fk FOREIGN KEY (case_id, owner_id)
    REFERENCES public.operator_cases (id, owner_id) ON DELETE CASCADE,
  UNIQUE (owner_id, case_id, artifact_type, source_ref)
);

CREATE TABLE public.case_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('gmail_draft', 'loxo_queue', 'tracker_write', 'external_submission', 'review')),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 300),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  approval_state text NOT NULL DEFAULT 'proposed' CHECK (approval_state IN ('proposed', 'approved', 'queued', 'completed', 'rejected')),
  blocked_reason text CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 500),
  approved_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_actions_case_owner_fk FOREIGN KEY (case_id, owner_id)
    REFERENCES public.operator_cases (id, owner_id) ON DELETE CASCADE,
  UNIQUE (owner_id, idempotency_key)
);

COMMENT ON TABLE public.case_actions IS
  'Exact approval manifests only. Approval does not execute an email send, Loxo change, Tracker write, or submission.';

CREATE INDEX operator_cases_owner_status_idx ON public.operator_cases (owner_id, status, updated_at DESC);
CREATE INDEX case_sources_owner_case_idx ON public.case_sources (owner_id, case_id, source_type);
CREATE INDEX case_artifacts_owner_case_idx ON public.case_artifacts (owner_id, case_id, review_state);
CREATE INDEX case_actions_owner_case_idx ON public.case_actions (owner_id, case_id, approval_state);

CREATE FUNCTION public.touch_operator_case_record_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = GREATEST(clock_timestamp(), OLD.updated_at + interval '1 millisecond');
  RETURN NEW;
END;
$$;

CREATE TRIGGER operator_cases_touch_updated_at BEFORE UPDATE ON public.operator_cases
  FOR EACH ROW EXECUTE FUNCTION public.touch_operator_case_record_updated_at();
CREATE TRIGGER case_sources_touch_updated_at BEFORE UPDATE ON public.case_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_operator_case_record_updated_at();
CREATE TRIGGER case_artifacts_touch_updated_at BEFORE UPDATE ON public.case_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_operator_case_record_updated_at();
CREATE TRIGGER case_actions_touch_updated_at BEFORE UPDATE ON public.case_actions
  FOR EACH ROW EXECUTE FUNCTION public.touch_operator_case_record_updated_at();

-- A case association is part of every source, output, and approval identity.
-- Moving one requires a new record and fresh review rather than carrying state.
CREATE FUNCTION public.protect_operator_case_record_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id THEN
    RAISE EXCEPTION 'Operator case record identity and ownership are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER case_sources_protect_identity BEFORE UPDATE ON public.case_sources
  FOR EACH ROW EXECUTE FUNCTION public.protect_operator_case_record_identity();
CREATE TRIGGER case_artifacts_protect_identity BEFORE UPDATE ON public.case_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.protect_operator_case_record_identity();
CREATE TRIGGER case_actions_protect_identity BEFORE UPDATE ON public.case_actions
  FOR EACH ROW EXECUTE FUNCTION public.protect_operator_case_record_identity();

ALTER TABLE public.operator_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.operator_cases, public.case_sources, public.case_artifacts, public.case_actions FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.operator_cases, public.case_artifacts, public.case_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.case_sources TO authenticated;

CREATE POLICY operator_cases_select_own ON public.operator_cases FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY operator_cases_insert_own ON public.operator_cases FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY operator_cases_update_own ON public.operator_cases FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY case_sources_select_own ON public.case_sources FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY case_sources_insert_own ON public.case_sources FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY case_sources_update_own ON public.case_sources FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY case_sources_delete_own ON public.case_sources FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY case_artifacts_select_own ON public.case_artifacts FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY case_artifacts_insert_own ON public.case_artifacts FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY case_artifacts_update_own ON public.case_artifacts FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY case_actions_select_own ON public.case_actions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY case_actions_insert_own ON public.case_actions FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY case_actions_update_own ON public.case_actions FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

-- Confirmed primary evidence must point to the live candidate, job, or saved
-- meeting attached to this exact case. Other external evidence is explicitly
-- recorded as a human-reviewed reference and cannot stand in for these roots.
CREATE FUNCTION public.validate_operator_case_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_case_key text;
  v_case_type text;
  v_match text[];
  v_candidate_id text;
  v_job_id bigint;
BEGIN
  IF NEW.evidence_status <> 'confirmed' THEN RETURN NEW; END IF;

  SELECT c.case_key, c.case_type INTO v_case_key, v_case_type FROM public.operator_cases c
    WHERE c.id = NEW.case_id AND c.owner_id = NEW.owner_id;
  IF v_case_key IS NULL THEN RAISE EXCEPTION 'Case source must belong to an existing case'; END IF;

  IF NEW.source_type = 'candidate' AND NEW.source_system = 'supabase_tracker' THEN
    IF v_case_type = 'after_call' THEN
      v_match := regexp_match(v_case_key, '^after_call:(.+):([1-9][0-9]*)$');
      IF v_match IS NULL THEN RAISE EXCEPTION 'Candidate source is not linked to a supported case'; END IF;
      v_candidate_id := v_match[1];
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

CREATE TRIGGER case_sources_validate_confirmed
  BEFORE INSERT OR UPDATE OF case_id, owner_id, source_type, source_system, source_id, evidence_status, observed_at, metadata
  ON public.case_sources FOR EACH ROW EXECUTE FUNCTION public.validate_operator_case_source();

-- Approved manifests are immutable. A changed action requires a new exact
-- manifest and idempotency key, followed by a separate approval.
CREATE FUNCTION public.protect_approved_case_action_manifest()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
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
      IF EXISTS (
        SELECT 1 FROM public.case_sources source
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.required AND source.evidence_status <> 'confirmed'
      ) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.manifest -> 'requiredSources') required(source_type)
        WHERE required.source_type = 'candidate'
      ) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.manifest -> 'requiredSources') required(source_type)
        WHERE required.source_type = 'job'
      ) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.manifest -> 'requiredSources') required(source_type)
        WHERE required.source_type = 'transcript'
      ) OR EXISTS (
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

CREATE TRIGGER case_actions_protect_approved_manifest
  BEFORE INSERT OR UPDATE ON public.case_actions
  FOR EACH ROW EXECUTE FUNCTION public.protect_approved_case_action_manifest();

CREATE FUNCTION public.require_confirmed_sources_for_case_artifact_review()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.review_state <> 'draft' THEN
    RAISE EXCEPTION 'Approved artifact insert is forbidden; artifacts must be created as drafts';
  END IF;
  IF NEW.review_state = 'approved' AND (TG_OP = 'INSERT' OR OLD.review_state IS DISTINCT FROM 'approved') THEN
    IF NEW.reviewed_at IS NULL THEN RAISE EXCEPTION 'Artifact review timestamp is required'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.case_sources source
      WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
        AND source.required AND source.evidence_status <> 'confirmed'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.case_sources source
      WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
        AND source.source_type = 'candidate' AND source.required AND source.evidence_status = 'confirmed'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.case_sources source
      WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
        AND source.source_type = 'job' AND source.required AND source.evidence_status = 'confirmed'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.case_sources source
      WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
        AND source.source_type = 'transcript' AND source.required AND source.evidence_status = 'confirmed'
    ) THEN
      RAISE EXCEPTION 'Required source evidence is not confirmed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER case_artifacts_require_confirmed_sources
  BEFORE INSERT OR UPDATE ON public.case_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.require_confirmed_sources_for_case_artifact_review();

CREATE FUNCTION public.protect_case_artifact_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.artifact_type IS DISTINCT FROM OLD.artifact_type OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
    OR NEW.generated_by IS DISTINCT FROM OLD.generated_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Artifact version identity is immutable; create a new artifact version';
  END IF;
  IF OLD.review_state = 'approved' AND NEW.review_state = 'approved'
    AND NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
    RAISE EXCEPTION 'Approved artifact review history is immutable';
  END IF;
  IF NEW.content IS DISTINCT FROM OLD.content
    AND (NEW.review_state IS DISTINCT FROM 'draft' OR NEW.reviewed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Editing an artifact must return it to draft';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER case_artifacts_protect_version BEFORE UPDATE ON public.case_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.protect_case_artifact_version();

-- Editing an output withdraws any approval that depended on its old snapshot.
-- Keep approved_at and the manifest untouched as an immutable audit record.
CREATE FUNCTION public.invalidate_case_action_approvals_for_artifact()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.review_state IS DISTINCT FROM OLD.review_state THEN
    UPDATE public.case_actions action
      SET approval_state = 'rejected'
      WHERE action.case_id = OLD.case_id AND action.owner_id = OLD.owner_id
        AND action.approved_at IS NOT NULL
        AND action.manifest ->> 'artifactId' = OLD.id::text
        AND action.approval_state IN ('approved', 'queued');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER case_artifacts_invalidate_dependent_approvals
  AFTER UPDATE ON public.case_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_case_action_approvals_for_artifact();

-- Evidence changes withdraw reviewed artifacts; the existing artifact trigger
-- then withdraws any dependent action approvals while preserving their manifest.
CREATE FUNCTION public.invalidate_case_reviews_for_source_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  affected_case uuid;
  affected_owner uuid;
  evidence_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected_case := NEW.case_id;
    affected_owner := NEW.owner_id;
    evidence_changed := NEW.required;
  ELSIF TG_OP = 'DELETE' THEN
    affected_case := OLD.case_id;
    affected_owner := OLD.owner_id;
    evidence_changed := OLD.required;
  ELSE
    affected_case := NEW.case_id;
    affected_owner := NEW.owner_id;
    evidence_changed := (OLD.required OR NEW.required) AND (
      OLD.required IS DISTINCT FROM NEW.required
      OR OLD.evidence_status IS DISTINCT FROM NEW.evidence_status
      OR OLD.source_type IS DISTINCT FROM NEW.source_type
      OR OLD.source_system IS DISTINCT FROM NEW.source_system
      OR OLD.source_id IS DISTINCT FROM NEW.source_id
      OR OLD.label IS DISTINCT FROM NEW.label
      OR OLD.observed_at IS DISTINCT FROM NEW.observed_at
      OR OLD.metadata IS DISTINCT FROM NEW.metadata
    );
  END IF;
  IF evidence_changed THEN
    UPDATE public.case_artifacts artifact
      SET review_state = 'rejected', reviewed_at = clock_timestamp()
      WHERE artifact.case_id = affected_case AND artifact.owner_id = affected_owner
        AND artifact.review_state = 'approved';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER case_sources_invalidate_reviews
  AFTER INSERT OR UPDATE OR DELETE ON public.case_sources
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_case_reviews_for_source_change();
