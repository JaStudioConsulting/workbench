-- Ja's field-level corrections to imported Tracker candidates.
-- Import jobs must never update this table. The read view overlays these
-- values on Tracker rows; the original import remains read-only.
CREATE TABLE public.candidate_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  tracker_source text NOT NULL CHECK (tracker_source IN ('tracker_candidates', 'tracker_sourcing', 'tracker_submissions')),
  tracker_row integer NOT NULL CHECK (tracker_row > 0),
  edits jsonb NOT NULL CHECK (jsonb_typeof(edits) = 'object' AND edits <> '{}'::jsonb),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, tracker_source, tracker_row)
);

COMMENT ON TABLE public.candidate_edits IS
  'Owner corrections over read-only Tracker import rows; import jobs never overwrite these edits.';
COMMENT ON COLUMN public.candidate_edits.edits IS
  'Only fields explicitly edited by the owner; absent keys retain their Tracker values.';

CREATE INDEX candidate_edits_owner_updated_idx
  ON public.candidate_edits (owner_id, updated_at DESC);

CREATE FUNCTION public.touch_candidate_edits_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER candidate_edits_touch_updated_at
  BEFORE UPDATE ON public.candidate_edits
  FOR EACH ROW EXECUTE FUNCTION public.touch_candidate_edits_updated_at();

ALTER TABLE public.candidate_edits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.candidate_edits FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidate_edits TO authenticated;

CREATE POLICY candidate_edits_select_own ON public.candidate_edits
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidate_edits_insert_own ON public.candidate_edits
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidate_edits_update_own ON public.candidate_edits
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidate_edits_delete_own ON public.candidate_edits
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
