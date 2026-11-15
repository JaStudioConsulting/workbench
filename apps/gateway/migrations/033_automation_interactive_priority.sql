-- Keep interactive work ahead of the one-time import backlog.
ALTER TABLE public.automation_jobs ADD COLUMN priority_at timestamptz;

CREATE FUNCTION public.prioritize_workbench_automation(candidate_id text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prioritized_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized_recruiter() THEN RAISE EXCEPTION 'Authorized owner required'; END IF;
  UPDATE public.automation_jobs a SET priority_at=now(),updated_at=now()
    WHERE a.owner_id=auth.uid() AND a.state='queued' AND a.payload->'candidate'->>'id'=$1
      AND EXISTS(SELECT 1 FROM public.automation_current c WHERE c.owner_id=a.owner_id AND c.job_id=a.id);
  GET DIAGNOSTICS prioritized_count = ROW_COUNT;
  RETURN prioritized_count;
END $$;
REVOKE ALL ON FUNCTION public.prioritize_workbench_automation(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prioritize_workbench_automation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_workbench_automation()
RETURNS SETOF public.automation_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized_recruiter() THEN RAISE EXCEPTION 'Authorized owner required'; END IF;
  UPDATE public.automation_jobs SET state='failed',last_error='Worker interrupted after final attempt',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE owner_id=auth.uid() AND state='processing' AND lease_until<now() AND attempts>=4;
  RETURN QUERY WITH next_job AS (
    SELECT a.id FROM public.automation_jobs a
    WHERE a.owner_id=auth.uid() AND a.attempts<4
      AND ((a.state='queued' AND a.available_at<=now()) OR (a.state='processing' AND a.lease_until<now()))
    ORDER BY a.priority_at DESC NULLS LAST,
      (SELECT i.updated_at FROM public.automation_inputs i WHERE i.owner_id=a.owner_id AND i.candidate_id=a.payload->'candidate'->>'id') DESC NULLS LAST,
      (a.payload->'candidate'->>'edited_at')::timestamptz DESC NULLS LAST,
      (a.payload->'job'->>'status' IN ('active','Active','Open')) DESC NULLS LAST,
      a.created_at ASC,a.id
    FOR UPDATE OF a SKIP LOCKED LIMIT 1
  ) UPDATE public.automation_jobs a SET state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() FROM next_job WHERE a.id=next_job.id RETURNING a.*;
END $$;

NOTIFY pgrst,'reload schema';
