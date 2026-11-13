import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.is_authorized_recruiter() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IN ('${owner}'::uuid,'${other}'::uuid) $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated;
    CREATE TABLE public.tracker_candidates(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tracker_row integer NOT NULL UNIQUE,candidate_name text NOT NULL,current_title text,location text,industry text,shift text,email text,phone text,compensation_target text,current_compensation text,current_company text,submitted_on text,submitted_to text,notes text,raw jsonb DEFAULT '{}'::jsonb NOT NULL,imported_at timestamptz DEFAULT now() NOT NULL);
    CREATE TABLE public.tracker_jobs(job_id bigint PRIMARY KEY,tracker_row integer NOT NULL UNIQUE,job_title text NOT NULL,company text,client_contact text,location text,compensation text,date_opened date,owners text,status text,job_description text,loxo_link text,raw jsonb DEFAULT '{}'::jsonb NOT NULL,imported_at timestamptz DEFAULT now() NOT NULL);
    CREATE TABLE public.tracker_sourcing(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tracker_row integer NOT NULL UNIQUE,role text,candidate_name text,current_company text,current_title text,profile_url text,evidence_url text,found_at text,review_status text,fit_evidence text,gaps text,candidate_key text,business_email text,personal_email text,mobile_number text,work_number text,other_phone text,source_tab_range text,source_group text,source_notes text,next_check text,email text,phone text,original_row_snapshot jsonb,raw jsonb DEFAULT '{}'::jsonb NOT NULL,imported_at timestamptz DEFAULT now() NOT NULL);
    CREATE TABLE public.tracker_submissions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tracker_row integer NOT NULL UNIQUE,submission_date date,recruiter text,candidate_name text NOT NULL,current_title text,current_company text,licenses_certifications text,location text,industry text,target_current_compensation text,reason_for_leaving text,profile_summary text,additional_notes text,submission_type text,role_submitted_for text,client_submitted_to text,activity_status text,submission_link text,gmail_message_id text,gmail_thread_id text,candidate_key text,source_verified_date date,raw jsonb DEFAULT '{}'::jsonb NOT NULL,imported_at timestamptz DEFAULT now() NOT NULL);
    CREATE TABLE public.loxo_candidates(id bigint PRIMARY KEY); CREATE TABLE public.loxo_jobs(id bigint PRIMARY KEY);
    CREATE TABLE public.tracker_fits(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,person_id bigint NOT NULL REFERENCES public.loxo_candidates(id),fit_job_id bigint REFERENCES public.loxo_jobs(id),fit_label text NOT NULL,tracker_sheet text NOT NULL,tracker_row integer NOT NULL,date_added date,added_by text,notes text,matched_resume_lines jsonb DEFAULT '[]'::jsonb NOT NULL);
    GRANT SELECT ON public.tracker_candidates,public.tracker_jobs,public.tracker_sourcing,public.tracker_submissions,public.tracker_fits TO authenticated;
    INSERT INTO auth.users VALUES ('${owner}'),('${other}'); INSERT INTO public.loxo_candidates VALUES (7); INSERT INTO public.loxo_jobs VALUES (42);
  `);
  await db.exec(await readFile(new URL("../migrations/024_tracker_imports.sql", import.meta.url), "utf8"));
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("SET ROLE authenticated");
  return db;
}

test("canonical import is owner isolated, repeat safe, and never name merges", async () => {
  const db = await database();
  try {
    const imported = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('candidates','upload:stable-id') RETURNING id`)).rows[0].id;
    const row = { sourceType: "candidates", sourceRowKey: "upload:stable-id:email:a@example.invalid", fingerprint: "11111111111111111111111111111111", sourceRow: 2, action: "insert", values: { candidate_name: "Alex Lee", email: "a@example.invalid" }, problems: [], blocked: false, identityBasis: "explicit_field" };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [imported, JSON.stringify([row]), "email"]);
    const choice = { sourceRowKey: row.sourceRowKey, action: "insert" };
    const first = await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb) AS result", [imported, JSON.stringify([choice])]);
    const id = first.rows[0].result.rows[0].canonicalId;
    const second = await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb) AS result", [imported, JSON.stringify([choice])]);
    assert.equal(second.rows[0].result.rows[0].canonicalId, id);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.tracker_candidates WHERE candidate_name='Alex Lee'")).rows[0].n, 1);

    const secondImport = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('candidates','upload:second') RETURNING id`)).rows[0].id;
    const otherName = { ...row, sourceRowKey: "upload:second:email:b@example.invalid", fingerprint: "22222222222222222222222222222222", action: "insert", values: { candidate_name: "Alex Lee", email: "b@example.invalid" } };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [secondImport, JSON.stringify([otherName]), "email"]);
    await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [secondImport, JSON.stringify([{ sourceRowKey: otherName.sourceRowKey, action: "insert" }])]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.tracker_candidates WHERE candidate_name='Alex Lee'")).rows[0].n, 2);

    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.exec("SET ROLE authenticated");
    const competingImport = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('candidates','upload:stable-id') RETURNING id`)).rows[0].id;
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [competingImport, JSON.stringify([row]), "email"]);
    await assert.rejects(db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [competingImport, JSON.stringify([choice])]), /belongs to another recruiter/);

    await assert.rejects(db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [imported, JSON.stringify([choice])]), /import is unavailable|authorized recruiter required/);
  } finally { await db.close(); }
});

test("updates require the exact source mapping and fit foreign keys fail atomically", async () => {
  const db = await database();
  try {
    const imported = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('jobs','sheet:sheet-id:Jobs') RETURNING id`)).rows[0].id;
    const job = { sourceType: "jobs", sourceRowKey: "sheet:sheet-id:Jobs:job_id:71", fingerprint: "33333333333333333333333333333333", sourceRow: 2, action: "insert", values: { job_id: "71", job_title: "Controller" }, problems: [], blocked: false, identityBasis: "explicit_field" };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [imported, JSON.stringify([job]), "job_id"]);
    await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [imported, JSON.stringify([{ sourceRowKey: job.sourceRowKey, action: "insert" }])]);
    const changedImport = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('jobs','sheet:sheet-id:Jobs') RETURNING id`)).rows[0].id;
    const changedJob = { ...job, fingerprint: "44444444444444444444444444444444", values: { job_id: "71", job_title: "Controller revised" } };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [changedImport, JSON.stringify([changedJob]), "job_id"]);
    await assert.rejects(db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [changedImport, JSON.stringify([{ sourceRowKey: changedJob.sourceRowKey, action: "update", canonicalId: 999 }])]), /exact mapped update/);
    await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [changedImport, JSON.stringify([{ sourceRowKey: changedJob.sourceRowKey, action: "update", canonicalId: 71 }])]);
    assert.equal((await db.query("SELECT job_title FROM public.tracker_jobs WHERE job_id=71")).rows[0].job_title, "Controller revised");

    const staleImport = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('jobs','sheet:sheet-id:Jobs') RETURNING id`)).rows[0].id;
    const staleJob = { ...changedJob, fingerprint: "66666666666666666666666666666666", values: { job_id: "71", job_title: "Next source title" } };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [staleImport, JSON.stringify([staleJob]), "job_id"]);
    await db.exec("RESET ROLE");
    await db.query("UPDATE public.tracker_jobs SET job_title='Human edit retained' WHERE job_id=71");
    await db.exec("SET ROLE authenticated");
    await assert.rejects(db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [staleImport, JSON.stringify([{ sourceRowKey: staleJob.sourceRowKey, action: "update", canonicalId: 71 }])]), /mapped job changed since preview/);
    assert.equal((await db.query("SELECT job_title FROM public.tracker_jobs WHERE job_id=71")).rows[0].job_title, "Human edit retained");

    const fits = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('fits','sheet:sheet-id:Fits') RETURNING id`)).rows[0].id;
    const fit = { sourceType: "fits", sourceRowKey: "sheet:sheet-id:Fits:row:2", fingerprint: "55555555555555555555555555555555", sourceRow: 2, values: { person_id: "999", fit_job_id: "42", fit_label: "Strong", tracker_sheet: "Fits", tracker_row: 2 }, problems: [], blocked: false, identityBasis: "row_position_requires_reconciliation" };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,NULL)", [fits, JSON.stringify([fit])]);
    await assert.rejects(db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [fits, JSON.stringify([{ sourceRowKey: fit.sourceRowKey, action: "insert", reviewedIdentity: true }])]), /foreign key|violates/i);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.tracker_fits")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("partial imports remain resumable and row-position acknowledgement is enforced in SQL", async () => {
  const db = await database();
  try {
    const run = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('candidates','upload:resume') RETURNING id`)).rows[0].id;
    const rows = [
      { sourceType: "candidates", sourceRowKey: "upload:resume:email:first@example.invalid", fingerprint: "77777777777777777777777777777777", sourceRow: 2, values: { candidate_name: "First Person", email: "first@example.invalid" }, problems: [], blocked: false, identityBasis: "explicit_field" },
      { sourceType: "candidates", sourceRowKey: "upload:resume:email:second@example.invalid", fingerprint: "88888888888888888888888888888888", sourceRow: 3, values: { candidate_name: "Second Person", email: "second@example.invalid" }, problems: [], blocked: false, identityBasis: "explicit_field" },
    ];
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [run, JSON.stringify(rows), "email"]);
    const first = await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb) AS result", [run, JSON.stringify([{ sourceRowKey: rows[0].sourceRowKey, action: "insert" }])]);
    assert.equal(first.rows[0].result.status, "partial");
    assert.equal(first.rows[0].result.remainingEligible, 1);
    const second = await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb) AS result", [run, JSON.stringify([{ sourceRowKey: rows[1].sourceRowKey, action: "insert" }])]);
    assert.equal(second.rows[0].result.status, "confirmed");
    assert.equal(second.rows[0].result.importedCount, 1);

    const rowRun = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('candidates','upload:row-position') RETURNING id`)).rows[0].id;
    const rowPosition = { ...rows[0], sourceRowKey: "upload:row-position:row:2", fingerprint: "99999999999999999999999999999999", sourceRow: 2, identityBasis: "explicit_field", blocked: false };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,NULL)", [rowRun, JSON.stringify([rowPosition])]);
    await assert.rejects(db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [rowRun, JSON.stringify([{ sourceRowKey: rowPosition.sourceRowKey, action: "insert" }])]), /unresolved problems|manual reconciliation/);
    const inserted = await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb) AS result", [rowRun, JSON.stringify([{ sourceRowKey: rowPosition.sourceRowKey, action: "insert", reviewedIdentity: true }])]);
    const canonicalId = inserted.rows[0].result.rows[0].canonicalId;
    const reorderedRun = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('candidates','upload:row-position') RETURNING id`)).rows[0].id;
    const reordered = { ...rowPosition, fingerprint: "12121212121212121212121212121212", values: { candidate_name: "Different person after row movement", email: "new@example.invalid" } };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,NULL)", [reorderedRun, JSON.stringify([reordered])]);
    await assert.rejects(db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [reorderedRun, JSON.stringify([{ sourceRowKey: reordered.sourceRowKey, action: "update", canonicalId }])]), /manual reconciliation|unresolved problems/);
    await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [reorderedRun, JSON.stringify([{ sourceRowKey: reordered.sourceRowKey, action: "update", canonicalId, reviewedIdentity: true }])]);
    assert.equal((await db.query("SELECT candidate_name FROM public.tracker_candidates WHERE id=$1", [canonicalId])).rows[0].candidate_name, "Different person after row movement");
  } finally { await db.close(); }
});

test("sourcing and submissions write through to their canonical tables", async () => {
  const db = await database();
  try {
    const sourcingRun = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('sourcing','sheet:sourcing') RETURNING id`)).rows[0].id;
    const sourcing = { sourceType: "sourcing", sourceRowKey: "sheet:sourcing:candidate_key:key-1", fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sourceRow: 2, values: { candidate_name: "Morgan Lee", candidate_key: "key-1", role: "Controller" }, problems: [], blocked: false, identityBasis: "explicit_field" };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [sourcingRun, JSON.stringify([sourcing]), "candidate_key"]);
    await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [sourcingRun, JSON.stringify([{ sourceRowKey: sourcing.sourceRowKey, action: "insert" }])]);
    assert.equal((await db.query("SELECT candidate_name FROM public.tracker_sourcing")).rows[0].candidate_name, "Morgan Lee");

    const submissionRun = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('submissions','sheet:submissions') RETURNING id`)).rows[0].id;
    const submission = { sourceType: "submissions", sourceRowKey: "sheet:submissions:candidate_key:key-2", fingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", sourceRow: 2, values: { candidate_name: "Morgan Lee", candidate_key: "key-2", role_submitted_for: "Controller" }, problems: [], blocked: false, identityBasis: "explicit_field" };
    await db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [submissionRun, JSON.stringify([submission]), "candidate_key"]);
    await db.query("SELECT public.confirm_tracker_import($1,$2::jsonb)", [submissionRun, JSON.stringify([{ sourceRowKey: submission.sourceRowKey, action: "insert" }])]);
    assert.equal((await db.query("SELECT candidate_name FROM public.tracker_submissions")).rows[0].candidate_name, "Morgan Lee");
  } finally { await db.close(); }
});

test("preview source-row keys must stay inside the selected persistent source", async () => {
  const db = await database();
  try {
    const run = (await db.query(`INSERT INTO public.tracker_imports(source_type,source_key) VALUES ('candidates','upload:source-one') RETURNING id`)).rows[0].id;
    const forged = { sourceType: "candidates", sourceRowKey: "upload:source-two:email:a@example.invalid", fingerprint: "cccccccccccccccccccccccccccccccc", sourceRow: 2, values: { candidate_name: "Alex Lee", email: "a@example.invalid" }, problems: [], blocked: false, identityBasis: "explicit_field" };
    await assert.rejects(db.query("SELECT public.save_tracker_import_preview($1,$2::jsonb,$3)", [run, JSON.stringify([forged]), "email"]), /does not belong to this import source/);
  } finally { await db.close(); }
});
