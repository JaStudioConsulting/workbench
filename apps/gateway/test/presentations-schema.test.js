import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("presentations keep confirmed Tracker rows and pending actions distinct", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE FUNCTION public.is_authorized_recruiter() RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT auth.uid() = '11111111-1111-4111-8111-111111111111'::uuid $$;
      CREATE TABLE public.tracker_jobs (job_id bigint PRIMARY KEY, job_title text, company text);
      CREATE TABLE public.tracker_submissions (
        id bigint PRIMARY KEY, candidate_key text, candidate_name text,
        client_submitted_to text, role_submitted_for text, submission_date date,
        activity_status text, submission_type text, recruiter text, additional_notes text
      );
      CREATE TABLE public.tracker_sourcing (id bigint PRIMARY KEY, candidate_key text, candidate_name text);
      CREATE TABLE public.candidate_review_actions (
        id bigint PRIMARY KEY, status text, candidate_source text, candidate_source_id bigint,
        job_id bigint, action_type text, activity_type text, created_at timestamptz,
        note text
      );
      ALTER TABLE public.tracker_jobs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.tracker_submissions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.tracker_sourcing ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.candidate_review_actions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY jobs_read ON public.tracker_jobs FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
      CREATE POLICY submissions_read ON public.tracker_submissions FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
      CREATE POLICY sourcing_read ON public.tracker_sourcing FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
      CREATE POLICY actions_read ON public.candidate_review_actions FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT SELECT ON public.tracker_jobs, public.tracker_submissions, public.tracker_sourcing, public.candidate_review_actions TO authenticated;
    `);
    await db.exec(await readFile(new URL("../migrations/011_presentations.sql", import.meta.url), "utf8"));
    await db.exec(`
      INSERT INTO public.tracker_jobs VALUES
        (10, 'Program Manager', 'Client A'),
        (11, 'Program Manager', 'Client A'),
        (12, 'Accountant', 'Client B');
      INSERT INTO public.tracker_submissions VALUES
        (1, 'key-1', 'Candidate One', 'Client B', 'Accountant', '2026-10-01', 'Submitted', 'Role Submission', 'Ja', NULL),
        (2, 'key-2', 'Candidate Two', 'Client B', 'Accountant', '2026-10-02', 'New', 'Role Submission', 'Ja', NULL),
        (3, 'key-3', 'Candidate Three', NULL, 'Program Manager', '2026-10-03', 'Hired', 'MPC', 'Ja', NULL),
        (4, 'key-4', 'Candidate Four', 'Client A', 'Program Manager', '2026-10-04', 'Rejected', 'Role Submission', 'Ja', NULL);
      INSERT INTO public.tracker_sourcing VALUES (20, 'source-20', 'Source Candidate');
      INSERT INTO public.candidate_review_actions VALUES
        (100, 'waiting_for_loxo', 'sourcing', 20, 10, 'activity', 'Submitted', now(), 'Queued'),
        (101, 'waiting_for_loxo', 'submission', 1, 10, 'activity', 'Submitted', now(), 'Another client'),
        (102, 'failed', 'submission', 2, 12, 'activity', 'Submitted', now(), 'Failed'),
        (103, 'saved', 'sourcing', 20, 10, 'activity', 'Phone Call', now(), NULL);
    `);
    await db.query("SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false)");
    await db.exec("SET ROLE authenticated");
    const rows = (await db.query("SELECT id, presentation_state, client_name, job_id, presented_on, queued_at FROM public.presentations ORDER BY id")).rows;
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.map((row) => [row.id, row.presentation_state]), [
      ["candidate_review_actions:100", "pending"],
      ["candidate_review_actions:101", "pending"],
      ["candidate_review_actions:102", "failed"],
      ["tracker_submissions:1", "confirmed"],
      ["tracker_submissions:3", "confirmed"],
      ["tracker_submissions:4", "confirmed"],
    ]);
    assert.equal(rows.find((row) => row.id === "tracker_submissions:1").job_id, 12);
    assert.equal(rows.find((row) => row.id === "tracker_submissions:3").client_name, null);
    assert.equal(rows.find((row) => row.id === "tracker_submissions:4").job_id, null);
    assert.equal(rows.find((row) => row.id === "candidate_review_actions:101").client_name, "Client A");
    assert.equal(rows.find((row) => row.id === "candidate_review_actions:100").presented_on, null);
    assert.ok(rows.find((row) => row.id === "candidate_review_actions:100").queued_at);

    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false)");
    await db.exec("SET ROLE authenticated");
    assert.deepEqual((await db.query("SELECT id FROM public.presentations")).rows, []);
  } finally {
    await db.close();
  }
});
