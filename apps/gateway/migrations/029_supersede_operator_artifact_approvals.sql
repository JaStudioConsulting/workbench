-- Record supersession internally so old versions cannot be approved again.
-- The table is deliberately invisible to API roles; only trigger functions use it.
CREATE TABLE public.case_artifact_supersessions (
  owner_id uuid NOT NULL,
  case_id uuid NOT NULL,
  artifact_id uuid NOT NULL REFERENCES public.case_artifacts (id),
  superseding_artifact_id uuid NOT NULL REFERENCES public.case_artifacts (id),
  superseded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (artifact_id, superseding_artifact_id),
  CONSTRAINT case_artifact_supersessions_case_owner_fk
    FOREIGN KEY (case_id, owner_id) REFERENCES public.operator_cases (id, owner_id)
);
ALTER TABLE public.case_artifact_supersessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.case_artifact_supersessions FROM PUBLIC, anon, authenticated;

-- Adding a new artifact version supersedes older artifacts of the same type.
-- Rejecting an approved predecessor fires the existing UPDATE trigger, which
-- withdraws dependent action approvals without changing their manifest/timestamp.
CREATE OR REPLACE FUNCTION public.supersede_prior_case_artifact_approvals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM auth.uid() OR NOT public.is_authorized_recruiter() THEN
    RAISE EXCEPTION 'Authorized owner context is required to supersede artifact versions';
  END IF;

  PERFORM 1 FROM public.operator_cases c
    WHERE c.id = NEW.case_id AND c.owner_id = NEW.owner_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artifact case is unavailable';
  END IF;

  INSERT INTO public.case_artifact_supersessions (owner_id, case_id, artifact_id, superseding_artifact_id)
    SELECT prior.owner_id, prior.case_id, prior.id, NEW.id
    FROM public.case_artifacts prior
    WHERE prior.case_id = NEW.case_id AND prior.owner_id = NEW.owner_id
      AND prior.artifact_type = NEW.artifact_type AND prior.id <> NEW.id
    ON CONFLICT DO NOTHING;

  UPDATE public.case_artifacts prior
    SET review_state = 'rejected'
    WHERE prior.case_id = NEW.case_id
      AND prior.owner_id = NEW.owner_id
      AND prior.artifact_type = NEW.artifact_type
      AND prior.id <> NEW.id
      AND prior.review_state = 'approved';

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.supersede_prior_case_artifact_approvals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supersede_prior_case_artifact_approvals() TO authenticated;

CREATE TRIGGER case_artifacts_supersede_prior_approvals
  AFTER INSERT ON public.case_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.supersede_prior_case_artifact_approvals();

CREATE OR REPLACE FUNCTION public.prevent_superseded_case_artifact_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.review_state = 'approved' AND OLD.review_state IS DISTINCT FROM 'approved'
    AND EXISTS (
      SELECT 1 FROM public.case_artifact_supersessions supersession
      WHERE supersession.artifact_id = OLD.id AND supersession.owner_id = OLD.owner_id
    ) THEN
    RAISE EXCEPTION 'Superseded artifact versions cannot be approved; approve the latest version';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_superseded_case_artifact_approval() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prevent_superseded_case_artifact_approval() TO authenticated;

CREATE TRIGGER case_artifacts_prevent_superseded_approval
  BEFORE UPDATE ON public.case_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_superseded_case_artifact_approval();
