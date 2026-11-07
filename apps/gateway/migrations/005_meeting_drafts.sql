CREATE TABLE meeting_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  job_id bigint NOT NULL,
  candidate_source text NOT NULL CHECK (candidate_source IN ('sourcing', 'submission')),
  candidate_source_id bigint NOT NULL,
  event_title text,
  template_id text CHECK (template_id IN ('candidate_screen', 'client_intake', 'reference_check')),
  transcript text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meeting_drafts_owner_created_idx ON meeting_drafts (owner_id, created_at DESC);

ALTER TABLE meeting_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE meeting_drafts FROM anon;

CREATE POLICY meeting_drafts_select_own ON meeting_drafts
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id AND public.is_authorized_recruiter());

CREATE POLICY meeting_drafts_insert_own ON meeting_drafts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id AND public.is_authorized_recruiter());

CREATE POLICY meeting_drafts_update_own ON meeting_drafts
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id AND public.is_authorized_recruiter())
  WITH CHECK (auth.uid() = owner_id AND public.is_authorized_recruiter());

CREATE POLICY meeting_drafts_delete_own ON meeting_drafts
  FOR DELETE TO authenticated
  USING (auth.uid() = owner_id AND public.is_authorized_recruiter());

