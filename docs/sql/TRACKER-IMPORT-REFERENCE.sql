-- REFERENCE ONLY. Snapshot of live Supabase public Tracker tables on 2026-11-08.
-- Do not apply this file to the live project. Existing tables, data and policies already exist.
-- See docs/SCHEMA.md for the full live inventory. Dependencies: public.loxo_jobs,
-- public.loxo_candidates and public.is_authorized_recruiter() already exist.

-- tracker_candidates
CREATE TABLE public."tracker_candidates" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "tracker_row" integer NOT NULL,
  "candidate_name" text NOT NULL,
  "current_title" text,
  "location" text,
  "industry" text,
  "shift" text,
  "email" text,
  "phone" text,
  "compensation_target" text,
  "current_compensation" text,
  "current_company" text,
  "submitted_on" text,
  "submitted_to" text,
  "notes" text,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tracker_candidates_pkey" PRIMARY KEY (id),
  CONSTRAINT "tracker_candidates_tracker_row_key" UNIQUE (tracker_row)
);

CREATE INDEX tracker_candidates_name_idx ON public.tracker_candidates USING btree (candidate_name);

ALTER TABLE public."tracker_candidates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ja_read" ON public."tracker_candidates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_authorized_recruiter());
COMMENT ON TABLE public."tracker_candidates" IS 'Google Sheets Tracker Candidates source. Facts remain source-grounded.';

-- tracker_jobs
CREATE TABLE public."tracker_jobs" (
  "job_id" bigint NOT NULL,
  "tracker_row" integer NOT NULL,
  "job_title" text NOT NULL,
  "company" text,
  "client_contact" text,
  "location" text,
  "compensation" text,
  "date_opened" date,
  "owners" text,
  "status" text,
  "job_description" text,
  "loxo_link" text,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tracker_jobs_pkey" PRIMARY KEY (job_id),
  CONSTRAINT "tracker_jobs_tracker_row_key" UNIQUE (tracker_row)
);

ALTER TABLE public."tracker_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ja_read" ON public."tracker_jobs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_authorized_recruiter());
COMMENT ON TABLE public."tracker_jobs" IS 'Google Sheets Tracker Jobs source. Deals and financial tabs are excluded.';

-- tracker_sourcing
CREATE TABLE public."tracker_sourcing" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "tracker_row" integer NOT NULL,
  "role" text,
  "candidate_name" text,
  "current_company" text,
  "current_title" text,
  "profile_url" text,
  "evidence_url" text,
  "found_at" text,
  "review_status" text,
  "fit_evidence" text,
  "gaps" text,
  "candidate_key" text,
  "business_email" text,
  "personal_email" text,
  "mobile_number" text,
  "work_number" text,
  "other_phone" text,
  "source_tab_range" text,
  "source_group" text,
  "source_notes" text,
  "next_check" text,
  "email" text,
  "phone" text,
  "original_row_snapshot" jsonb,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tracker_sourcing_pkey" PRIMARY KEY (id),
  CONSTRAINT "tracker_sourcing_tracker_row_key" UNIQUE (tracker_row)
);

CREATE INDEX tracker_sourcing_candidate_key_idx ON public.tracker_sourcing USING btree (candidate_key);
CREATE INDEX tracker_sourcing_role_idx ON public.tracker_sourcing USING btree (role);

ALTER TABLE public."tracker_sourcing" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ja_read" ON public."tracker_sourcing" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_authorized_recruiter());
COMMENT ON TABLE public."tracker_sourcing" IS 'Google Sheets Tracker Sourcing source with evidence and review status.';

-- tracker_submissions
CREATE TABLE public."tracker_submissions" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "tracker_row" integer NOT NULL,
  "submission_date" date,
  "recruiter" text,
  "candidate_name" text NOT NULL,
  "current_title" text,
  "current_company" text,
  "licenses_certifications" text,
  "location" text,
  "industry" text,
  "target_current_compensation" text,
  "reason_for_leaving" text,
  "profile_summary" text,
  "additional_notes" text,
  "submission_type" text,
  "role_submitted_for" text,
  "client_submitted_to" text,
  "activity_status" text,
  "submission_link" text,
  "gmail_message_id" text,
  "gmail_thread_id" text,
  "candidate_key" text,
  "source_verified_date" date,
  "raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tracker_submissions_pkey" PRIMARY KEY (id),
  CONSTRAINT "tracker_submissions_tracker_row_key" UNIQUE (tracker_row)
);

CREATE INDEX tracker_submissions_candidate_key_idx ON public.tracker_submissions USING btree (candidate_key);
CREATE INDEX tracker_submissions_role_idx ON public.tracker_submissions USING btree (role_submitted_for);

ALTER TABLE public."tracker_submissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ja_read" ON public."tracker_submissions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_authorized_recruiter());
COMMENT ON TABLE public."tracker_submissions" IS 'Google Sheets Tracker Submissions source. No deal or revenue data.';

-- tracker_fits
CREATE TABLE public."tracker_fits" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "person_id" bigint NOT NULL,
  "fit_job_id" bigint,
  "fit_label" text NOT NULL,
  "tracker_sheet" text NOT NULL,
  "tracker_row" integer NOT NULL,
  "date_added" date,
  "added_by" text,
  "notes" text,
  "matched_resume_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT "tracker_fits_fit_job_id_fkey" FOREIGN KEY (fit_job_id) REFERENCES loxo_jobs(id),
  CONSTRAINT "tracker_fits_person_id_fkey" FOREIGN KEY (person_id) REFERENCES loxo_candidates(id) ON DELETE CASCADE,
  CONSTRAINT "tracker_fits_pkey" PRIMARY KEY (id)
);

CREATE INDEX tracker_fits_job_idx ON public.tracker_fits USING btree (fit_job_id);
CREATE INDEX tracker_fits_person_idx ON public.tracker_fits USING btree (person_id);

ALTER TABLE public."tracker_fits" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ja_read" ON public."tracker_fits" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_authorized_recruiter());
COMMENT ON TABLE public."tracker_fits" IS 'Fit exists only with Google Sheets Tracker row provenance.';
