import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('candidate edits survive Tracker re-import and remain owner-scoped', async () => {
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION public.is_authorized_recruiter() RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT true $$;
  CREATE TABLE public.tracker_candidates (
    id bigint PRIMARY KEY, tracker_row integer UNIQUE NOT NULL, candidate_name text NOT NULL,
    current_title text, current_company text, location text, industry text, shift text,
    email text, phone text, compensation_target text, current_compensation text,
    notes text, imported_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.tracker_sourcing (
    id bigint PRIMARY KEY, tracker_row integer UNIQUE NOT NULL, candidate_name text,
    current_title text, current_company text, personal_email text, business_email text,
    email text, mobile_number text, phone text, work_number text, other_phone text,
    source_notes text, profile_url text, role text, candidate_key text,
    imported_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.tracker_submissions (
    id bigint PRIMARY KEY, tracker_row integer UNIQUE NOT NULL, candidate_name text NOT NULL,
    current_title text, current_company text, location text, industry text,
    target_current_compensation text, additional_notes text, role_submitted_for text,
    client_submitted_to text, candidate_key text, imported_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.candidate_edits (
    owner_id uuid NOT NULL, tracker_source text NOT NULL, tracker_row integer NOT NULL,
    edits jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.candidates_manual (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
    candidate_name text NOT NULL, current_title text, current_company text,
    location text, industry text, shift text, email text, phone text,
    compensation_target text, current_compensation text, notes text,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public.candidate_edits ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.candidates_manual ENABLE ROW LEVEL SECURITY;
  CREATE POLICY candidate_edits_owner ON public.candidate_edits TO authenticated
    USING (owner_id = auth.uid());
  CREATE POLICY candidates_manual_owner ON public.candidates_manual TO authenticated
    USING (owner_id = auth.uid());
  GRANT USAGE ON SCHEMA public, auth TO authenticated;
  GRANT SELECT ON public.tracker_candidates, public.tracker_sourcing, public.tracker_submissions TO authenticated;
  GRANT SELECT ON public.candidate_edits, public.candidates_manual TO authenticated;
`);

await db.exec(await readFile(new URL('../migrations/010_candidates_all.sql', import.meta.url), 'utf8'));

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [first, second]);
await db.query("INSERT INTO public.tracker_candidates (id, tracker_row, candidate_name, current_title, notes) VALUES (1, 7, 'Source Name', 'Source Title', 'Source Note')");
await db.query("INSERT INTO public.candidate_edits (owner_id, tracker_source, tracker_row, edits) VALUES ($1, 'tracker_candidates', 7, '{\"current_title\":\"Edited Title\",\"notes\":null}'::jsonb)", [first]);
await db.query("INSERT INTO public.candidates_manual (owner_id, candidate_name) VALUES ($1, 'Manual Candidate')", [first]);

await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [first]);
await db.exec('SET ROLE authenticated');
let rows = (await db.query("SELECT id, candidate_name, current_title, notes FROM public.candidates_all ORDER BY id")).rows;
assert.equal(rows.length, 2);
assert.deepEqual(rows.find(row => row.id === 'tracker_candidates:1'), {
  id: 'tracker_candidates:1', candidate_name: 'Source Name', current_title: 'Edited Title', notes: null,
});
assert.ok(rows.some(row => row.id.startsWith('manual:') && row.candidate_name === 'Manual Candidate'));

await db.exec('RESET ROLE');
await db.query("UPDATE public.tracker_candidates SET current_title = 'Reimported Title', notes = 'Reimported Note' WHERE id = 1");
await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [first]);
await db.exec('SET ROLE authenticated');
rows = (await db.query("SELECT id, current_title, notes FROM public.candidates_all WHERE id = 'tracker_candidates:1'")).rows;
assert.deepEqual(rows, [{ id: 'tracker_candidates:1', current_title: 'Edited Title', notes: null }]);

await db.exec('RESET ROLE');
await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [second]);
await db.exec('SET ROLE authenticated');
rows = (await db.query("SELECT id, current_title, notes FROM public.candidates_all ORDER BY id")).rows;
assert.deepEqual(rows, [{ id: 'tracker_candidates:1', current_title: 'Reimported Title', notes: 'Reimported Note' }]);

await db.close();
});
