-- Step 1 of 2: evaluate the recruiter gate once per statement on the four tables
-- behind the failing views. 035 covers every other table and is applied only
-- after this step is verified to fix the plans (a deliberately narrow first
-- change to a live database, for a fix that is still unproven).
--
-- Problem: the RLS policies on public.tracker_jobs, public.tracker_sourcing,
-- public.tracker_submissions and public.candidate_review_actions call
-- public.is_authorized_recruiter() bare, so Postgres re-evaluates it (an
-- auth.jwt() lookup) for every row. Under the security_invoker views
-- candidate_review_feed and presentations, which join those four tables, that
-- makes the `authenticated` role roughly 100x slower and hits the 8s statement
-- timeout (HTTP 500).
--
-- Fix: wrap the call as (select public.is_authorized_recruiter()) so the planner
-- hoists it into an InitPlan. Logic, roles, commands and permissive mode are
-- unchanged. ALTER POLICY is used so no table is ever without a policy. The
-- function is STABLE, takes no arguments and is not SECURITY DEFINER, so
-- hoisting it is semantically identical within one statement.
--
-- Not changed: the function, the views, grants, indexes, statement_timeout.
-- Apply only at a gate approved by Ja. Rollback and verification are at the
-- bottom of this file (commented out).
--
-- Drift note: no file in this directory creates these policies; they exist only
-- in the hosted database. The expressions below were read from pg_policies on
-- 2026-11-15 (project abnfffkmxqixrwzackjf).

-- candidate_review_actions
ALTER POLICY "ja_delete" ON public.candidate_review_actions
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_insert" ON public.candidate_review_actions
  WITH CHECK ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.candidate_review_actions
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_update" ON public.candidate_review_actions
  USING ((select public.is_authorized_recruiter()))
  WITH CHECK ((select public.is_authorized_recruiter()));

-- tracker_jobs, tracker_sourcing, tracker_submissions
ALTER POLICY "ja_read" ON public.tracker_jobs
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.tracker_sourcing
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.tracker_submissions
  USING ((select public.is_authorized_recruiter()));

-- ===========================================================================
-- ROLLBACK (commented out). Restores the pre-034 expressions exactly as stored
-- in pg_policies on 2026-11-15 (function call qualified with public. only).
-- ===========================================================================
-- ALTER POLICY "ja_delete" ON public.candidate_review_actions USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_insert" ON public.candidate_review_actions WITH CHECK (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.candidate_review_actions USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_update" ON public.candidate_review_actions
--   USING (public.is_authorized_recruiter()) WITH CHECK (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.tracker_jobs USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.tracker_sourcing USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.tracker_submissions USING (public.is_authorized_recruiter());

-- ===========================================================================
-- VERIFY (commented out). Read-only; run after applying.
-- ===========================================================================
-- 1. The four tables show the hoisted expression. pg_policies deparses it as
--    "( SELECT is_authorized_recruiter() AS is_authorized_recruiter)". Command,
--    roles ({authenticated}) and USING / WITH CHECK placement must be unchanged:
--    candidate_review_actions: ja_delete (DELETE, using), ja_insert (INSERT,
--    with check), ja_read (SELECT, using), ja_update (UPDATE, using + with
--    check); tracker_jobs / tracker_sourcing / tracker_submissions: ja_read
--    (SELECT, using).
-- SELECT tablename, policyname, cmd, roles, permissive, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('tracker_jobs', 'tracker_sourcing', 'tracker_submissions', 'candidate_review_actions')
-- ORDER BY tablename, policyname;
--
-- 2. Plan checks as `authenticated`, each inside a transaction that is rolled
--    back. The runner supplies the JWT claim through a psql variable so no
--    email is stored in this file or printed; the email must be one the
--    function allowlists. Example invocation (claim taken from a real session
--    or secret store, never typed into the repo):
--      psql "$DATABASE_URL" -v claims='{"role":"authenticated","email":"<runner supplies>"}' -f verify.sql
--    Expect an InitPlan for is_authorized_recruiter and hash joins, and a
--    runtime well under the 8s statement timeout (compare with the pre-034
--    plan).
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claims', :'claims', true);
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT job_id FROM public.candidate_review_feed LIMIT 1000;
-- ROLLBACK;
--
-- BEGIN;
-- SET LOCAL ROLE authenticated;
-- SELECT set_config('request.jwt.claims', :'claims', true);
-- EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM public.presentations LIMIT 1000;
-- ROLLBACK;
