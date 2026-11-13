import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

test("importer tables revoke broad default grants and retain only intended owner-scoped access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION public.is_authorized_recruiter() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IN ('${owner}'::uuid,'${other}'::uuid) $$;
      GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
      CREATE TABLE public.tracker_candidates(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tracker_row integer NOT NULL UNIQUE,candidate_name text NOT NULL,current_title text,location text,industry text,shift text,email text,phone text,compensation_target text,current_compensation text,current_company text,submitted_on text,submitted_to text,notes text,raw jsonb DEFAULT '{}'::jsonb NOT NULL,imported_at timestamptz DEFAULT now() NOT NULL);
      CREATE TABLE public.tracker_jobs(job_id bigint PRIMARY KEY,tracker_row integer NOT NULL UNIQUE,job_title text NOT NULL,company text,client_contact text,location text,compensation text,date_opened date,owners text,status text,job_description text,loxo_link text,raw jsonb DEFAULT '{}'::jsonb NOT NULL,imported_at timestamptz DEFAULT now() NOT NULL);
      CREATE TABLE public.tracker_sourcing(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tracker_row integer NOT NULL UNIQUE,role text,candidate_name text,current_company text,current_title text,profile_url text,evidence_url text,found_at text,review_status text,fit_evidence text,gaps text,candidate_key text,business_email text,personal_email text,mobile_number text,work_number text,other_phone text,source_tab_range text,source_group text,source_notes text,next_check text,email text,phone text,original_row_snapshot jsonb,raw jsonb DEFAULT '{}'::jsonb NOT NULL,imported_at timestamptz DEFAULT now() NOT NULL);
      CREATE TABLE public.tracker_submissions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tracker_row integer NOT NULL UNIQUE,submission_date date,recruiter text,candidate_name text NOT NULL,current_title text,current_company text,licenses_certifications text,location text,industry text,target_current_compensation text,reason_for_leaving text,profile_summary text,additional_notes text,submission_type text,role_submitted_for text,client_submitted_to text,activity_status text,submission_link text,gmail_message_id text,gmail_thread_id text,candidate_key text,source_verified_date date,raw jsonb DEFAULT '{}'::jsonb NOT NULL,imported_at timestamptz DEFAULT now() NOT NULL);
      CREATE TABLE public.loxo_candidates(id bigint PRIMARY KEY); CREATE TABLE public.loxo_jobs(id bigint PRIMARY KEY);
      CREATE TABLE public.tracker_fits(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,person_id bigint NOT NULL REFERENCES public.loxo_candidates(id),fit_job_id bigint REFERENCES public.loxo_jobs(id),fit_label text NOT NULL,tracker_sheet text NOT NULL,tracker_row integer NOT NULL,date_added date,added_by text,notes text,matched_resume_lines jsonb DEFAULT '[]'::jsonb NOT NULL);
    `);
    await db.exec(await readFile(new URL("../migrations/024_tracker_imports.sql", import.meta.url), "utf8"));
    await db.exec("GRANT ALL ON public.tracker_imports,public.tracker_import_source_rows,public.tracker_import_preview_rows TO anon,authenticated");
    await db.exec(await readFile(new URL("../migrations/025_tracker_import_privileges.sql", import.meta.url), "utf8"));
    await db.query("INSERT INTO auth.users VALUES ($1),($2)", [owner, other]);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec("SET ROLE authenticated");

    assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.tracker_imports','insert') AS value")).rows[0].value, true);
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.tracker_imports','update') AS value")).rows[0].value, false);
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.tracker_import_source_rows','insert') AS value")).rows[0].value, false);
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.tracker_import_preview_rows','insert') AS value")).rows[0].value, false);
    assert.equal((await db.query("SELECT has_table_privilege('anon','public.tracker_imports','select') AS value")).rows[0].value, false);

    const created = await db.query("INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('candidates','upload:owner') RETURNING id");
    const id = created.rows[0].id;
    await assert.rejects(db.query("INSERT INTO public.tracker_imports(owner_id,source_type,source_key) VALUES ($1,'candidates','upload:spoof')", [other]), /row-level security|policy/i);
    await assert.rejects(db.query("UPDATE public.tracker_imports SET status='confirmed' WHERE id=$1", [id]), /permission denied/i);
    await assert.rejects(db.query("INSERT INTO public.tracker_import_source_rows(owner_id,import_id,source_row_key,source_row,source_fingerprint,source_type,canonical_id,canonical_fingerprint) VALUES ($1,$2,'x',2,repeat('a',32),'candidates',1,repeat('b',32))", [owner,id]), /permission denied/i);
    await assert.rejects(db.query("INSERT INTO public.tracker_import_preview_rows(owner_id,import_id,source_type,source_row_key,source_row,source_fingerprint,values,identity_basis) VALUES ($1,$2,'candidates','upload:owner:row:2',2,repeat('a',32),'{}','row_position_requires_reconciliation')", [owner,id]), /permission denied/i);

    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.exec("SET ROLE authenticated");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.tracker_imports")).rows[0].n, 0);
  } finally { await db.close(); }
});
