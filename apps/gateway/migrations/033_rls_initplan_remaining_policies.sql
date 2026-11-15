-- Step 2 of 2: evaluate the recruiter gate once per statement on the remaining
-- tables. Apply ONLY after 032 has been applied and its VERIFY section confirms
-- that candidate_review_feed and presentations no longer time out as
-- `authenticated`.
--
-- Same change as 032, applied to every other public policy that still calls
-- public.is_authorized_recruiter() bare: wrap it as
-- (select public.is_authorized_recruiter()) and any bare auth.uid() as
-- (select auth.uid()) so the planner hoists them into an InitPlan. Logic, roles,
-- commands and permissive mode are unchanged. ALTER POLICY is used so no table
-- is ever without a policy. The function is STABLE, takes no arguments and is
-- not SECURITY DEFINER, so hoisting is semantically identical within a statement.
--
-- Not changed: the function, the views, grants, indexes, statement_timeout.
-- Rollback and verification are at the bottom (commented out).
--
-- Drift note: policies on tracker_candidates, tracker_fits, review_drafts,
-- loxo_*, automation_* and workbench_documents are not created by any file in
-- this directory; they exist only in the hosted database. The expressions below
-- were read from pg_policies on 2026-11-15 (project abnfffkmxqixrwzackjf).

-- automation_*
ALTER POLICY "automation_current_owner" ON public.automation_current
  USING ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()));
ALTER POLICY "automation_inputs_owner" ON public.automation_inputs
  USING ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()))
  WITH CHECK ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()) AND (EXISTS (SELECT 1 FROM public.candidates_all WHERE (candidates_all.id = automation_inputs.candidate_id))));
ALTER POLICY "automation_jobs_owner" ON public.automation_jobs
  USING ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()));

-- boards
ALTER POLICY "boards_delete_own" ON public.boards
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "boards_insert_own" ON public.boards
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "boards_select_own" ON public.boards
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "boards_update_own" ON public.boards
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- candidate_edits
ALTER POLICY "candidate_edits_delete_own" ON public.candidate_edits
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "candidate_edits_insert_own" ON public.candidate_edits
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "candidate_edits_select_own" ON public.candidate_edits
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "candidate_edits_update_own" ON public.candidate_edits
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- candidates_manual
ALTER POLICY "candidates_manual_delete_own" ON public.candidates_manual
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "candidates_manual_insert_own" ON public.candidates_manual
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "candidates_manual_select_own" ON public.candidates_manual
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "candidates_manual_update_own" ON public.candidates_manual
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- case_actions
ALTER POLICY "case_actions_insert_own" ON public.case_actions
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "case_actions_select_own" ON public.case_actions
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "case_actions_update_own" ON public.case_actions
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- case_artifacts
ALTER POLICY "case_artifacts_insert_own" ON public.case_artifacts
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "case_artifacts_select_own" ON public.case_artifacts
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "case_artifacts_update_own" ON public.case_artifacts
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- case_sources
ALTER POLICY "case_sources_delete_own" ON public.case_sources
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "case_sources_insert_own" ON public.case_sources
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "case_sources_select_own" ON public.case_sources
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "case_sources_update_own" ON public.case_sources
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- leads
ALTER POLICY "Owners can create their leads" ON public.leads
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "Owners can delete their leads" ON public.leads
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "Owners can read their leads" ON public.leads
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "Owners can update their leads" ON public.leads
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- loxo_activities
ALTER POLICY "ja_delete" ON public.loxo_activities
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_insert" ON public.loxo_activities
  WITH CHECK ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.loxo_activities
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_update" ON public.loxo_activities
  USING ((select public.is_authorized_recruiter()))
  WITH CHECK ((select public.is_authorized_recruiter()));

-- loxo_activity_types, loxo_candidates, loxo_jobs, loxo_stages
ALTER POLICY "ja_read" ON public.loxo_activity_types
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.loxo_candidates
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.loxo_jobs
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.loxo_stages
  USING ((select public.is_authorized_recruiter()));

-- loxo_job_candidates
ALTER POLICY "ja_delete" ON public.loxo_job_candidates
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_insert" ON public.loxo_job_candidates
  WITH CHECK ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.loxo_job_candidates
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_update" ON public.loxo_job_candidates
  USING ((select public.is_authorized_recruiter()))
  WITH CHECK ((select public.is_authorized_recruiter()));

-- meeting_drafts (also wraps the bare auth.uid())
ALTER POLICY "meeting_drafts_delete_own" ON public.meeting_drafts
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "meeting_drafts_insert_own" ON public.meeting_drafts
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "meeting_drafts_select_own" ON public.meeting_drafts
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "meeting_drafts_update_own" ON public.meeting_drafts
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- notes
ALTER POLICY "notes_delete_own" ON public.notes
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "notes_insert_own" ON public.notes
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "notes_select_own" ON public.notes
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "notes_update_own" ON public.notes
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- operator_cases
ALTER POLICY "operator_cases_insert_own" ON public.operator_cases
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "operator_cases_select_own" ON public.operator_cases
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "operator_cases_update_own" ON public.operator_cases
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- outreach_log
ALTER POLICY "Owners can add to their outreach log" ON public.outreach_log
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "Owners can read their outreach log" ON public.outreach_log
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- review_drafts
ALTER POLICY "ja_delete" ON public.review_drafts
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_insert" ON public.review_drafts
  WITH CHECK ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.review_drafts
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_update" ON public.review_drafts
  USING ((select public.is_authorized_recruiter()))
  WITH CHECK ((select public.is_authorized_recruiter()));

-- tracker_candidates, tracker_fits
ALTER POLICY "ja_read" ON public.tracker_candidates
  USING ((select public.is_authorized_recruiter()));
ALTER POLICY "ja_read" ON public.tracker_fits
  USING ((select public.is_authorized_recruiter()));

-- tracker import tables
ALTER POLICY "tracker_import_preview_rows_owner_select" ON public.tracker_import_preview_rows
  USING ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()));
ALTER POLICY "tracker_import_rows_owner_select" ON public.tracker_import_source_rows
  USING ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()));
ALTER POLICY "tracker_imports_owner_insert" ON public.tracker_imports
  WITH CHECK ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()) AND (status = 'preview'::text));
ALTER POLICY "tracker_imports_owner_select" ON public.tracker_imports
  USING ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()));

-- workbench_documents
ALTER POLICY "workbench_documents_owner" ON public.workbench_documents
  USING ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()))
  WITH CHECK ((owner_id = (select auth.uid())) AND (select public.is_authorized_recruiter()) AND ((candidate_id IS NULL) OR (EXISTS (SELECT 1 FROM public.candidates_all c WHERE (c.id = workbench_documents.candidate_id)))));

-- workbench_profile
ALTER POLICY "Owners can create their Workbench profile" ON public.workbench_profile
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "Owners can read their Workbench profile" ON public.workbench_profile
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));
ALTER POLICY "Owners can update their Workbench profile" ON public.workbench_profile
  USING (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()))
  WITH CHECK (((select auth.uid()) = owner_id) AND (select public.is_authorized_recruiter()));

-- ===========================================================================
-- ROLLBACK (commented out). Restores the pre-033 expressions exactly as stored in
-- pg_policies on 2026-11-15 (function call qualified with public. only).
-- ===========================================================================
-- ALTER POLICY "automation_current_owner" ON public.automation_current
--   USING ((owner_id = auth.uid()) AND public.is_authorized_recruiter());
-- ALTER POLICY "automation_inputs_owner" ON public.automation_inputs
--   USING ((owner_id = auth.uid()) AND public.is_authorized_recruiter())
--   WITH CHECK ((owner_id = auth.uid()) AND public.is_authorized_recruiter() AND (EXISTS (SELECT 1 FROM public.candidates_all WHERE (candidates_all.id = automation_inputs.candidate_id))));
-- ALTER POLICY "automation_jobs_owner" ON public.automation_jobs
--   USING ((owner_id = auth.uid()) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "boards_delete_own" ON public.boards
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "boards_insert_own" ON public.boards
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "boards_select_own" ON public.boards
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "boards_update_own" ON public.boards
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "candidate_edits_delete_own" ON public.candidate_edits
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "candidate_edits_insert_own" ON public.candidate_edits
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "candidate_edits_select_own" ON public.candidate_edits
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "candidate_edits_update_own" ON public.candidate_edits
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "candidates_manual_delete_own" ON public.candidates_manual
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "candidates_manual_insert_own" ON public.candidates_manual
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "candidates_manual_select_own" ON public.candidates_manual
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "candidates_manual_update_own" ON public.candidates_manual
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "case_actions_insert_own" ON public.case_actions
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "case_actions_select_own" ON public.case_actions
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "case_actions_update_own" ON public.case_actions
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "case_artifacts_insert_own" ON public.case_artifacts
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "case_artifacts_select_own" ON public.case_artifacts
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "case_artifacts_update_own" ON public.case_artifacts
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "case_sources_delete_own" ON public.case_sources
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "case_sources_insert_own" ON public.case_sources
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "case_sources_select_own" ON public.case_sources
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "case_sources_update_own" ON public.case_sources
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "Owners can create their leads" ON public.leads
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "Owners can delete their leads" ON public.leads
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "Owners can read their leads" ON public.leads
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "Owners can update their leads" ON public.leads
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "ja_delete" ON public.loxo_activities USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_insert" ON public.loxo_activities WITH CHECK (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.loxo_activities USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_update" ON public.loxo_activities
--   USING (public.is_authorized_recruiter()) WITH CHECK (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.loxo_activity_types USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.loxo_candidates USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.loxo_jobs USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.loxo_stages USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_delete" ON public.loxo_job_candidates USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_insert" ON public.loxo_job_candidates WITH CHECK (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.loxo_job_candidates USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_update" ON public.loxo_job_candidates
--   USING (public.is_authorized_recruiter()) WITH CHECK (public.is_authorized_recruiter());
--
-- ALTER POLICY "meeting_drafts_delete_own" ON public.meeting_drafts
--   USING ((auth.uid() = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "meeting_drafts_insert_own" ON public.meeting_drafts
--   WITH CHECK ((auth.uid() = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "meeting_drafts_select_own" ON public.meeting_drafts
--   USING ((auth.uid() = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "meeting_drafts_update_own" ON public.meeting_drafts
--   USING ((auth.uid() = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((auth.uid() = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "notes_delete_own" ON public.notes
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "notes_insert_own" ON public.notes
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "notes_select_own" ON public.notes
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "notes_update_own" ON public.notes
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "operator_cases_insert_own" ON public.operator_cases
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "operator_cases_select_own" ON public.operator_cases
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "operator_cases_update_own" ON public.operator_cases
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "Owners can add to their outreach log" ON public.outreach_log
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "Owners can read their outreach log" ON public.outreach_log
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "ja_delete" ON public.review_drafts USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_insert" ON public.review_drafts WITH CHECK (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.review_drafts USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_update" ON public.review_drafts
--   USING (public.is_authorized_recruiter()) WITH CHECK (public.is_authorized_recruiter());
--
-- ALTER POLICY "ja_read" ON public.tracker_candidates USING (public.is_authorized_recruiter());
-- ALTER POLICY "ja_read" ON public.tracker_fits USING (public.is_authorized_recruiter());
--
-- ALTER POLICY "tracker_import_preview_rows_owner_select" ON public.tracker_import_preview_rows
--   USING ((owner_id = ( SELECT auth.uid() AS uid)) AND public.is_authorized_recruiter());
-- ALTER POLICY "tracker_import_rows_owner_select" ON public.tracker_import_source_rows
--   USING ((owner_id = ( SELECT auth.uid() AS uid)) AND public.is_authorized_recruiter());
-- ALTER POLICY "tracker_imports_owner_insert" ON public.tracker_imports
--   WITH CHECK ((owner_id = ( SELECT auth.uid() AS uid)) AND public.is_authorized_recruiter() AND (status = 'preview'::text));
-- ALTER POLICY "tracker_imports_owner_select" ON public.tracker_imports
--   USING ((owner_id = ( SELECT auth.uid() AS uid)) AND public.is_authorized_recruiter());
--
-- ALTER POLICY "workbench_documents_owner" ON public.workbench_documents
--   USING ((owner_id = auth.uid()) AND public.is_authorized_recruiter())
--   WITH CHECK ((owner_id = auth.uid()) AND public.is_authorized_recruiter() AND ((candidate_id IS NULL) OR (EXISTS (SELECT 1 FROM public.candidates_all c WHERE (c.id = workbench_documents.candidate_id)))));
--
-- ALTER POLICY "Owners can create their Workbench profile" ON public.workbench_profile
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "Owners can read their Workbench profile" ON public.workbench_profile
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());
-- ALTER POLICY "Owners can update their Workbench profile" ON public.workbench_profile
--   USING ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter())
--   WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id) AND public.is_authorized_recruiter());

-- ===========================================================================
-- VERIFY (commented out). Read-only; run after applying.
-- ===========================================================================
-- 1. No bare recruiter-gate call should remain anywhere in public (expect 0 rows).
--    Do this check against the whole schema because 032 + 033 together cover it.
--    pg_policies deparses the hoisted form as
--    "( SELECT is_authorized_recruiter() AS is_authorized_recruiter)".
-- SELECT tablename, policyname
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%is_authorized_recruiter%'
--   AND regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
--         '\( SELECT (public\.)?is_authorized_recruiter\(\) AS [a-z_]+\)', '', 'g')
--       LIKE '%is_authorized_recruiter%';
--
-- 2. No bare auth.uid() should remain (expect 0 rows; the deparsed wrapped form
--    is "( SELECT auth.uid() AS uid)").
-- SELECT tablename, policyname
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
--         '( SELECT auth.uid() AS uid)', '') LIKE '%auth.uid()%';
--
-- 3. Re-run the two EXPLAIN checks from the 032 VERIFY section (the runner
--    supplies the JWT claim via a psql variable) to confirm nothing regressed.
