-- Candidates entered by Ja in Workbench. No Tracker import writes here.
CREATE TABLE public.candidates_manual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  candidate_name text NOT NULL CHECK (length(btrim(candidate_name)) > 0),
  current_title text,
  current_company text,
  location text,
  industry text,
  shift text,
  email text,
  phone text,
  compensation_target text,
  current_compensation text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.candidates_manual IS
  'Candidates explicitly entered in Workbench by their owner; not part of Tracker imports.';

CREATE INDEX candidates_manual_owner_updated_idx
  ON public.candidates_manual (owner_id, updated_at DESC);

CREATE INDEX candidates_manual_owner_name_idx
  ON public.candidates_manual (owner_id, lower(candidate_name));

CREATE FUNCTION public.touch_candidates_manual_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER candidates_manual_touch_updated_at
  BEFORE UPDATE ON public.candidates_manual
  FOR EACH ROW EXECUTE FUNCTION public.touch_candidates_manual_updated_at();

ALTER TABLE public.candidates_manual ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.candidates_manual FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidates_manual TO authenticated;

CREATE POLICY candidates_manual_select_own ON public.candidates_manual
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidates_manual_insert_own ON public.candidates_manual
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidates_manual_update_own ON public.candidates_manual
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidates_manual_delete_own ON public.candidates_manual
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
