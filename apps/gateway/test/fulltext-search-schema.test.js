import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL full-text search covers candidates_all, leads, tracker_jobs, distinct client companies, and notes under RLS', async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION public.is_authorized_recruiter() RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT auth.uid() IS NOT NULL AND auth.uid() <> '33333333-3333-4333-8333-333333333333'::uuid $$;

    CREATE TABLE public.tracker_candidates (
      id bigint PRIMARY KEY,
      tracker_row integer UNIQUE NOT NULL,
      candidate_name text NOT NULL,
      current_title text,
      location text,
      industry text,
      shift text,
      email text,
      phone text,
      compensation_target text,
      current_compensation text,
      current_company text,
      submitted_on text,
      submitted_to text,
      notes text,
      raw jsonb NOT NULL DEFAULT '{}'::jsonb,
      imported_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.tracker_sourcing (
      id bigint PRIMARY KEY,
      tracker_row integer UNIQUE NOT NULL,
      role text,
      candidate_name text,
      current_company text,
      current_title text,
      profile_url text,
      evidence_url text,
      found_at text,
      review_status text,
      fit_evidence text,
      gaps text,
      candidate_key text,
      business_email text,
      personal_email text,
      mobile_number text,
      work_number text,
      other_phone text,
      source_tab_range text,
      source_group text,
      source_notes text,
      next_check text,
      email text,
      phone text,
      original_row_snapshot jsonb,
      raw jsonb NOT NULL DEFAULT '{}'::jsonb,
      imported_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.tracker_submissions (
      id bigint PRIMARY KEY,
      tracker_row integer UNIQUE NOT NULL,
      submission_date date,
      recruiter text,
      candidate_name text NOT NULL,
      current_title text,
      current_company text,
      licenses_certifications text,
      location text,
      industry text,
      target_current_compensation text,
      reason_for_leaving text,
      profile_summary text,
      additional_notes text,
      submission_type text,
      role_submitted_for text,
      client_submitted_to text,
      activity_status text,
      submission_link text,
      gmail_message_id text,
      gmail_thread_id text,
      candidate_key text,
      source_verified_date date,
      raw jsonb NOT NULL DEFAULT '{}'::jsonb,
      imported_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.tracker_jobs (
      job_id bigint PRIMARY KEY,
      tracker_row integer UNIQUE NOT NULL,
      job_title text NOT NULL,
      company text,
      client_contact text,
      location text,
      compensation text,
      date_opened date,
      owners text,
      status text,
      job_description text,
      loxo_link text,
      raw jsonb NOT NULL DEFAULT '{}'::jsonb,
      imported_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE public.tracker_candidates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_sourcing ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_submissions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_jobs ENABLE ROW LEVEL SECURITY;

    CREATE POLICY ja_read ON public.tracker_candidates
      FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY ja_read ON public.tracker_sourcing
      FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY ja_read ON public.tracker_submissions
      FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY ja_read ON public.tracker_jobs
      FOR SELECT TO authenticated USING (public.is_authorized_recruiter());

    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT SELECT ON public.tracker_candidates, public.tracker_sourcing, public.tracker_submissions, public.tracker_jobs TO authenticated;
  `);

  // Apply prerequisite migrations (004 leads, 008 candidate_edits, 009 candidates_manual, 010 candidates_all, 020 notes_boards)
  await db.exec(await readFile(new URL('../migrations/004_leads.sql', import.meta.url), 'utf8'));
  await db.exec(`
    CREATE TABLE public.candidate_edits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
      tracker_source text NOT NULL CHECK (tracker_source IN ('tracker_candidates', 'tracker_sourcing', 'tracker_submissions')),
      tracker_row integer NOT NULL CHECK (tracker_row > 0),
      edits jsonb NOT NULL CHECK (jsonb_typeof(edits) = 'object' AND edits <> '{}'::jsonb),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (owner_id, tracker_source, tracker_row)
    );
    ALTER TABLE public.candidate_edits ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_edits TO authenticated;
    CREATE POLICY candidate_edits_select_own ON public.candidate_edits
      FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

    CREATE TABLE public.candidates_manual (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
      candidate_name text NOT NULL CHECK (length(btrim(candidate_name)) > 0),
      current_title text,
      current_company text,
      location text,
      industry text,
      shift text,
      email text,
      phone text,
      compensation_target text,
      current_compensation text,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.candidates_manual ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidates_manual TO authenticated;
    CREATE POLICY candidates_manual_select_own ON public.candidates_manual
      FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

    CREATE VIEW public.candidates_all WITH (security_invoker = true) AS
    WITH imported AS (
      SELECT
        'tracker_candidates'::text AS candidate_source,
        'tracker_candidates'::text AS tracker_source,
        c.id::text AS candidate_source_id,
        c.tracker_row,
        c.candidate_name,
        c.current_title,
        c.current_company,
        c.location,
        c.industry,
        c.shift,
        c.email,
        c.phone,
        c.compensation_target,
        c.current_compensation,
        NULL::text AS compensation_context,
        c.notes,
        NULL::text AS profile_url,
        NULL::text AS role_context,
        NULL::text AS client_context,
        NULL::text AS source_candidate_key,
        c.imported_at AS source_updated_at
      FROM public.tracker_candidates c
      UNION ALL
      SELECT
        'sourcing'::text,
        'tracker_sourcing'::text,
        s.id::text,
        s.tracker_row,
        s.candidate_name,
        s.current_title,
        s.current_company,
        NULL::text,
        NULL::text,
        NULL::text,
        COALESCE(NULLIF(s.personal_email, ''), NULLIF(s.business_email, ''), NULLIF(s.email, '')),
        COALESCE(NULLIF(s.mobile_number, ''), NULLIF(s.phone, ''), NULLIF(s.work_number, ''), NULLIF(s.other_phone, '')),
        NULL::text,
        NULL::text,
        NULL::text,
        s.source_notes,
        s.profile_url,
        s.role,
        NULL::text,
        s.candidate_key,
        s.imported_at
      FROM public.tracker_sourcing s
      UNION ALL
      SELECT
        'submission'::text,
        'tracker_submissions'::text,
        s.id::text,
        s.tracker_row,
        s.candidate_name,
        s.current_title,
        s.current_company,
        s.location,
        s.industry,
        NULL::text,
        NULL::text,
        NULL::text,
        NULL::text,
        NULL::text,
        s.target_current_compensation,
        s.additional_notes,
        NULL::text,
        s.role_submitted_for,
        s.client_submitted_to,
        s.candidate_key,
        s.imported_at
      FROM public.tracker_submissions s
    ), overlaid AS (
      SELECT
        b.candidate_source || ':' || b.candidate_source_id AS id,
        b.candidate_source,
        b.tracker_source,
        b.candidate_source_id,
        b.tracker_row,
        CASE WHEN e.edits ? 'candidate_name' THEN e.edits ->> 'candidate_name' ELSE b.candidate_name END AS candidate_name,
        CASE WHEN e.edits ? 'current_title' THEN e.edits ->> 'current_title' ELSE b.current_title END AS current_title,
        CASE WHEN e.edits ? 'current_company' THEN e.edits ->> 'current_company' ELSE b.current_company END AS current_company,
        CASE WHEN e.edits ? 'location' THEN e.edits ->> 'location' ELSE b.location END AS location,
        CASE WHEN e.edits ? 'industry' THEN e.edits ->> 'industry' ELSE b.industry END AS industry,
        CASE WHEN e.edits ? 'shift' THEN e.edits ->> 'shift' ELSE b.shift END AS shift,
        CASE WHEN e.edits ? 'email' THEN e.edits ->> 'email' ELSE b.email END AS email,
        CASE WHEN e.edits ? 'phone' THEN e.edits ->> 'phone' ELSE b.phone END AS phone,
        CASE WHEN e.edits ? 'compensation_target' THEN e.edits ->> 'compensation_target' ELSE b.compensation_target END AS compensation_target,
        CASE WHEN e.edits ? 'current_compensation' THEN e.edits ->> 'current_compensation' ELSE b.current_compensation END AS current_compensation,
        CASE WHEN e.edits ? 'compensation_context' THEN e.edits ->> 'compensation_context' ELSE b.compensation_context END AS compensation_context,
        CASE WHEN e.edits ? 'notes' THEN e.edits ->> 'notes' ELSE b.notes END AS notes,
        CASE WHEN e.edits ? 'profile_url' THEN e.edits ->> 'profile_url' ELSE b.profile_url END AS profile_url,
        CASE WHEN e.edits ? 'role_context' THEN e.edits ->> 'role_context' ELSE b.role_context END AS role_context,
        CASE WHEN e.edits ? 'client_context' THEN e.edits ->> 'client_context' ELSE b.client_context END AS client_context,
        b.source_candidate_key,
        b.source_updated_at,
        e.updated_at AS edited_at,
        false AS is_manual
      FROM imported b
      LEFT JOIN public.candidate_edits e
        ON e.owner_id = (SELECT auth.uid())
       AND e.tracker_source = b.tracker_source
       AND e.tracker_row = b.tracker_row
    )
    SELECT * FROM overlaid
    UNION ALL
    SELECT
      'manual:' || m.id::text AS id,
      'manual'::text AS candidate_source,
      NULL::text AS tracker_source,
      m.id::text AS candidate_source_id,
      NULL::integer AS tracker_row,
      m.candidate_name,
      m.current_title,
      m.current_company,
      m.location,
      m.industry,
      m.shift,
      m.email,
      m.phone,
      m.compensation_target,
      m.current_compensation,
      NULL::text AS compensation_context,
      m.notes,
      NULL::text AS profile_url,
      NULL::text AS role_context,
      NULL::text AS client_context,
      NULL::text AS source_candidate_key,
      m.updated_at AS source_updated_at,
      m.updated_at AS edited_at,
      true AS is_manual
    FROM public.candidates_manual m;

    REVOKE ALL ON TABLE public.candidates_all FROM anon;
    GRANT SELECT ON TABLE public.candidates_all TO authenticated;

    CREATE TABLE public.notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
      title text NOT NULL DEFAULT '',
      subject_type text,
      subject_id text,
      body jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(body) = 'object'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.notes FROM anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
    CREATE POLICY notes_select_own ON public.notes
      FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
  `);

  // Apply migration 021_fulltext_search.sql
  await db.exec(await readFile(new URL('../migrations/021_fulltext_search.sql', import.meta.url), 'utf8'));

  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const unauthorized = '33333333-3333-4333-8333-333333333333';
  await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2), ($3)', [first, second, unauthorized]);

  // Verify honest empty state with zero fabricated rows
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [first]);
  await db.exec('SET ROLE authenticated');
  assert.deepEqual((await db.query('SELECT * FROM public.client_companies')).rows, []);
  assert.deepEqual((await db.query('SELECT * FROM public.search_documents')).rows, []);
  assert.deepEqual((await db.query("SELECT * FROM public.search_workbench('program manager')")).rows, []);

  // Seed synthetic records across candidates, edits, manual candidates, leads, jobs, and notes
  await db.exec('RESET ROLE');

  // 1. Candidates:
  // Row 10: Imported as Operations Coordinator, edited by `first` to Senior Program Manager
  // Row 11: Imported as Program Manager, edited by `first` to Plant Controller (should NOT match program manager for `first`, SHOULD match for `second`)
  await db.query(`
    INSERT INTO public.tracker_candidates (id, tracker_row, candidate_name, current_title, current_company, location, notes)
    VALUES
      (10, 10, 'Synthetic Candidate Alpha', 'Operations Coordinator', 'Northwind Parts', 'Guelph, ON', 'Automotive launches'),
      (11, 11, 'Synthetic Candidate Beta', 'Program Manager', 'Contoso Metals', 'Kitchener, ON', 'Program management track')
  `);
  await db.query(
    `INSERT INTO public.candidate_edits (owner_id, tracker_source, tracker_row, edits)
     VALUES
       ($1, 'tracker_candidates', 10, '{"current_title":"Senior Program Manager"}'::jsonb),
       ($1, 'tracker_candidates', 11, '{"current_title":"Plant Controller","notes":null}'::jsonb)`,
    [first]
  );
  await db.query(`
    INSERT INTO public.tracker_sourcing (id, tracker_row, candidate_name, current_title, current_company, role, source_notes)
    VALUES (20, 20, 'Synthetic Sourced Gamma', 'Launch Lead', 'Fabrikam Stamping', 'Program Manager', 'Strong tier-1 background')
  `);
  await db.query(`
    INSERT INTO public.tracker_submissions (id, tracker_row, candidate_name, current_title, current_company, location, role_submitted_for, client_submitted_to, additional_notes)
    VALUES (30, 30, 'Synthetic Submitted Epsilon', 'Engineering Lead', 'Adventure Works', 'Hamilton, ON', 'Program Manager', 'Apex Tooling', 'Presented for launch role')
  `);
  await db.query(`
    INSERT INTO public.candidates_manual (id, owner_id, candidate_name, current_title, current_company, location, notes)
    VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'Synthetic Manual Delta', 'Technical Program Manager', 'Boreal Systems', 'Waterloo, ON', 'Added in Workbench'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $2, 'Second Owner Manual', 'Program Manager', 'Private Corp', 'Toronto, ON', 'Owned by second recruiter')
  `, [first, second]);

  // 2. Leads:
  await db.query(`
    INSERT INTO public.leads (id, owner_id, company, contact, role, status, next_action, notes)
    VALUES
      ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', $1, 'Huron Mobility', 'Alex Morgan', 'Program Manager', 'Warm', 'Send terms', 'Need program manager for EV line'),
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', $2, 'Second Owner Lead Co', 'Jamie Taylor', 'Program Manager', 'New', 'Call', 'Private lead')
  `, [first, second]);

  // 3. Tracker Jobs & Distinct Client Companies:
  // Two jobs for the same company with whitespace/casing differences should collapse into one client_companies row
  await db.query(`
    INSERT INTO public.tracker_jobs (job_id, tracker_row, job_title, company, client_contact, location, status, date_opened, job_description)
    VALUES
      (501, 1, 'Program Manager', 'Apex Tooling', 'Jordan Lee', 'Guelph, ON', 'Active', '2026-11-01', 'Lead automotive program launches.'),
      (502, 2, 'Quality Manager', ' apex tooling ', 'Jordan Lee', 'Cambridge, ON', 'Active', '2026-11-05', 'APQP and PPAP oversight.')
  `);

  // 4. Notes:
  await db.query(`
    INSERT INTO public.notes (id, owner_id, title, subject_type, subject_id, body)
    VALUES
      (
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        $1,
        'Candidate screen summary',
        'candidate',
        'tracker_candidates:10',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"Program manager"},{"type":"text","text":" candidate ready for client presentation."}]}]}'::jsonb
      ),
      (
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        $2,
        'Second owner note',
        'candidate',
        'tracker_candidates:11',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Program manager private note."}]}]}'::jsonb
      )
  `, [first, second]);

  // Switch to first authorized recruiter
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [first]);
  await db.exec('SET ROLE authenticated');

  // Verify distinct client companies deduplication
  const clients = (await db.query('SELECT id, company, open_jobs_count, total_jobs_count, job_titles FROM public.client_companies')).rows;
  assert.equal(clients.length, 1);
  assert.deepEqual(clients[0], {
    id: 'client:apex tooling',
    company: 'Apex Tooling',
    open_jobs_count: 2,
    total_jobs_count: 2,
    job_titles: 'Program Manager · Quality Manager',
  });

  // Search for "program manager" as first recruiter
  const results = (await db.query("SELECT id, entity_type, entity_id, title, subtitle, snippet FROM public.search_workbench('program manager')")).rows;
  const byType = new Map();
  for (const row of results) {
    const list = byType.get(row.entity_type) || [];
    list.push(row);
    byType.set(row.entity_type, list);
  }

  // All 5 groups must return matching rows
  assert.deepEqual(
    [...byType.keys()].sort(),
    ['candidate', 'client', 'job', 'lead', 'note']
  );

  const candidateIds = byType.get('candidate').map((row) => row.entity_id).sort();
  assert.deepEqual(candidateIds, [
    'manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'sourcing:20',
    'submission:30',
    'tracker_candidates:10',
  ]);
  // Candidate 11 had Program Manager overwritten to Plant Controller by `first`, and second owner's manual candidate is RLS-isolated
  assert.ok(!candidateIds.includes('tracker_candidates:11'));
  assert.ok(!candidateIds.includes('manual:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));

  // Verify max_per_group caps per-entity results
  const capped = (await db.query("SELECT entity_type, count(*)::int AS cnt FROM public.search_workbench('program manager', 2) GROUP BY entity_type")).rows;
  const cappedCandidateCount = capped.find((r) => r.entity_type === 'candidate')?.cnt;
  assert.equal(cappedCandidateCount, 2);

  assert.deepEqual(byType.get('lead').map((row) => row.entity_id), ['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
  assert.deepEqual(byType.get('job').map((row) => row.entity_id), ['501']);
  assert.deepEqual(byType.get('client').map((row) => row.id), ['client:apex tooling']);
  assert.deepEqual(byType.get('note').map((row) => row.entity_id), ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']);
  assert.equal(byType.get('note')[0].snippet, 'Program manager candidate ready for client presentation.');

  // Editor metadata keys ("paragraph", "doc", "bold") must not produce false matches on notes
  const metadataHits = (await db.query("SELECT id FROM public.search_workbench('paragraph')")).rows;
  assert.deepEqual(metadataHits, []);

  // Blank and non-searchable queries return empty results cleanly
  assert.deepEqual((await db.query("SELECT id FROM public.search_workbench('   ')")).rows, []);
  assert.deepEqual((await db.query('SELECT id FROM public.search_workbench(NULL)')).rows, []);

  // Switch to second authorized recruiter: sees unedited candidate 11 + own manual candidate, lead, and note
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [second]);
  await db.exec('SET ROLE authenticated');

  const secondResults = (await db.query("SELECT id, entity_type, entity_id FROM public.search_workbench('program manager')")).rows;
  const secondCandidates = secondResults.filter((r) => r.entity_type === 'candidate').map((r) => r.entity_id).sort();
  assert.deepEqual(secondCandidates, [
    'manual:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'sourcing:20',
    'submission:30',
    'tracker_candidates:11',
  ]);
  assert.deepEqual(
    secondResults.filter((r) => r.entity_type === 'lead').map((r) => r.entity_id),
    ['dddddddd-dddd-4ddd-8ddd-dddddddddddd']
  );
  assert.deepEqual(
    secondResults.filter((r) => r.entity_type === 'note').map((r) => r.entity_id),
    ['ffffffff-ffff-4fff-8fff-ffffffffffff']
  );

  // Switch to unauthorized user: RLS blocks all 5 sources
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [unauthorized]);
  await db.exec('SET ROLE authenticated');
  assert.deepEqual((await db.query("SELECT id FROM public.search_workbench('program manager')")).rows, []);
  assert.deepEqual((await db.query('SELECT id FROM public.search_documents')).rows, []);
  assert.deepEqual((await db.query('SELECT id FROM public.client_companies')).rows, []);

  await db.close();
});
