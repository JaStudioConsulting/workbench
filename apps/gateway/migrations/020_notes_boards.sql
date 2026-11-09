-- Workbench content is owned by the signed-in recruiter. A subject may be
-- a candidate, job, meeting draft, or absent for a free-standing document.
-- Routes must validate subject IDs against the referenced source before save.

CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  subject_type text,
  subject_id text,
  body jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notes_subject_pair CHECK (
    (subject_type IS NULL AND subject_id IS NULL)
    OR (subject_type IS NOT NULL AND subject_type IN ('candidate', 'job', 'meeting')
      AND subject_id IS NOT NULL AND length(btrim(subject_id)) > 0)
  )
);

COMMENT ON TABLE public.notes IS
  'Owner-authored rich text notes; body is editor JSON and absent source facts remain absent.';
COMMENT ON COLUMN public.notes.subject_id IS
  'Stable application entity key. Candidate keys include source and ID; routes must verify ownership and existence.';

CREATE INDEX notes_owner_updated_idx ON public.notes (owner_id, updated_at DESC);
CREATE INDEX notes_owner_subject_idx ON public.notes (owner_id, subject_type, subject_id);

CREATE TABLE public.boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  subject_type text,
  subject_id text,
  scene jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scene) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boards_subject_pair CHECK (
    (subject_type IS NULL AND subject_id IS NULL)
    OR (subject_type IS NOT NULL AND subject_type IN ('candidate', 'job', 'meeting')
      AND subject_id IS NOT NULL AND length(btrim(subject_id)) > 0)
  )
);

COMMENT ON TABLE public.boards IS 'Owner-authored Excalidraw scenes stored as JSON.';
COMMENT ON COLUMN public.boards.subject_id IS
  'Stable application entity key. Candidate keys include source and ID; routes must verify ownership and existence.';

CREATE INDEX boards_owner_updated_idx ON public.boards (owner_id, updated_at DESC);
CREATE INDEX boards_owner_subject_idx ON public.boards (owner_id, subject_type, subject_id);

CREATE FUNCTION public.touch_workbench_content_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = GREATEST(clock_timestamp(), OLD.updated_at + interval '1 millisecond');
  RETURN NEW;
END;
$$;

CREATE TRIGGER notes_touch_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_workbench_content_updated_at();

CREATE TRIGGER boards_touch_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.touch_workbench_content_updated_at();

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notes, public.boards FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notes, public.boards TO authenticated;

CREATE POLICY notes_select_own ON public.notes FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY notes_insert_own ON public.notes FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY notes_update_own ON public.notes FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY notes_delete_own ON public.notes FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY boards_select_own ON public.boards FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY boards_insert_own ON public.boards FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY boards_update_own ON public.boards FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY boards_delete_own ON public.boards FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
