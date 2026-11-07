CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  company text NOT NULL,
  contact text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  next_date date,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_owner_updated_at_idx
  ON public.leads (owner_id, updated_at DESC);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.leads FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leads TO authenticated;

CREATE POLICY "Owners can read their leads"
  ON public.leads FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY "Owners can create their leads"
  ON public.leads FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY "Owners can update their leads"
  ON public.leads FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY "Owners can delete their leads"
  ON public.leads FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
