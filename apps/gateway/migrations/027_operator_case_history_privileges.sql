REVOKE DELETE ON TABLE public.operator_cases, public.case_artifacts, public.case_actions
  FROM PUBLIC, anon, authenticated;

ALTER TABLE public.case_artifacts DROP CONSTRAINT IF EXISTS case_artifacts_generated_by_check;
ALTER TABLE public.case_artifacts ADD CONSTRAINT case_artifacts_generated_by_check
  CHECK (generated_by IN ('local_draft_preparer','recruitment_mcp','human','after_call_service'));
