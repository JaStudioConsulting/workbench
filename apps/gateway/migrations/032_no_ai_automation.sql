-- Additive no-AI release. Deliberately does not apply deferred migration 030.
ALTER TABLE public.meeting_drafts ADD COLUMN candidate_id text;
UPDATE public.meeting_drafts SET candidate_id = candidate_source || ':' || candidate_source_id::text;
ALTER TABLE public.meeting_drafts ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.meeting_drafts ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE public.meeting_drafts ALTER COLUMN candidate_source DROP NOT NULL;
ALTER TABLE public.meeting_drafts ALTER COLUMN candidate_source_id DROP NOT NULL;
ALTER TABLE public.meeting_drafts DROP CONSTRAINT IF EXISTS meeting_drafts_transcription_status_check;
ALTER TABLE public.meeting_drafts ADD CONSTRAINT meeting_drafts_transcription_status_check CHECK (transcription_status IN ('pending','ready','failed','disabled'));
CREATE FUNCTION public.validate_meeting_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.candidate_id IS NULL AND NEW.candidate_source IS NOT NULL AND NEW.candidate_source_id IS NOT NULL THEN
    NEW.candidate_id := NEW.candidate_source || ':' || NEW.candidate_source_id::text;
  END IF;
  IF NEW.candidate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.candidates_all WHERE id=NEW.candidate_id) THEN RAISE EXCEPTION 'Candidate no longer exists'; END IF;
  IF NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tracker_jobs WHERE job_id=NEW.job_id) THEN RAISE EXCEPTION 'Job no longer exists'; END IF;
  IF NEW.candidate_source IS NOT NULL OR NEW.candidate_source_id IS NOT NULL THEN
    IF NEW.candidate_source IS NULL OR NEW.candidate_source_id IS NULL OR NEW.candidate_id IS DISTINCT FROM NEW.candidate_source||':'||NEW.candidate_source_id::text THEN RAISE EXCEPTION 'Candidate identities do not match'; END IF;
  END IF;
  NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER meeting_drafts_validate_identity BEFORE INSERT OR UPDATE ON public.meeting_drafts FOR EACH ROW EXECUTE FUNCTION public.validate_meeting_identity();

ALTER TABLE public.operator_cases DROP CONSTRAINT operator_cases_case_type_check;
ALTER TABLE public.operator_cases ADD CONSTRAINT operator_cases_case_type_check CHECK(case_type IN ('after_call','mpc','daily','automation'));
ALTER TABLE public.case_artifacts DROP CONSTRAINT case_artifacts_generated_by_check;
ALTER TABLE public.case_artifacts ADD CONSTRAINT case_artifacts_generated_by_check CHECK(generated_by IN ('local_draft_preparer','recruitment_mcp','human','after_call_service','template_automation'));

CREATE TABLE public.automation_inputs (
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  fields jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(fields)='object'),
  resume jsonb CHECK(resume IS NULL OR jsonb_typeof(resume)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,candidate_id)
);
CREATE TABLE public.automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  record_key text NOT NULL,
  source_hash text NOT NULL,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','ready','needs_information','failed','outdated')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 4),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  case_id uuid REFERENCES public.operator_cases(id),
  result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id)
);
CREATE TABLE public.automation_current (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  record_key text NOT NULL,
  source_hash text NOT NULL,
  job_id uuid NOT NULL,
  generation uuid NOT NULL,
  PRIMARY KEY(owner_id,record_key),
  FOREIGN KEY(owner_id,job_id) REFERENCES public.automation_jobs(owner_id,id)
);
ALTER TABLE public.automation_current ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_current FROM PUBLIC,anon;
GRANT SELECT ON public.automation_current TO authenticated;
CREATE POLICY automation_current_owner ON public.automation_current FOR SELECT TO authenticated USING(owner_id=auth.uid() AND public.is_authorized_recruiter());
CREATE VIEW public.automation_job_status WITH (security_invoker=true) AS SELECT a.*,a.payload->'candidate'->>'candidate_name' AS candidate_name,a.payload->'job'->>'job_title' AS job_title FROM public.automation_jobs a JOIN public.automation_current c ON a.id=c.job_id AND a.owner_id=c.owner_id;
GRANT SELECT ON public.automation_job_status TO authenticated;
CREATE INDEX automation_jobs_queue ON public.automation_jobs(owner_id,state,available_at);
CREATE TABLE public.workbench_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id text,
  job_id bigint REFERENCES public.tracker_jobs(job_id),
  name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(candidate_id IS NOT NULL OR job_id IS NOT NULL)
);
ALTER TABLE public.automation_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workbench_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_inputs,public.automation_jobs,public.workbench_documents FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE ON public.automation_inputs TO authenticated;
GRANT SELECT ON public.automation_jobs TO authenticated;
GRANT SELECT,INSERT,DELETE ON public.workbench_documents TO authenticated;
CREATE POLICY automation_inputs_owner ON public.automation_inputs FOR ALL TO authenticated USING(owner_id=auth.uid() AND public.is_authorized_recruiter()) WITH CHECK(owner_id=auth.uid() AND public.is_authorized_recruiter() AND EXISTS(SELECT 1 FROM public.candidates_all WHERE id=candidate_id));
CREATE POLICY automation_jobs_owner ON public.automation_jobs FOR SELECT TO authenticated USING(owner_id=auth.uid() AND public.is_authorized_recruiter());
CREATE POLICY workbench_documents_owner ON public.workbench_documents FOR ALL TO authenticated USING(owner_id=auth.uid() AND public.is_authorized_recruiter()) WITH CHECK(owner_id=auth.uid() AND public.is_authorized_recruiter() AND (candidate_id IS NULL OR EXISTS(SELECT 1 FROM public.candidates_all c WHERE c.id=candidate_id)));

-- Keep legacy case approval semantics intact; automation cases require exact saved links.
ALTER FUNCTION public.operator_case_primary_sources_current(uuid,uuid) RENAME TO operator_case_primary_sources_current_legacy032;
CREATE FUNCTION public.operator_case_primary_sources_current(p_case_id uuid,p_owner_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.operator_cases; candidate_key text; job_key text;
BEGIN
  IF p_owner_id IS DISTINCT FROM auth.uid() OR NOT public.is_authorized_recruiter() THEN RETURN false; END IF;
  SELECT * INTO c FROM public.operator_cases WHERE id=p_case_id AND owner_id=p_owner_id;
  IF c.case_type IS DISTINCT FROM 'automation' THEN RETURN public.operator_case_primary_sources_current_legacy032(p_case_id,p_owner_id); END IF;
  SELECT source_id INTO candidate_key FROM public.case_sources WHERE case_id=c.id AND owner_id=p_owner_id AND source_type='candidate' AND evidence_status='confirmed' AND required;
  SELECT source_id INTO job_key FROM public.case_sources WHERE case_id=c.id AND owner_id=p_owner_id AND source_type='job' AND evidence_status='confirmed' AND required;
  RETURN candidate_key IS NOT NULL AND c.case_key='automation:'||candidate_key||':job:'||coalesce(job_key,'none')
    AND EXISTS(SELECT 1 FROM public.candidates_all WHERE id=candidate_key)
    AND (candidate_key NOT LIKE 'manual:%' OR EXISTS(SELECT 1 FROM public.candidates_manual WHERE 'manual:'||id::text=candidate_key AND owner_id=p_owner_id))
    AND EXISTS(SELECT 1 FROM public.automation_current ac JOIN public.automation_jobs aj ON aj.id=ac.job_id AND aj.owner_id=ac.owner_id WHERE ac.owner_id=p_owner_id AND ac.record_key=c.case_key AND aj.state IN ('ready','needs_information'))
    AND (job_key IS NULL OR (EXISTS(SELECT 1 FROM public.tracker_jobs WHERE job_id::text=job_key) AND (
      EXISTS(SELECT 1 FROM public.meeting_drafts m WHERE m.owner_id=p_owner_id AND m.candidate_id=candidate_key AND m.job_id::text=job_key)
      OR EXISTS(SELECT 1 FROM public.candidate_review_actions a WHERE a.candidate_source||':'||a.candidate_source_id::text=candidate_key AND a.job_id::text=job_key))));
END $$;
REVOKE ALL ON FUNCTION public.operator_case_primary_sources_current(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.operator_case_primary_sources_current(uuid,uuid) TO authenticated;

-- Reconcile source content, not only timestamps. Never consume generated artifacts as inputs.
CREATE FUNCTION public.reconcile_workbench_automation() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inserted_count integer; run_id uuid:=gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized_recruiter() THEN RAISE EXCEPTION 'Authorized owner required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));
  WITH candidates AS (
    SELECT * FROM public.candidates_all c WHERE c.candidate_source<>'manual' OR EXISTS(SELECT 1 FROM public.candidates_manual m WHERE 'manual:'||m.id::text=c.id AND m.owner_id=auth.uid())
  ), links AS (
    SELECT id AS candidate_id,NULL::bigint AS job_id FROM candidates
    UNION SELECT m.candidate_id,m.job_id FROM public.meeting_drafts m WHERE m.owner_id=auth.uid() AND m.candidate_id IS NOT NULL AND m.job_id IS NOT NULL
    UNION SELECT a.candidate_source||':'||a.candidate_source_id::text,a.job_id FROM public.candidate_review_actions a
  ), inputs AS (
    SELECT 'automation:'||c.id||':job:'||coalesce(l.job_id::text,'none') AS record_key,
      jsonb_build_object('templateVersion','no-ai-v1','candidate',to_jsonb(c),'job',to_jsonb(j),'fields',coalesce(i.fields,'{}'::jsonb),'resume',i.resume,
      'meetings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'notes',m.notes,'transcript',m.transcript,'recordingId',m.recording_id) ORDER BY m.created_at,m.id) FROM public.meeting_drafts m WHERE m.owner_id=auth.uid() AND m.candidate_id=c.id AND m.job_id IS NOT DISTINCT FROM l.job_id),'[]'::jsonb)) AS payload
    FROM candidates c JOIN links l ON l.candidate_id=c.id LEFT JOIN public.tracker_jobs j ON j.job_id=l.job_id
    LEFT JOIN public.automation_inputs i ON i.owner_id=auth.uid() AND i.candidate_id=c.id
    WHERE l.job_id IS NULL OR j.job_id IS NOT NULL
  ), hashed AS (SELECT *,md5(payload::text) AS hash FROM inputs), new_jobs AS (
    INSERT INTO public.automation_jobs(owner_id,record_key,source_hash,payload)
      SELECT auth.uid(),i.record_key,i.hash,i.payload FROM hashed i
      LEFT JOIN public.automation_current c ON c.owner_id=auth.uid() AND c.record_key=i.record_key
      WHERE c.source_hash IS DISTINCT FROM i.hash
      RETURNING id,record_key,source_hash
  ), current_rows AS (
    INSERT INTO public.automation_current(owner_id,record_key,source_hash,job_id,generation)
      SELECT auth.uid(),i.record_key,i.hash,coalesce(n.id,c.job_id),run_id FROM hashed i
      LEFT JOIN new_jobs n ON n.record_key=i.record_key
      LEFT JOIN public.automation_current c ON c.owner_id=auth.uid() AND c.record_key=i.record_key
      ON CONFLICT(owner_id,record_key) DO UPDATE SET source_hash=excluded.source_hash,job_id=excluded.job_id,generation=excluded.generation
    RETURNING 1
  ) SELECT count(*) INTO inserted_count FROM new_jobs;
  DELETE FROM public.automation_current WHERE owner_id=auth.uid() AND generation<>run_id;
  UPDATE public.automation_jobs a SET state='outdated',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE a.owner_id=auth.uid() AND a.state<>'outdated' AND NOT EXISTS(SELECT 1 FROM public.automation_current c WHERE c.owner_id=a.owner_id AND c.job_id=a.id);
  RETURN inserted_count;
END $$;

CREATE FUNCTION public.claim_workbench_automation() RETURNS SETOF public.automation_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized_recruiter() THEN RAISE EXCEPTION 'Authorized owner required'; END IF;
  UPDATE public.automation_jobs SET state='failed',last_error='Worker interrupted after final attempt',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE owner_id=auth.uid() AND state='processing' AND lease_until<now() AND attempts>=4;
  RETURN QUERY WITH next_job AS (
    SELECT id FROM public.automation_jobs WHERE owner_id=auth.uid() AND attempts<4 AND ((state='queued' AND available_at<=now()) OR (state='processing' AND lease_until<now()))
    ORDER BY (payload->'job'->>'status' IN ('active','Active','Open')) DESC NULLS LAST,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE public.automation_jobs a SET state='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() FROM next_job WHERE a.id=next_job.id RETURNING a.*;
END $$;

CREATE FUNCTION public.finish_workbench_automation(job_id uuid,token uuid,outputs jsonb,output_status jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task public.automation_jobs; target_case uuid; artifact jsonb; candidate_key text; linked_job text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized_recruiter() THEN RAISE EXCEPTION 'Authorized owner required'; END IF;
  PERFORM public.reconcile_workbench_automation();
  SELECT * INTO task FROM public.automation_jobs WHERE id=job_id AND owner_id=auth.uid() AND state='processing' AND lease_token=token AND lease_until>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.automation_jobs b WHERE b.owner_id=auth.uid() AND b.record_key=task.record_key AND b.created_at>task.created_at) THEN
    UPDATE public.automation_jobs SET state='outdated',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=task.id; RETURN NULL;
  END IF;
  candidate_key:=task.payload->'candidate'->>'id'; linked_job:=task.payload->'job'->>'job_id';
  IF NOT EXISTS(SELECT 1 FROM public.candidates_all WHERE id=candidate_key) THEN RAISE EXCEPTION 'Candidate no longer exists'; END IF;
  INSERT INTO public.operator_cases(owner_id,case_key,case_type,title,status) VALUES(auth.uid(),task.record_key,'automation',left(coalesce(task.payload->'candidate'->>'candidate_name','Candidate')||CASE WHEN linked_job IS NULL THEN '' ELSE ' — '||coalesce(task.payload->'job'->>'job_title','Job') END,300),'ready_for_review')
    ON CONFLICT(owner_id,case_key) DO UPDATE SET updated_at=now() RETURNING id INTO target_case;
  INSERT INTO public.case_sources(owner_id,case_id,source_type,source_system,source_id,label,evidence_status,required) VALUES(auth.uid(),target_case,'candidate','supabase_tracker',candidate_key,'Saved candidate record','confirmed',true) ON CONFLICT(owner_id,case_id,source_type,source_system,source_id) DO NOTHING;
  IF linked_job IS NOT NULL THEN
    INSERT INTO public.case_sources(owner_id,case_id,source_type,source_system,source_id,label,evidence_status,required) VALUES(auth.uid(),target_case,'job','supabase_tracker',linked_job,'Linked job','confirmed',true) ON CONFLICT(owner_id,case_id,source_type,source_system,source_id) DO NOTHING;
  END IF;
  IF jsonb_typeof(outputs)<>'array' OR jsonb_array_length(outputs)>4 THEN RAISE EXCEPTION 'Invalid template outputs'; END IF;
  FOR artifact IN SELECT value FROM jsonb_array_elements(outputs) LOOP
    IF artifact->>'type' NOT IN ('candidate_submission','presentation_email','loxo_update','branded_resume') THEN RAISE EXCEPTION 'Unsupported template output'; END IF;
    INSERT INTO public.case_artifacts(owner_id,case_id,artifact_type,source_ref,content,generated_by) VALUES(auth.uid(),target_case,artifact->>'type','automation:'||task.id::text,artifact->'content','template_automation') ON CONFLICT(owner_id,case_id,artifact_type,source_ref) DO NOTHING;
  END LOOP;
  -- Withdraw a previous resume when its structured source is removed or no longer matches.
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(outputs) item WHERE item->>'type'='branded_resume')
    AND EXISTS(SELECT 1 FROM public.case_artifacts WHERE case_id=target_case AND owner_id=auth.uid() AND artifact_type='branded_resume') THEN
    INSERT INTO public.case_artifacts(owner_id,case_id,artifact_type,source_ref,content,generated_by)
      VALUES(auth.uid(),target_case,'branded_resume','automation:'||task.id::text,
      jsonb_build_object('status','needs_information','text','Structured resume is unavailable or its name no longer matches this candidate. Previous versions remain in history.'),'template_automation');
  END IF;
  UPDATE public.automation_jobs SET state=CASE WHEN output_status->>'needsInformation'='true' THEN 'needs_information' ELSE 'ready' END,case_id=target_case,result=output_status,lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE id=task.id;
  RETURN target_case;
END $$;

CREATE FUNCTION public.fail_workbench_automation(job_id uuid,token uuid,message text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized_recruiter() THEN RAISE EXCEPTION 'Authorized owner required'; END IF;
  UPDATE public.automation_jobs SET state=CASE WHEN attempts<4 THEN 'queued' ELSE 'failed' END,available_at=now()+make_interval(secs=>60*greatest(1,attempts)),last_error=left(message,300),lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=job_id AND owner_id=auth.uid() AND state='processing' AND lease_token=token;
END $$;
CREATE FUNCTION public.retry_workbench_automation(job_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized_recruiter() THEN RAISE EXCEPTION 'Authorized owner required'; END IF;
  UPDATE public.automation_jobs SET state='queued',attempts=0,available_at=now(),last_error=NULL,updated_at=now() WHERE id=job_id AND owner_id=auth.uid() AND state='failed'; RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_workbench_automation(),public.claim_workbench_automation(),public.finish_workbench_automation(uuid,uuid,jsonb,jsonb),public.fail_workbench_automation(uuid,uuid,text),public.retry_workbench_automation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reconcile_workbench_automation(),public.claim_workbench_automation(),public.finish_workbench_automation(uuid,uuid,jsonb,jsonb),public.fail_workbench_automation(uuid,uuid,text),public.retry_workbench_automation(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.require_confirmed_sources_for_case_artifact_review()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_case_type text;
  v_case_key text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.review_state <> 'draft' THEN
    RAISE EXCEPTION 'Approved artifact insert is forbidden; artifacts must be created as drafts';
  END IF;
  IF NEW.review_state = 'approved' AND (TG_OP = 'INSERT' OR OLD.review_state IS DISTINCT FROM 'approved') THEN
    IF NEW.reviewed_at IS NULL THEN RAISE EXCEPTION 'Artifact review timestamp is required'; END IF;
    SELECT c.case_type, c.case_key INTO v_case_type, v_case_key FROM public.operator_cases c
      WHERE c.id = NEW.case_id AND c.owner_id = NEW.owner_id;
      IF NOT public.operator_case_primary_sources_current(NEW.case_id, NEW.owner_id) OR EXISTS (
      SELECT 1 FROM public.case_sources source
      WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
        AND source.required AND source.evidence_status <> 'confirmed'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.case_sources source
      WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
        AND source.source_type = 'candidate' AND source.required AND source.evidence_status = 'confirmed'
        AND EXISTS (SELECT 1 FROM public.candidates_all candidate WHERE candidate.id = source.source_id)
    ) THEN
      RAISE EXCEPTION 'Required source evidence is not confirmed';
    END IF;
    IF v_case_type = 'automation' AND NEW.content->>'status' IN ('needs_information','failed','outdated') THEN RAISE EXCEPTION 'This output needs current source information before approval'; END IF;
    IF v_case_type = 'after_call' AND (
      NOT EXISTS (
        SELECT 1 FROM public.case_sources source
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.source_type = 'job' AND source.required AND source.evidence_status = 'confirmed'
          AND source.source_id = split_part(v_case_key, ':', 4)
          AND EXISTS (SELECT 1 FROM public.tracker_jobs job WHERE job.job_id::text = source.source_id)
      ) OR NOT EXISTS (
        SELECT 1 FROM public.case_sources source
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.source_type = 'transcript' AND source.required AND source.evidence_status = 'confirmed'
          AND source.source_system = 'meeting_drafts'
          AND EXISTS (
            SELECT 1 FROM public.meeting_drafts meeting
            WHERE meeting.id::text = source.source_id AND meeting.owner_id = NEW.owner_id
              AND length(btrim(meeting.transcript)) > 0
              AND meeting.job_id::text = split_part(v_case_key, ':', 4)
              AND meeting.candidate_source = split_part(v_case_key, ':', 2)
              AND meeting.candidate_source_id::text = split_part(v_case_key, ':', 3)
          )
      )
    ) THEN
      RAISE EXCEPTION 'Required after-call source evidence is not confirmed';
    ELSIF v_case_type = 'daily' AND (
      NOT EXISTS (
        SELECT 1 FROM public.case_sources source
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.source_type = 'job' AND source.required AND source.evidence_status = 'confirmed'
          AND EXISTS (SELECT 1 FROM public.tracker_jobs job WHERE job.job_id::text = source.source_id)
      ) OR NOT EXISTS (
        SELECT 1 FROM public.case_sources source
        JOIN public.candidate_review_actions action ON action.id::text = source.source_id
        WHERE source.case_id = NEW.case_id AND source.owner_id = NEW.owner_id
          AND source.source_type = 'draft' AND source.source_system = 'candidate_review_actions'
          AND source.required AND source.evidence_status = 'confirmed'
          AND action.status IN ('waiting_for_loxo','user_reported')
          AND EXISTS (
            SELECT 1 FROM public.case_sources candidate_source
            WHERE candidate_source.case_id = source.case_id AND candidate_source.owner_id = source.owner_id
              AND candidate_source.source_type = 'candidate' AND candidate_source.required
              AND candidate_source.evidence_status = 'confirmed'
              AND candidate_source.source_id = action.candidate_source || ':' || action.candidate_source_id::text
              AND EXISTS (SELECT 1 FROM public.candidates_all candidate WHERE candidate.id = candidate_source.source_id)
          )
          AND EXISTS (
            SELECT 1 FROM public.case_sources job_source
            WHERE job_source.case_id = source.case_id AND job_source.owner_id = source.owner_id
              AND job_source.source_type = 'job' AND job_source.required
              AND job_source.evidence_status = 'confirmed'
              AND job_source.source_id = action.job_id::text
          )
      )
    ) THEN
      RAISE EXCEPTION 'Required daily review-action evidence is not confirmed';
    ELSIF v_case_type NOT IN ('after_call','mpc','daily','automation') THEN
      RAISE EXCEPTION 'Unsupported operator case type';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
NOTIFY pgrst,'reload schema';
