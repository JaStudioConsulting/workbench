-- Import audit and stable source ownership. Canonical Tracker IDs and existing
-- tracker_row values remain untouched; writes occur only through the RPC below.
CREATE TABLE public.tracker_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('candidates','jobs','sourcing','submissions','fits')),
  source_key text NOT NULL CHECK (length(btrim(source_key)) BETWEEN 1 AND 500),
  source_label text NOT NULL DEFAULT '' CHECK (length(source_label) <= 300),
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','partial','confirmed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (id, owner_id)
);

CREATE TABLE public.tracker_import_source_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL,
  source_row_key text NOT NULL CHECK (length(btrim(source_row_key)) BETWEEN 1 AND 1000),
  source_row integer NOT NULL CHECK (source_row > 0),
  source_fingerprint text NOT NULL CHECK (length(source_fingerprint) BETWEEN 1 AND 128),
  source_type text NOT NULL CHECK (source_type IN ('candidates','jobs','sourcing','submissions','fits')),
  canonical_id bigint NOT NULL,
  canonical_fingerprint text NOT NULL CHECK (length(canonical_fingerprint) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracker_import_source_rows_import_owner_fk FOREIGN KEY (import_id, owner_id)
    REFERENCES public.tracker_imports(id, owner_id) ON DELETE CASCADE,
  UNIQUE (owner_id, source_type, source_row_key)
);

CREATE TABLE public.tracker_import_preview_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('candidates','jobs','sourcing','submissions','fits')),
  source_row_key text NOT NULL CHECK (length(btrim(source_row_key)) BETWEEN 1 AND 1000),
  source_row integer NOT NULL CHECK (source_row > 0),
  source_fingerprint text NOT NULL CHECK (length(source_fingerprint) = 32),
  values jsonb NOT NULL CHECK (jsonb_typeof(values) = 'object'),
  problems jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(problems) = 'array'),
  blocked boolean NOT NULL DEFAULT false,
  identity_basis text NOT NULL CHECK (identity_basis IN ('explicit_field','row_position_requires_reconciliation')),
  CONSTRAINT tracker_import_preview_rows_owner_fk FOREIGN KEY (import_id, owner_id)
    REFERENCES public.tracker_imports(id, owner_id) ON DELETE CASCADE,
  UNIQUE (import_id, source_row_key)
);

CREATE INDEX tracker_imports_owner_created_idx ON public.tracker_imports(owner_id, created_at DESC);
CREATE INDEX tracker_import_source_rows_import_idx ON public.tracker_import_source_rows(import_id, source_type);
CREATE INDEX tracker_import_preview_rows_import_idx ON public.tracker_import_preview_rows(import_id, source_row);

ALTER TABLE public.tracker_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_import_source_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_import_preview_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tracker_imports, public.tracker_import_source_rows FROM anon;
GRANT SELECT, INSERT ON public.tracker_imports TO authenticated;
GRANT SELECT ON public.tracker_import_source_rows, public.tracker_import_preview_rows TO authenticated;

CREATE POLICY tracker_imports_owner_select ON public.tracker_imports FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND public.is_authorized_recruiter());
CREATE POLICY tracker_imports_owner_insert ON public.tracker_imports FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND public.is_authorized_recruiter() AND status = 'preview');
CREATE POLICY tracker_import_rows_owner_select ON public.tracker_import_source_rows FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND public.is_authorized_recruiter());
CREATE POLICY tracker_import_preview_rows_owner_select ON public.tracker_import_preview_rows FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND public.is_authorized_recruiter());

CREATE FUNCTION public.save_tracker_import_preview(p_import_id uuid, p_rows jsonb, p_identity_field text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_import public.tracker_imports%ROWTYPE;
  v_row jsonb;
  v_count integer := 0;
  v_identity_basis text;
  v_blocked boolean;
  v_suffix text;
BEGIN
  IF v_owner IS NULL OR NOT public.is_authorized_recruiter() THEN RAISE EXCEPTION 'authorized recruiter required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) < 1 OR jsonb_array_length(p_rows) > 10000 THEN RAISE EXCEPTION 'preview row count is invalid' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_import FROM public.tracker_imports WHERE id=p_import_id AND owner_id=v_owner FOR UPDATE;
  IF NOT FOUND OR v_import.status <> 'preview' THEN RAISE EXCEPTION 'import is unavailable' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.tracker_import_preview_rows WHERE import_id=p_import_id AND owner_id=v_owner) THEN RAISE EXCEPTION 'preview is immutable once saved' USING ERRCODE = '23514'; END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_count := v_count + 1;
    IF v_row->>'sourceType' IS DISTINCT FROM v_import.source_type OR coalesce(v_row->>'sourceRowKey','')='' OR coalesce(v_row->>'fingerprint','') !~ '^[0-9a-f]{32}$' OR jsonb_typeof(v_row->'values') <> 'object' OR jsonb_typeof(v_row->'problems') <> 'array' THEN
      RAISE EXCEPTION 'malformed preview row' USING ERRCODE = '22023';
    END IF;
    IF left(v_row->>'sourceRowKey', length(v_import.source_key) + 1) <> (v_import.source_key || ':') THEN
      RAISE EXCEPTION 'source row does not belong to this import source' USING ERRCODE = '22023';
    END IF;
    v_identity_basis := 'row_position_requires_reconciliation';
    IF p_identity_field IS NOT NULL THEN
      IF NOT (CASE v_import.source_type
        WHEN 'candidates' THEN p_identity_field IN ('email','phone')
        WHEN 'jobs' THEN p_identity_field = 'job_id'
        WHEN 'sourcing' THEN p_identity_field IN ('candidate_key','profile_url','business_email')
        WHEN 'submissions' THEN p_identity_field IN ('candidate_key','gmail_message_id')
        WHEN 'fits' THEN false
        ELSE false END)
        OR NOT (v_row->'values' ? p_identity_field)
        OR coalesce(v_row->'values'->>p_identity_field,'') = '' THEN
        RAISE EXCEPTION 'identity field is unsupported or empty' USING ERRCODE = '22023';
      END IF;
      v_suffix := ':' || p_identity_field || ':' || (v_row->'values'->>p_identity_field);
      IF right(v_row->>'sourceRowKey',length(v_suffix)) <> v_suffix THEN RAISE EXCEPTION 'source identity does not match preview values' USING ERRCODE = '22023'; END IF;
      v_identity_basis := 'explicit_field';
    ELSE
      v_suffix := ':row:' || (v_row->>'sourceRow');
      IF right(v_row->>'sourceRowKey',length(v_suffix)) <> v_suffix THEN RAISE EXCEPTION 'row identity does not match preview row' USING ERRCODE = '22023'; END IF;
    END IF;
    v_blocked := coalesce((v_row->>'blocked')::boolean,true) OR jsonb_array_length(v_row->'problems') > 0 OR v_identity_basis = 'row_position_requires_reconciliation';
    INSERT INTO public.tracker_import_preview_rows(owner_id,import_id,source_type,source_row_key,source_row,source_fingerprint,values,problems,blocked,identity_basis)
    VALUES(v_owner,p_import_id,v_import.source_type,v_row->>'sourceRowKey',(v_row->>'sourceRow')::integer,v_row->>'fingerprint',v_row->'values',v_row->'problems',v_blocked,v_identity_basis);
  END LOOP;
  RETURN jsonb_build_object('importId',p_import_id,'rowCount',v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.save_tracker_import_preview(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_tracker_import_preview(uuid,jsonb,text) TO authenticated;

CREATE FUNCTION public.confirm_tracker_import(p_import_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_import public.tracker_imports%ROWTYPE;
  v_row jsonb;
  v_type text;
  v_table text;
  v_key text;
  v_fingerprint text;
  v_action text;
  v_id bigint;
  v_canonical_fingerprint text;
  v_rownum integer;
  v_result jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_choice_count integer := 0;
  v_expected_count integer := 0;
  v_record record;
BEGIN
  IF v_owner IS NULL OR NOT public.is_authorized_recruiter() THEN
    RAISE EXCEPTION 'authorized recruiter required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) < 1 OR jsonb_array_length(p_rows) > 10000 THEN
    RAISE EXCEPTION 'import row count is invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_import FROM public.tracker_imports WHERE id = p_import_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND OR v_import.status NOT IN ('preview','partial','confirmed') THEN
    RAISE EXCEPTION 'import is unavailable' USING ERRCODE = '42501';
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(p_rows)) > (SELECT count(*) FROM public.tracker_import_preview_rows WHERE import_id=p_import_id AND owner_id=v_owner) THEN
    RAISE EXCEPTION 'confirm choices exceed saved preview' USING ERRCODE = '22023';
  END IF;
  v_choice_count := jsonb_array_length(p_rows);
  IF (SELECT count(DISTINCT value->>'sourceRowKey') FROM jsonb_array_elements(p_rows)) <> v_choice_count THEN RAISE EXCEPTION 'duplicate confirm choice' USING ERRCODE = '22023'; END IF;
  FOR v_row IN
    SELECT jsonb_build_object(
      'sourceType', preview.source_type, 'sourceRowKey', preview.source_row_key,
      'sourceRow', preview.source_row, 'fingerprint', preview.source_fingerprint,
      'values', preview.values, 'problems', preview.problems, 'blocked', preview.blocked,
      'identityBasis', preview.identity_basis, 'action', choice.value->>'action',
      'canonicalId', choice.value->'canonicalId', 'reviewedIdentity', choice.value->'reviewedIdentity'
    )
    FROM jsonb_array_elements(p_rows) choice(value)
    JOIN public.tracker_import_preview_rows preview
      ON preview.import_id=p_import_id AND preview.owner_id=v_owner
      AND preview.source_row_key=choice.value->>'sourceRowKey'
    ORDER BY preview.source_row
  LOOP
    v_count := v_count + 1;
    v_type := v_row->>'sourceType';
    IF v_type IS DISTINCT FROM v_import.source_type THEN RAISE EXCEPTION 'source type mismatch' USING ERRCODE = '22023'; END IF;
    v_key := v_row->>'sourceRowKey';
    v_fingerprint := v_row->>'fingerprint';
    v_action := v_row->>'action';
    IF coalesce(v_key,'') = '' OR coalesce(v_fingerprint,'') = '' OR jsonb_typeof(v_row->'values') <> 'object' THEN
      RAISE EXCEPTION 'malformed import row' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(v_row->'problems') > 0 OR (coalesce((v_row->>'blocked')::boolean,true) AND NOT (v_row->>'identityBasis'='row_position_requires_reconciliation' AND coalesce((v_row->>'reviewedIdentity')::boolean,false))) THEN
      RAISE EXCEPTION 'preview row has unresolved problems' USING ERRCODE = '23514';
    END IF;
    IF v_row->>'identityBasis'='row_position_requires_reconciliation' AND NOT coalesce((v_row->>'reviewedIdentity')::boolean,false) THEN
      RAISE EXCEPTION 'row-position identity requires exact manual reconciliation' USING ERRCODE = '23514';
    END IF;
    IF v_action='update' AND v_row->>'identityBasis' <> 'explicit_field' AND NOT coalesce((v_row->>'reviewedIdentity')::boolean,false) THEN
      RAISE EXCEPTION 'row-position identity requires exact manual reconciliation' USING ERRCODE = '23514';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_type || '|' || v_key, 0));
    SELECT canonical_id INTO v_id FROM public.tracker_import_source_rows
      WHERE owner_id = v_owner AND source_type = v_type AND source_row_key = v_key FOR UPDATE;
    IF FOUND THEN
      IF v_row->>'fingerprint' = (SELECT source_fingerprint FROM public.tracker_import_source_rows WHERE owner_id=v_owner AND source_type=v_type AND source_row_key=v_key) THEN
        v_result := v_result || jsonb_build_array(jsonb_build_object('sourceRowKey',v_key,'canonicalId',v_id,'action','unchanged'));
        CONTINUE;
      END IF;
      IF v_action <> 'update' OR (v_row->>'canonicalId')::bigint IS DISTINCT FROM v_id THEN
        RAISE EXCEPTION 'existing source row requires exact mapped update' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM public.tracker_import_source_rows WHERE source_type=v_type AND source_row_key=v_key) THEN
        RAISE EXCEPTION 'source row belongs to another recruiter' USING ERRCODE = '42501';
      END IF;
      IF v_action <> 'insert' OR nullif(v_row->>'canonicalId','') IS NOT NULL THEN
        RAISE EXCEPTION 'unmapped canonical rows cannot be claimed' USING ERRCODE = '23514';
      END IF;
    END IF;

    IF v_type = 'candidates' THEN
      v_table := 'tracker_candidates';
      IF NOT v_row->'values' ? 'candidate_name' OR coalesce(v_row->'values'->>'candidate_name','') = '' THEN RAISE EXCEPTION 'candidate name required' USING ERRCODE = '23514'; END IF;
      IF v_action = 'insert' THEN
        LOCK TABLE public.tracker_candidates IN SHARE ROW EXCLUSIVE MODE;
        SELECT coalesce(max(tracker_row),0)+1 INTO v_rownum FROM public.tracker_candidates;
        INSERT INTO public.tracker_candidates (tracker_row,candidate_name,current_title,location,industry,shift,email,phone,compensation_target,current_compensation,current_company,submitted_on,submitted_to,notes,raw)
        SELECT v_rownum,r.candidate_name,r.current_title,r.location,r.industry,r.shift,r.email,r.phone,r.compensation_target,r.current_compensation,r.current_company,r.submitted_on,r.submitted_to,r.notes,coalesce(r.raw,'{}'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_candidates,v_row->'values') r RETURNING id INTO v_id;
      ELSE
        UPDATE public.tracker_candidates t SET candidate_name=r.candidate_name,current_title=r.current_title,location=r.location,industry=r.industry,shift=r.shift,email=r.email,phone=r.phone,compensation_target=r.compensation_target,current_compensation=r.current_compensation,current_company=r.current_company,submitted_on=r.submitted_on,submitted_to=r.submitted_to,notes=r.notes,raw=coalesce(r.raw,'{}'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_candidates,v_row->'values') r WHERE t.id=v_id AND md5((to_jsonb(t)-'imported_at')::text)=(SELECT canonical_fingerprint FROM public.tracker_import_source_rows WHERE owner_id=v_owner AND source_type=v_type AND source_row_key=v_key);
        IF NOT FOUND THEN RAISE EXCEPTION 'mapped candidate changed since preview or is missing' USING ERRCODE = '40001'; END IF;
      END IF;
    ELSIF v_type = 'jobs' THEN
      v_table := 'tracker_jobs';
      IF coalesce(v_row->'values'->>'job_title','')='' OR coalesce(v_row->'values'->>'job_id','') !~ '^\d+$' THEN RAISE EXCEPTION 'job title and exact stable job_id required' USING ERRCODE = '23514'; END IF;
      IF v_action = 'insert' THEN
        LOCK TABLE public.tracker_jobs IN SHARE ROW EXCLUSIVE MODE;
        SELECT coalesce(max(tracker_row),0)+1 INTO v_rownum FROM public.tracker_jobs;
        INSERT INTO public.tracker_jobs (job_id,tracker_row,job_title,company,client_contact,location,compensation,date_opened,owners,status,job_description,loxo_link,raw)
        SELECT r.job_id,v_rownum,r.job_title,r.company,r.client_contact,r.location,r.compensation,r.date_opened,r.owners,r.status,r.job_description,r.loxo_link,coalesce(r.raw,'{}'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_jobs,v_row->'values') r RETURNING job_id INTO v_id;
      ELSE
        UPDATE public.tracker_jobs t SET job_title=r.job_title,company=r.company,client_contact=r.client_contact,location=r.location,compensation=r.compensation,date_opened=r.date_opened,owners=r.owners,status=r.status,job_description=r.job_description,loxo_link=r.loxo_link,raw=coalesce(r.raw,'{}'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_jobs,v_row->'values') r WHERE t.job_id=v_id AND md5((to_jsonb(t)-'imported_at')::text)=(SELECT canonical_fingerprint FROM public.tracker_import_source_rows WHERE owner_id=v_owner AND source_type=v_type AND source_row_key=v_key);
        IF NOT FOUND THEN RAISE EXCEPTION 'mapped job changed since preview or is missing' USING ERRCODE = '40001'; END IF;
      END IF;
    ELSIF v_type = 'sourcing' THEN
      v_table := 'tracker_sourcing';
      IF v_action = 'insert' THEN
        LOCK TABLE public.tracker_sourcing IN SHARE ROW EXCLUSIVE MODE;
        SELECT coalesce(max(tracker_row),0)+1 INTO v_rownum FROM public.tracker_sourcing;
        INSERT INTO public.tracker_sourcing (tracker_row,role,candidate_name,current_company,current_title,profile_url,evidence_url,found_at,review_status,fit_evidence,gaps,candidate_key,business_email,personal_email,mobile_number,work_number,other_phone,source_tab_range,source_group,source_notes,next_check,email,phone,original_row_snapshot,raw)
        SELECT v_rownum,r.role,r.candidate_name,r.current_company,r.current_title,r.profile_url,r.evidence_url,r.found_at,r.review_status,r.fit_evidence,r.gaps,r.candidate_key,r.business_email,r.personal_email,r.mobile_number,r.work_number,r.other_phone,r.source_tab_range,r.source_group,r.source_notes,r.next_check,r.email,r.phone,coalesce(r.original_row_snapshot,'{}'::jsonb),coalesce(r.raw,'{}'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_sourcing,v_row->'values') r RETURNING id INTO v_id;
      ELSE
        UPDATE public.tracker_sourcing t SET role=r.role,candidate_name=r.candidate_name,current_company=r.current_company,current_title=r.current_title,profile_url=r.profile_url,evidence_url=r.evidence_url,found_at=r.found_at,review_status=r.review_status,fit_evidence=r.fit_evidence,gaps=r.gaps,candidate_key=r.candidate_key,business_email=r.business_email,personal_email=r.personal_email,mobile_number=r.mobile_number,work_number=r.work_number,other_phone=r.other_phone,source_tab_range=r.source_tab_range,source_group=r.source_group,source_notes=r.source_notes,next_check=r.next_check,email=r.email,phone=r.phone,original_row_snapshot=coalesce(r.original_row_snapshot,'{}'::jsonb),raw=coalesce(r.raw,'{}'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_sourcing,v_row->'values') r WHERE t.id=v_id AND md5((to_jsonb(t)-'imported_at')::text)=(SELECT canonical_fingerprint FROM public.tracker_import_source_rows WHERE owner_id=v_owner AND source_type=v_type AND source_row_key=v_key);
        IF NOT FOUND THEN RAISE EXCEPTION 'mapped sourcing row changed since preview or is missing' USING ERRCODE = '40001'; END IF;
      END IF;
    ELSIF v_type = 'submissions' THEN
      v_table := 'tracker_submissions';
      IF coalesce(v_row->'values'->>'candidate_name','')='' THEN RAISE EXCEPTION 'candidate name required' USING ERRCODE = '23514'; END IF;
      IF v_action = 'insert' THEN
        LOCK TABLE public.tracker_submissions IN SHARE ROW EXCLUSIVE MODE;
        SELECT coalesce(max(tracker_row),0)+1 INTO v_rownum FROM public.tracker_submissions;
        INSERT INTO public.tracker_submissions (tracker_row,submission_date,recruiter,candidate_name,current_title,current_company,licenses_certifications,location,industry,target_current_compensation,reason_for_leaving,profile_summary,additional_notes,submission_type,role_submitted_for,client_submitted_to,activity_status,submission_link,gmail_message_id,gmail_thread_id,candidate_key,source_verified_date,raw)
        SELECT v_rownum,r.submission_date,r.recruiter,r.candidate_name,r.current_title,r.current_company,r.licenses_certifications,r.location,r.industry,r.target_current_compensation,r.reason_for_leaving,r.profile_summary,r.additional_notes,r.submission_type,r.role_submitted_for,r.client_submitted_to,r.activity_status,r.submission_link,r.gmail_message_id,r.gmail_thread_id,r.candidate_key,r.source_verified_date,coalesce(r.raw,'{}'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_submissions,v_row->'values') r RETURNING id INTO v_id;
      ELSE
        UPDATE public.tracker_submissions t SET submission_date=r.submission_date,recruiter=r.recruiter,candidate_name=r.candidate_name,current_title=r.current_title,current_company=r.current_company,licenses_certifications=r.licenses_certifications,location=r.location,industry=r.industry,target_current_compensation=r.target_current_compensation,reason_for_leaving=r.reason_for_leaving,profile_summary=r.profile_summary,additional_notes=r.additional_notes,submission_type=r.submission_type,role_submitted_for=r.role_submitted_for,client_submitted_to=r.client_submitted_to,activity_status=r.activity_status,submission_link=r.submission_link,gmail_message_id=r.gmail_message_id,gmail_thread_id=r.gmail_thread_id,candidate_key=r.candidate_key,source_verified_date=r.source_verified_date,raw=coalesce(r.raw,'{}'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_submissions,v_row->'values') r WHERE t.id=v_id AND md5((to_jsonb(t)-'imported_at')::text)=(SELECT canonical_fingerprint FROM public.tracker_import_source_rows WHERE owner_id=v_owner AND source_type=v_type AND source_row_key=v_key);
        IF NOT FOUND THEN RAISE EXCEPTION 'mapped submission changed since preview or is missing' USING ERRCODE = '40001'; END IF;
      END IF;
    ELSE
      v_table := 'tracker_fits';
      IF coalesce(v_row->'values'->>'person_id','') !~ '^\d+$' OR coalesce(v_row->'values'->>'fit_label','')='' OR coalesce(v_row->'values'->>'tracker_sheet','')='' THEN RAISE EXCEPTION 'fit requires exact person ID and label' USING ERRCODE = '23514'; END IF;
      IF v_action = 'insert' THEN
        INSERT INTO public.tracker_fits (person_id,fit_job_id,fit_label,tracker_sheet,tracker_row,date_added,added_by,notes,matched_resume_lines)
        SELECT r.person_id,r.fit_job_id,r.fit_label,r.tracker_sheet,r.tracker_row,r.date_added,r.added_by,r.notes,coalesce(r.matched_resume_lines,'[]'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_fits,v_row->'values') r RETURNING id INTO v_id;
      ELSE
        UPDATE public.tracker_fits t SET person_id=r.person_id,fit_job_id=r.fit_job_id,fit_label=r.fit_label,tracker_sheet=r.tracker_sheet,tracker_row=r.tracker_row,date_added=r.date_added,added_by=r.added_by,notes=r.notes,matched_resume_lines=coalesce(r.matched_resume_lines,'[]'::jsonb)
        FROM jsonb_populate_record(NULL::public.tracker_fits,v_row->'values') r WHERE t.id=v_id AND md5((to_jsonb(t))::text)=(SELECT canonical_fingerprint FROM public.tracker_import_source_rows WHERE owner_id=v_owner AND source_type=v_type AND source_row_key=v_key);
        IF NOT FOUND THEN RAISE EXCEPTION 'mapped fit changed since preview or is missing' USING ERRCODE = '40001'; END IF;
      END IF;
    END IF;

    IF v_type='candidates' THEN SELECT md5((to_jsonb(t)-'imported_at')::text) INTO v_canonical_fingerprint FROM public.tracker_candidates t WHERE t.id=v_id;
    ELSIF v_type='jobs' THEN SELECT md5((to_jsonb(t)-'imported_at')::text) INTO v_canonical_fingerprint FROM public.tracker_jobs t WHERE t.job_id=v_id;
    ELSIF v_type='sourcing' THEN SELECT md5((to_jsonb(t)-'imported_at')::text) INTO v_canonical_fingerprint FROM public.tracker_sourcing t WHERE t.id=v_id;
    ELSIF v_type='submissions' THEN SELECT md5((to_jsonb(t)-'imported_at')::text) INTO v_canonical_fingerprint FROM public.tracker_submissions t WHERE t.id=v_id;
    ELSE SELECT md5(to_jsonb(t)::text) INTO v_canonical_fingerprint FROM public.tracker_fits t WHERE t.id=v_id;
    END IF;
    IF v_action = 'insert' THEN
      INSERT INTO public.tracker_import_source_rows(owner_id,import_id,source_row_key,source_row,source_fingerprint,source_type,canonical_id,canonical_fingerprint)
      VALUES(v_owner,p_import_id,v_key,(v_row->>'sourceRow')::integer,v_fingerprint,v_type,v_id,v_canonical_fingerprint);
    ELSE
      UPDATE public.tracker_import_source_rows SET source_fingerprint=v_fingerprint,canonical_fingerprint=v_canonical_fingerprint,source_row=(v_row->>'sourceRow')::integer,updated_at=clock_timestamp()
      WHERE owner_id=v_owner AND source_type=v_type AND source_row_key=v_key;
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object('sourceRowKey',v_key,'canonicalTable',v_table,'canonicalId',v_id,'action',v_action));
  END LOOP;
  IF v_count <> v_choice_count OR v_count = 0 THEN RAISE EXCEPTION 'confirm choices do not match saved preview' USING ERRCODE = '23514'; END IF;
  SELECT count(*) INTO v_expected_count FROM public.tracker_import_preview_rows preview
    WHERE preview.import_id=p_import_id AND preview.owner_id=v_owner AND jsonb_array_length(preview.problems)=0
      AND NOT EXISTS (SELECT 1 FROM public.tracker_import_source_rows mapping WHERE mapping.owner_id=v_owner
        AND mapping.source_type=preview.source_type AND mapping.source_row_key=preview.source_row_key
        AND mapping.source_fingerprint=preview.source_fingerprint);
  UPDATE public.tracker_imports SET status=CASE WHEN v_expected_count = 0 THEN 'confirmed' ELSE 'partial' END,
    confirmed_at=CASE WHEN v_expected_count = 0 THEN clock_timestamp() ELSE NULL END
    WHERE id=p_import_id AND owner_id=v_owner;
  RETURN jsonb_build_object('importId',p_import_id,'rows',v_result,'count',v_count,
    'importedCount',(SELECT count(*) FROM jsonb_array_elements(v_result) r WHERE r->>'action'='insert'),
    'updatedCount',(SELECT count(*) FROM jsonb_array_elements(v_result) r WHERE r->>'action'='update'),
    'unchangedCount',(SELECT count(*) FROM jsonb_array_elements(v_result) r WHERE r->>'action'='unchanged'),
    'skippedCount',(SELECT count(*) FROM public.tracker_import_preview_rows WHERE import_id=p_import_id AND owner_id=v_owner)-v_count,
    'failedCount',0,
    'status',CASE WHEN v_expected_count = 0 THEN 'confirmed' ELSE 'partial' END,'remainingEligible',v_expected_count);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_tracker_import(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_tracker_import(uuid,jsonb) TO authenticated;

COMMENT ON TABLE public.tracker_import_source_rows IS
  'Owner-scoped stable source-to-canonical mappings; names are never used as identity.';
COMMENT ON FUNCTION public.confirm_tracker_import(uuid,jsonb) IS
  'Narrow authorized import writer. It writes canonical Tracker tables only for confirmed rows and updates only rows already mapped to the caller-owned source key.';
