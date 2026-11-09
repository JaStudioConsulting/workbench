import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { SearchResponseSchema } from "@ja/shared-types";
import { createApp } from "../app.js";

const SUPABASE_URL = "https://abnfffkmxqixrwzackjf.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0";
const FIRST_OWNER = "11111111-1111-4111-8111-111111111111";
const SECOND_OWNER = "22222222-2222-4222-8222-222222222222";
const UNAUTHORIZED_OWNER = "33333333-3333-4333-8333-333333333333";

const PREREQ_MIGRATIONS_SQL = `
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
REVOKE ALL ON TABLE public.candidate_edits FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidate_edits TO authenticated;
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
REVOKE ALL ON TABLE public.candidates_manual FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidates_manual TO authenticated;
CREATE POLICY candidates_manual_select_own ON public.candidates_manual
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE TABLE public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  subject_type text,
  subject_id text,
  body jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notes_subject_pair CHECK (
    (subject_type IS NULL AND subject_id IS NULL)
    OR (subject_type IS NOT NULL AND subject_type IN ('candidate', 'job', 'meeting')
      AND subject_id IS NOT NULL AND length(btrim(subject_id)) > 0)
  )
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notes TO authenticated;
CREATE POLICY notes_select_own ON public.notes
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
`;

const MIGRATION_021_FULLTEXT_SEARCH_SQL = `
CREATE OR REPLACE FUNCTION public.note_body_plain_text(body jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH RECURSIVE nodes(val) AS (
    SELECT body
    WHERE body IS NOT NULL AND pg_catalog.jsonb_typeof(body) = 'object'
    UNION ALL
    SELECT child.val
    FROM nodes n
    CROSS JOIN LATERAL (
      SELECT obj.value AS val
      FROM pg_catalog.jsonb_each(
        CASE WHEN pg_catalog.jsonb_typeof(n.val) = 'object' THEN n.val ELSE '{}'::jsonb END
      ) AS obj(key, value)
      WHERE pg_catalog.jsonb_typeof(n.val) = 'object'
        AND obj.key NOT IN ('type', 'attrs', 'marks')
      UNION ALL
      SELECT arr.value AS val
      FROM pg_catalog.jsonb_array_elements(
        CASE WHEN pg_catalog.jsonb_typeof(n.val) = 'array' THEN n.val ELSE '[]'::jsonb END
      ) AS arr(value)
      WHERE pg_catalog.jsonb_typeof(n.val) = 'array'
    ) child
    WHERE pg_catalog.jsonb_typeof(n.val) IN ('object', 'array')
  )
  SELECT COALESCE(
    pg_catalog.string_agg(pg_catalog.btrim(val #>> '{}'), ' ')
      FILTER (
        WHERE pg_catalog.jsonb_typeof(val) = 'string'
          AND pg_catalog.length(pg_catalog.btrim(val #>> '{}')) > 0
      ),
    ''
  )
  FROM nodes;
$$;

CREATE OR REPLACE FUNCTION public.workbench_search_tsquery(query_text text)
RETURNS tsquery
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN query_text IS NULL OR pg_catalog.length(pg_catalog.btrim(query_text)) = 0 THEN NULL::tsquery
    ELSE NULLIF(
      pg_catalog.websearch_to_tsquery('english'::regconfig, pg_catalog.btrim(query_text))::text,
      ''
    )::tsquery
  END;
$$;

CREATE VIEW public.client_companies WITH (security_invoker = true) AS
SELECT
  'client:' || lower(btrim(j.company)) AS id,
  lower(btrim(j.company)) AS client_key,
  (
    array_agg(
      btrim(j.company)
      ORDER BY (btrim(j.company) <> lower(btrim(j.company))) DESC, j.date_opened DESC NULLS LAST, j.imported_at DESC, j.job_id DESC
    )
  )[1] AS company,
  string_agg(DISTINCT NULLIF(btrim(j.client_contact), ''), ', ' ORDER BY NULLIF(btrim(j.client_contact), '')) AS client_contact,
  string_agg(DISTINCT NULLIF(btrim(j.location), ''), ', ' ORDER BY NULLIF(btrim(j.location), '')) AS location,
  string_agg(DISTINCT NULLIF(btrim(j.owners), ''), ', ' ORDER BY NULLIF(btrim(j.owners), '')) AS owners,
  string_agg(DISTINCT NULLIF(btrim(j.job_title), ''), ' · ' ORDER BY NULLIF(btrim(j.job_title), '')) AS job_titles,
  count(*) FILTER (WHERE lower(btrim(coalesce(j.status, ''))) = 'active')::integer AS open_jobs_count,
  count(*)::integer AS total_jobs_count,
  max(j.date_opened) AS newest_job_date,
  (
    array_agg(NULLIF(btrim(j.loxo_link), '') ORDER BY j.date_opened DESC NULLS LAST, j.imported_at DESC, j.job_id DESC)
    FILTER (WHERE NULLIF(btrim(j.loxo_link), '') IS NOT NULL)
  )[1] AS loxo_link,
  max(j.imported_at) AS updated_at,
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(
          (
            array_agg(
              btrim(j.company)
              ORDER BY (btrim(j.company) <> lower(btrim(j.company))) DESC, j.date_opened DESC NULLS LAST, j.imported_at DESC, j.job_id DESC
            )
          )[1],
          ''
        )
        || ' ' || coalesce(string_agg(DISTINCT NULLIF(btrim(j.job_title), ''), ' '), '')
      ),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(string_agg(DISTINCT NULLIF(btrim(j.client_contact), ''), ' '), '')
        || ' ' || coalesce(string_agg(DISTINCT NULLIF(btrim(j.location), ''), ' '), '')
        || ' ' || coalesce(string_agg(DISTINCT NULLIF(btrim(j.owners), ''), ' '), '')
      ),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(string_agg(NULLIF(btrim(j.job_description), ''), ' '), '')
      ),
      'C'
    )
  ) AS search_vector
FROM public.tracker_jobs j
WHERE NULLIF(btrim(j.company), '') IS NOT NULL
GROUP BY lower(btrim(j.company));

CREATE VIEW public.search_documents WITH (security_invoker = true) AS
SELECT
  'candidate:' || c.id AS id,
  'candidate'::text AS entity_type,
  c.id AS entity_id,
  c.candidate_name AS title,
  COALESCE(NULLIF(btrim(c.current_title), ''), NULLIF(btrim(c.role_context), '')) AS subtitle,
  COALESCE(NULLIF(btrim(c.current_company), ''), NULLIF(btrim(c.client_context), '')) AS company,
  NULLIF(btrim(c.location), '') AS location,
  c.candidate_source AS status,
  NULL::text AS subject_type,
  NULL::text AS subject_id,
  NULLIF(btrim(c.notes), '') AS snippet,
  COALESCE(c.edited_at, c.source_updated_at) AS updated_at,
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(c.candidate_name, '') || ' ' || coalesce(c.current_title, '') || ' ' || coalesce(c.role_context, '')
      ),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(c.current_company, '') || ' ' || coalesce(c.location, '') || ' ' || coalesce(c.industry, '') || ' ' || coalesce(c.client_context, '')
      ),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(c.notes, '') || ' ' || coalesce(c.shift, '') || ' ' || coalesce(c.compensation_target, '') || ' ' || coalesce(c.current_compensation, '') || ' ' || coalesce(c.compensation_context, '')
      ),
      'C'
    )
  ) AS search_vector
FROM public.candidates_all c

UNION ALL

SELECT
  'lead:' || l.id::text AS id,
  'lead'::text AS entity_type,
  l.id::text AS entity_id,
  l.company AS title,
  NULLIF(btrim(l.role), '') AS subtitle,
  l.company AS company,
  NULL::text AS location,
  NULLIF(btrim(l.status), '') AS status,
  NULL::text AS subject_type,
  NULL::text AS subject_id,
  COALESCE(NULLIF(btrim(l.notes), ''), NULLIF(btrim(l.next_action), ''), NULLIF(btrim(l.contact), '')) AS snippet,
  l.updated_at AS updated_at,
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(l.company, '') || ' ' || coalesce(l.role, '') || ' ' || coalesce(l.contact, '')
      ),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(l.status, '') || ' ' || coalesce(l.next_action, '')),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(l.notes, '')),
      'C'
    )
  ) AS search_vector
FROM public.leads l

UNION ALL

SELECT
  'job:' || j.job_id::text AS id,
  'job'::text AS entity_type,
  j.job_id::text AS entity_id,
  j.job_title AS title,
  NULLIF(btrim(j.company), '') AS subtitle,
  NULLIF(btrim(j.company), '') AS company,
  NULLIF(btrim(j.location), '') AS location,
  NULLIF(btrim(j.status), '') AS status,
  NULL::text AS subject_type,
  NULL::text AS subject_id,
  NULLIF(btrim(j.job_description), '') AS snippet,
  j.imported_at AS updated_at,
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(j.job_title, '') || ' ' || coalesce(j.company, '')),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(j.client_contact, '') || ' ' || coalesce(j.location, '') || ' ' || coalesce(j.status, '') || ' ' || coalesce(j.owners, '')
      ),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(j.job_description, '') || ' ' || coalesce(j.compensation, '')),
      'C'
    )
  ) AS search_vector
FROM public.tracker_jobs j

UNION ALL

SELECT
  cc.id AS id,
  'client'::text AS entity_type,
  cc.company AS entity_id,
  cc.company AS title,
  cc.job_titles AS subtitle,
  cc.company AS company,
  cc.location AS location,
  CASE WHEN cc.open_jobs_count > 0 THEN 'Active'::text ELSE NULL::text END AS status,
  NULL::text AS subject_type,
  NULL::text AS subject_id,
  cc.client_contact AS snippet,
  cc.updated_at AS updated_at,
  cc.search_vector AS search_vector
FROM public.client_companies cc

UNION ALL

SELECT
  'note:' || n.id::text AS id,
  'note'::text AS entity_type,
  n.id::text AS entity_id,
  NULLIF(btrim(n.title), '') AS title,
  n.subject_type AS subtitle,
  NULL::text AS company,
  NULL::text AS location,
  NULL::text AS status,
  n.subject_type AS subject_type,
  n.subject_id AS subject_id,
  NULLIF(public.note_body_plain_text(n.body), '') AS snippet,
  n.updated_at AS updated_at,
  (
    pg_catalog.setweight(pg_catalog.to_tsvector('english'::regconfig, coalesce(n.title, '')), 'A')
    || pg_catalog.setweight(pg_catalog.to_tsvector('english'::regconfig, public.note_body_plain_text(n.body)), 'B')
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(n.subject_type, '') || ' ' || coalesce(n.subject_id, '')),
      'C'
    )
  ) AS search_vector
FROM public.notes n;

CREATE OR REPLACE FUNCTION public.search_workbench(
  query_text text,
  max_per_group integer DEFAULT 20
)
RETURNS TABLE (
  id text,
  entity_type text,
  entity_id text,
  title text,
  subtitle text,
  company text,
  location text,
  status text,
  subject_type text,
  subject_id text,
  snippet text,
  updated_at timestamptz,
  rank real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH parsed AS (
    SELECT
      public.workbench_search_tsquery(query_text) AS q,
      LEAST(GREATEST(COALESCE(max_per_group, 20), 1), 100) AS lim
  ),
  matched AS (
    SELECT
      d.id,
      d.entity_type,
      d.entity_id,
      d.title,
      d.subtitle,
      d.company,
      d.location,
      d.status,
      d.subject_type,
      d.subject_id,
      d.snippet,
      d.updated_at,
      pg_catalog.ts_rank_cd(d.search_vector, p.q) AS rank,
      pg_catalog.row_number() OVER (
        PARTITION BY d.entity_type
        ORDER BY pg_catalog.ts_rank_cd(d.search_vector, p.q) DESC, d.updated_at DESC NULLS LAST, d.id ASC
      ) AS group_row
    FROM parsed p
    JOIN public.search_documents d
      ON p.q IS NOT NULL
     AND d.search_vector @@ p.q
    WHERE COALESCE(max_per_group, 20) > 0
  )
  SELECT
    m.id,
    m.entity_type,
    m.entity_id,
    m.title,
    m.subtitle,
    m.company,
    m.location,
    m.status,
    m.subject_type,
    m.subject_id,
    m.snippet,
    m.updated_at,
    m.rank
  FROM matched m
  CROSS JOIN parsed p
  WHERE m.group_row <= p.lim
  ORDER BY m.rank DESC, m.updated_at DESC NULLS LAST, m.id ASC;
$$;

REVOKE ALL ON TABLE public.client_companies, public.search_documents FROM anon;
GRANT SELECT ON TABLE public.client_companies, public.search_documents TO authenticated;
REVOKE ALL ON FUNCTION public.note_body_plain_text(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.note_body_plain_text(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.workbench_search_tsquery(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.workbench_search_tsquery(text) TO authenticated;
REVOKE ALL ON FUNCTION public.search_workbench(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_workbench(text, integer) TO authenticated;
`;

const testRecruitmentContext = async () => ({
  authority: { id: "recruiter", routerPath: "recruiter/SKILL.md", policies: ["_JA-RULES.md", "_TOOL-MAP.md"], capabilities: [] },
  pkg: {
    readSkillText: async () => "# Recruiter\nThe sole recruiting front door.",
    assertSkillFile: async () => {},
  },
});

async function request(app, method, path, { body, headers = {} } = {}) {
  const server = await new Promise((resolve) => {
    const value = app.listen(0, () => resolve(value));
  });
  try {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          port: server.address().port,
          path,
          method,
          headers: {
            ...headers,
            ...(payload
              ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }
              : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data ? JSON.parse(data) : null,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function createPgliteSearchHarness({ applySearchMigration = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION public.is_authorized_recruiter() RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT COALESCE(current_setting('request.jwt.claim.recruiter', true), 'true') = 'true' $$;

    CREATE TABLE public.tracker_candidates (
      id bigint PRIMARY KEY,
      tracker_row integer UNIQUE NOT NULL,
      candidate_name text NOT NULL,
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
      imported_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.tracker_sourcing (
      id bigint PRIMARY KEY,
      tracker_row integer UNIQUE NOT NULL,
      candidate_name text,
      current_title text,
      current_company text,
      personal_email text,
      business_email text,
      email text,
      mobile_number text,
      phone text,
      work_number text,
      other_phone text,
      source_notes text,
      profile_url text,
      role text,
      candidate_key text,
      imported_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.tracker_submissions (
      id bigint PRIMARY KEY,
      tracker_row integer UNIQUE NOT NULL,
      candidate_name text NOT NULL,
      current_title text,
      current_company text,
      location text,
      industry text,
      target_current_compensation text,
      additional_notes text,
      role_submitted_for text,
      client_submitted_to text,
      candidate_key text,
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
      imported_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE public.tracker_candidates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_sourcing ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_submissions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_jobs ENABLE ROW LEVEL SECURITY;

    CREATE POLICY tracker_candidates_read ON public.tracker_candidates
      FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY tracker_sourcing_read ON public.tracker_sourcing
      FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY tracker_submissions_read ON public.tracker_submissions
      FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY tracker_jobs_read ON public.tracker_jobs
      FOR SELECT TO authenticated USING (public.is_authorized_recruiter());

    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT SELECT ON public.tracker_candidates, public.tracker_sourcing, public.tracker_submissions, public.tracker_jobs TO authenticated;
  `);

  const migration004 = await readFile(new URL("../migrations/004_leads.sql", import.meta.url), "utf8");
  const migration010 = await readFile(new URL("../migrations/010_candidates_all.sql", import.meta.url), "utf8");
  await db.exec(migration004);
  await db.exec(PREREQ_MIGRATIONS_SQL);
  await db.exec(migration010);
  if (applySearchMigration) {
    await db.exec(MIGRATION_021_FULLTEXT_SEARCH_SQL);
  }

  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)", [
    FIRST_OWNER,
    "review@example.invalid",
    SECOND_OWNER,
    "peer@example.invalid",
    UNAUTHORIZED_OWNER,
    "denied@example.invalid",
  ]);

  const tokens = new Map([
    ["supabase-token-owner-1", { id: FIRST_OWNER, email: "review@example.invalid", authorized: true }],
    ["supabase-token-owner-2", { id: SECOND_OWNER, email: "peer@example.invalid", authorized: true }],
    ["supabase-token-rls-denied", { id: UNAUTHORIZED_OWNER, email: "review@example.invalid", authorized: false }],
    ["better-auth-non-uuid-token", { id: "better-auth-opaque-user-id", email: "review@example.invalid", authorized: true }],
    ["supabase-token-unapproved-email", { id: FIRST_OWNER, email: "outsider@example.invalid", authorized: true }],
  ]);

  const recordedRequests = [];

  async function withRlsSession(user, callback) {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user.id]);
    await db.query("SELECT set_config('request.jwt.claim.recruiter', $1, false)", [user.authorized ? "true" : "false"]);
    await db.exec("SET ROLE authenticated");
    try {
      return await callback();
    } finally {
      await db.exec("RESET ROLE");
    }
  }

  async function fetchImpl(urlString, options = {}) {
    const url = new URL(urlString);
    const method = (options.method || "GET").toUpperCase();
    const headers = options.headers || {};
    const authHeader = headers.Authorization || headers.authorization || "";
    const apiKey = headers.apikey || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");

    recordedRequests.push({
      method,
      pathname: url.pathname,
      search: url.search,
      apiKey,
      token,
      body: options.body ? JSON.parse(options.body) : null,
    });

    assert.equal(apiKey, PUBLISHABLE_KEY, "Gateway must send publishable key as apikey");
    assert.doesNotMatch(apiKey, /secret|service_role/i);
    assert.doesNotMatch(token, /secret|service_role/i);

    const user = tokens.get(token);
    if (url.pathname === "/auth/v1/user") {
      if (!user) return jsonResponse(401, { message: "Invalid token" });
      return jsonResponse(200, { id: user.id, email: user.email, role: "authenticated" });
    }
    if (!user) return jsonResponse(401, { message: "Invalid token" });

    try {
      return await withRlsSession(user, async () => {
        if (url.pathname === "/rest/v1/rpc/search_workbench" && method === "POST") {
          const payload = JSON.parse(options.body || "{}");
          const result = await db.query(
            "SELECT * FROM public.search_workbench($1::text, $2::integer)",
            [payload.query_text ?? null, payload.max_per_group ?? 20],
          );
          return jsonResponse(200, result.rows);
        }

        throw new Error(`Unexpected PostgREST request: ${method} ${url.pathname}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database error";
      if (/row-level security|permission denied/i.test(message)) {
        return jsonResponse(403, { code: "42501", message });
      }
      if (/search_workbench.*does not exist|relation .* does not exist/i.test(message)) {
        return jsonResponse(404, {
          code: "42883",
          message,
          hint: "Perhaps you meant to apply 021_fulltext_search.sql",
        });
      }
      return jsonResponse(400, { code: "22P02", message });
    }
  }

  return { db, fetchImpl, recordedRequests };
}

test("GET /api/search returns grouped and typed results over public.search_workbench under end-user RLS and preserves source IDs and nulls", async () => {
  const harness = await createPgliteSearchHarness();
  try {
    const app = await createApp({
      env: {
        APP_TRUSTED_ORIGINS: "https://console.test",
        AUTH_ALLOWED_GOOGLE_EMAILS: "review@example.invalid,peer@example.invalid",
      },
      recruitmentContextLoader: testRecruitmentContext,
      searchFetch: harness.fetchImpl,
    });

    const owner1Headers = { authorization: "Bearer supabase-token-owner-1" };
    const owner2Headers = { authorization: "Bearer supabase-token-owner-2" };
    const rlsDeniedHeaders = { authorization: "Bearer supabase-token-rls-denied" };

    // 1. Honest empty state when database has no matching records
    const emptyRes = await request(app, "GET", "/api/search?q=program+manager", {
      headers: owner1Headers,
    });
    assert.equal(emptyRes.status, 200);
    assert.equal(emptyRes.headers["cache-control"], "private, no-store");
    const parsedEmpty = SearchResponseSchema.parse(emptyRes.body);
    assert.equal(parsedEmpty.query, "program manager");
    assert.equal(parsedEmpty.limit, 20);
    assert.deepEqual(parsedEmpty.results, []);
    assert.deepEqual(parsedEmpty.groups, {
      candidates: [],
      leads: [],
      jobs: [],
      clients: [],
      notes: [],
    });

    // 2. Seed synthetic records across all 5 sources, including overlay edits and unknown (null) fields
    await harness.db.query(`
      INSERT INTO public.tracker_candidates (id, tracker_row, candidate_name, current_title, current_company, location, notes)
      VALUES
        (10, 10, 'Synthetic Candidate Alpha', 'Operations Coordinator', 'Northwind Parts', 'Guelph, ON', 'Automotive launches'),
        (11, 11, 'Synthetic Candidate Beta', 'Program Manager', 'Contoso Metals', 'Kitchener, ON', 'Program management track')
    `);
    await harness.db.query(
      `INSERT INTO public.candidate_edits (owner_id, tracker_source, tracker_row, edits)
       VALUES
         ($1, 'tracker_candidates', 10, '{"current_title":"Senior Program Manager"}'::jsonb),
         ($1, 'tracker_candidates', 11, '{"current_title":"Plant Controller","notes":null}'::jsonb)`,
      [FIRST_OWNER],
    );
    // Sourced candidate with NULL candidate_name, NULL current_company, and NULL source_notes to test unknown preservation
    await harness.db.query(`
      INSERT INTO public.tracker_sourcing (id, tracker_row, candidate_name, current_title, current_company, role, source_notes)
      VALUES (20, 20, NULL, NULL, NULL, 'Program Manager', NULL)
    `);
    await harness.db.query(`
      INSERT INTO public.tracker_submissions (id, tracker_row, candidate_name, current_title, current_company, location, role_submitted_for, client_submitted_to, additional_notes)
      VALUES (30, 30, 'Synthetic Submitted Epsilon', 'Engineering Lead', 'Adventure Works', 'Hamilton, ON', 'Program Manager', 'Apex Tooling', 'Presented for launch role')
    `);
    await harness.db.query(
      `INSERT INTO public.candidates_manual (id, owner_id, candidate_name, current_title, current_company, location, notes)
       VALUES
         ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'Synthetic Manual Delta', 'Technical Program Manager', 'Boreal Systems', 'Waterloo, ON', 'Added in Workbench'),
         ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $2, 'Second Owner Manual', 'Program Manager', 'Private Corp', 'Toronto, ON', 'Owned by second recruiter')`,
      [FIRST_OWNER, SECOND_OWNER],
    );
    await harness.db.query(
      `INSERT INTO public.leads (id, owner_id, company, contact, role, status, next_action, notes)
       VALUES
         ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', $1, 'Huron Mobility', 'Alex Morgan', 'Program Manager', 'Warm', 'Send terms', 'Need program manager for EV line'),
         ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', $2, 'Second Owner Lead Co', 'Jamie Taylor', 'Program Manager', 'New', 'Call', 'Private lead')`,
      [FIRST_OWNER, SECOND_OWNER],
    );
    await harness.db.query(`
      INSERT INTO public.tracker_jobs (job_id, tracker_row, job_title, company, client_contact, location, status, date_opened, job_description)
      VALUES
        (501, 1, 'Program Manager', 'Apex Tooling', 'Jordan Lee', 'Guelph, ON', 'Active', '2026-11-01', NULL),
        (502, 2, 'Quality Manager', ' apex tooling ', 'Jordan Lee', 'Cambridge, ON', 'Active', '2026-11-05', 'APQP and PPAP oversight.')
    `);
    await harness.db.query(
      `INSERT INTO public.notes (id, owner_id, title, subject_type, subject_id, body)
       VALUES
         (
           'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
           $1,
           '',
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
         )`,
      [FIRST_OWNER, SECOND_OWNER],
    );

    // 3. Search as Owner 1
    const searchRes = await request(app, "GET", "/api/search?q=%20program%20manager%20", {
      headers: owner1Headers,
    });
    assert.equal(searchRes.status, 200);
    const body = SearchResponseSchema.parse(searchRes.body);
    assert.equal(body.query, "program manager");
    assert.equal(body.limit, 20);

    // Verify all 5 groups are populated and preserve exact source IDs
    assert.deepEqual(
      body.candidates.map((item) => item.entity_id).sort(),
      [
        "manual:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "sourcing:20",
        "submission:30",
        "tracker_candidates:10",
      ],
    );
    // Candidate 11 had Program Manager overwritten to Plant Controller by Owner 1; Owner 2's manual candidate is isolated by RLS
    assert.ok(!body.candidates.some((item) => item.entity_id === "tracker_candidates:11"));
    assert.ok(!body.candidates.some((item) => item.entity_id === "manual:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));

    // Verify unknown (null) fields on sourcing:20 are preserved as null, never fabricated
    const sourcedCandidate = body.candidates.find((item) => item.entity_id === "sourcing:20");
    assert.ok(sourcedCandidate);
    assert.equal(sourcedCandidate.id, "candidate:sourcing:20");
    assert.equal(sourcedCandidate.title, null);
    assert.equal(sourcedCandidate.subtitle, "Program Manager");
    assert.equal(sourcedCandidate.company, null);
    assert.equal(sourcedCandidate.location, null);
    assert.equal(sourcedCandidate.status, "sourcing");
    assert.equal(sourcedCandidate.snippet, null);

    // Verify leads, jobs, clients, and notes groups
    assert.deepEqual(
      body.leads.map((item) => item.entity_id),
      ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    );
    assert.deepEqual(
      body.jobs.map((item) => item.entity_id),
      ["501"],
    );
    assert.equal(body.jobs[0].snippet, null);
    assert.deepEqual(
      body.clients.map((item) => ({ id: item.id, entity_id: item.entity_id })),
      [{ id: "client:apex tooling", entity_id: "Apex Tooling" }],
    );
    assert.deepEqual(
      body.notes.map((item) => ({
        id: item.id,
        entity_id: item.entity_id,
        title: item.title,
        subject_type: item.subject_type,
        subject_id: item.subject_id,
        snippet: item.snippet,
      })),
      [
        {
          id: "note:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          entity_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          title: null,
          subject_type: "candidate",
          subject_id: "tracker_candidates:10",
          snippet: "Program manager candidate ready for client presentation.",
        },
      ],
    );

    // Verify RPC call forwarded caller's end-user bearer token and publishable key
    const rpcCall = harness.recordedRequests.find((req) => req.pathname === "/rest/v1/rpc/search_workbench" && req.body?.query_text === "program manager");
    assert.ok(rpcCall);
    assert.equal(rpcCall.token, "supabase-token-owner-1");
    assert.equal(rpcCall.apiKey, PUBLISHABLE_KEY);
    assert.deepEqual(rpcCall.body, { query_text: "program manager", max_per_group: 20 });

    // 4. Verify max_per_group / limit caps per-entity results
    const cappedRes = await request(app, "GET", "/api/search?q=program+manager&limit=2", {
      headers: owner1Headers,
    });
    assert.equal(cappedRes.status, 200);
    const cappedBody = SearchResponseSchema.parse(cappedRes.body);
    assert.equal(cappedBody.limit, 2);
    assert.equal(cappedBody.candidates.length, 2);
    assert.equal(cappedBody.groups.candidates.length, 2);

    const maxPerGroupRes = await request(app, "GET", "/api/search?q=program+manager&max_per_group=1", {
      headers: owner1Headers,
    });
    assert.equal(maxPerGroupRes.status, 200);
    const maxPerGroupBody = SearchResponseSchema.parse(maxPerGroupRes.body);
    assert.equal(maxPerGroupBody.limit, 1);
    assert.equal(maxPerGroupBody.candidates.length, 1);

    // 5. Search as Owner 2: sees unedited tracker_candidates:11 + own manual candidate, lead, and note
    const owner2Res = await request(app, "GET", "/api/search?q=program+manager", {
      headers: owner2Headers,
    });
    assert.equal(owner2Res.status, 200);
    const owner2Body = SearchResponseSchema.parse(owner2Res.body);
    assert.deepEqual(
      owner2Body.candidates.map((item) => item.entity_id).sort(),
      [
        "manual:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "sourcing:20",
        "submission:30",
        "tracker_candidates:11",
      ],
    );
    assert.deepEqual(
      owner2Body.leads.map((item) => item.entity_id),
      ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
    );
    assert.deepEqual(
      owner2Body.notes.map((item) => item.entity_id),
      ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
    );

    // 6. Search as RLS-denied user returns empty results across all 5 sources
    const deniedRes = await request(app, "GET", "/api/search?q=program+manager", {
      headers: rlsDeniedHeaders,
    });
    assert.equal(deniedRes.status, 200);
    const deniedBody = SearchResponseSchema.parse(deniedRes.body);
    assert.deepEqual(deniedBody.results, []);
  } finally {
    await harness.db.close();
  }
});

test("GET /api/search validates query length and limits and fails clearly on auth, service-role, and missing migration errors", async () => {
  const harness = await createPgliteSearchHarness();
  try {
    const app = await createApp({
      env: {
        APP_TRUSTED_ORIGINS: "https://console.test",
        AUTH_ALLOWED_GOOGLE_EMAILS: "review@example.invalid",
      },
      recruitmentContextLoader: testRecruitmentContext,
      searchFetch: harness.fetchImpl,
    });

    const validHeaders = { authorization: "Bearer supabase-token-owner-1" };

    // Missing token -> 401
    const missingAuth = await request(app, "GET", "/api/search?q=program+manager");
    assert.equal(missingAuth.status, 401);
    assert.equal(missingAuth.body.error.code, "UNAUTHORIZED");

    // Invalid token -> 401
    const invalidAuth = await request(app, "GET", "/api/search?q=program+manager", {
      headers: { authorization: "Bearer unknown-token" },
    });
    assert.equal(invalidAuth.status, 401);
    assert.equal(invalidAuth.body.error.code, "UNAUTHORIZED");

    // Better Auth non-UUID opaque user ID -> 401 (never used for search)
    const betterAuthRes = await request(app, "GET", "/api/search?q=program+manager", {
      headers: { authorization: "Bearer better-auth-non-uuid-token" },
    });
    assert.equal(betterAuthRes.status, 401);
    assert.equal(betterAuthRes.body.error.code, "UNAUTHORIZED");

    // Unapproved email -> 403
    const unapprovedRes = await request(app, "GET", "/api/search?q=program+manager", {
      headers: { authorization: "Bearer supabase-token-unapproved-email" },
    });
    assert.equal(unapprovedRes.status, 403);
    assert.equal(unapprovedRes.body.error.code, "FORBIDDEN");

    // Service-role bearer token -> 403
    const serviceRoleToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.sig`;
    const serviceTokenRes = await request(app, "GET", "/api/search?q=program+manager", {
      headers: { authorization: `Bearer ${serviceRoleToken}` },
    });
    assert.equal(serviceTokenRes.status, 403);
    assert.equal(serviceTokenRes.body.error.code, "FORBIDDEN");

    // Query length and limit validation -> 400 INVALID_INPUT
    for (const invalidQuery of [
      "/api/search",
      "/api/search?q=",
      "/api/search?q=%20%20%20",
      `/api/search?q=${"x".repeat(201)}`,
      "/api/search?q=program&limit=0",
      "/api/search?q=program&limit=101",
      "/api/search?q=program&limit=abc",
      "/api/search?q=program&max_per_group=0",
      "/api/search?q=program&max_per_group=101",
      "/api/search?q=program&limit=5&max_per_group=10",
      "/api/search?q=program&unexpected=1",
    ]) {
      const res = await request(app, "GET", invalidQuery, { headers: validHeaders });
      assert.equal(res.status, 400, `Expected 400 for ${invalidQuery}, got ${res.status}`);
      assert.equal(res.body.error.code, "INVALID_INPUT");
    }

    // Service-role key configured in environment fails closed with 503 SUPABASE_UNAVAILABLE
    const misconfiguredApp = await createApp({
      env: {
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: `sb_${"secret"}_forbidden_server_credential`,
      },
      recruitmentContextLoader: testRecruitmentContext,
      searchFetch: harness.fetchImpl,
    });
    const misconfiguredRes = await request(misconfiguredApp, "GET", "/api/search?q=program+manager", {
      headers: validHeaders,
    });
    assert.equal(misconfiguredRes.status, 503);
    assert.equal(misconfiguredRes.body.error.code, "SUPABASE_UNAVAILABLE");
  } finally {
    await harness.db.close();
  }

  // Missing migration 021_fulltext_search.sql -> 503 SEARCH_MIGRATION_REQUIRED
  const unmigratedHarness = await createPgliteSearchHarness({ applySearchMigration: false });
  try {
    const unmigratedApp = await createApp({
      env: {
        APP_TRUSTED_ORIGINS: "https://console.test",
        AUTH_ALLOWED_GOOGLE_EMAILS: "review@example.invalid",
      },
      recruitmentContextLoader: testRecruitmentContext,
      searchFetch: unmigratedHarness.fetchImpl,
    });
    const missingMigrationRes = await request(unmigratedApp, "GET", "/api/search?q=program+manager", {
      headers: { authorization: "Bearer supabase-token-owner-1" },
    });
    assert.equal(missingMigrationRes.status, 503);
    assert.equal(missingMigrationRes.body.error.code, "SEARCH_MIGRATION_REQUIRED");
    assert.match(missingMigrationRes.body.error.message, /021_fulltext_search\.sql|search_workbench/i);
  } finally {
    await unmigratedHarness.db.close();
  }
});
