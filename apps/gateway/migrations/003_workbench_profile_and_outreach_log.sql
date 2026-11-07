CREATE TABLE public.workbench_profile (
  owner_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  business_name text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  signature text NOT NULL DEFAULT '',
  default_province text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workbench_profile ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.workbench_profile FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.workbench_profile TO authenticated;

CREATE POLICY "Owners can read their Workbench profile"
  ON public.workbench_profile FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY "Owners can create their Workbench profile"
  ON public.workbench_profile FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY "Owners can update their Workbench profile"
  ON public.workbench_profile FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE TABLE public.outreach_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  job_id text NOT NULL,
  person_id text NOT NULL,
  candidate_email text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  channel text NOT NULL CHECK (channel IN ('copy', 'mailto', 'gmail_draft')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outreach_log_owner_created_at_idx
  ON public.outreach_log (owner_id, created_at DESC);

ALTER TABLE public.outreach_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.outreach_log FROM anon;
GRANT SELECT, INSERT ON TABLE public.outreach_log TO authenticated;

CREATE POLICY "Owners can read their outreach log"
  ON public.outreach_log FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY "Owners can add to their outreach log"
  ON public.outreach_log FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
