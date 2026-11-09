-- PostgreSQL full-text search across candidates_all, leads, tracker_jobs,
-- distinct client companies, and notes. Deterministic lexical search only (no AI).
-- Prerequisite migrations:
--   004_leads.sql
--   008_candidate_edits.sql
--   009_candidates_manual.sql
--   010_candidates_all.sql
--   020_notes_boards.sql

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

COMMENT ON FUNCTION public.note_body_plain_text(jsonb) IS
  'Extracts human-authored text leaves from note JSONB bodies while ignoring editor node metadata keys.';

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

COMMENT ON FUNCTION public.workbench_search_tsquery(text) IS
  'Parses recruiter search input into an English websearch tsquery; returns NULL when blank or non-searchable.';

CREATE INDEX IF NOT EXISTS tracker_candidates_fts_idx ON public.tracker_candidates USING gin (
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(candidate_name, '') || ' ' || coalesce(current_title, '')),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(current_company, '') || ' ' || coalesce(location, '') || ' ' || coalesce(industry, '')
      ),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(notes, '') || ' ' || coalesce(shift, '') || ' ' || coalesce(compensation_target, '') || ' ' || coalesce(current_compensation, '')
      ),
      'C'
    )
  )
);

CREATE INDEX IF NOT EXISTS tracker_sourcing_fts_idx ON public.tracker_sourcing USING gin (
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(candidate_name, '') || ' ' || coalesce(current_title, '') || ' ' || coalesce(role, '')
      ),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(current_company, '')),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(source_notes, '')),
      'C'
    )
  )
);

CREATE INDEX IF NOT EXISTS tracker_submissions_fts_idx ON public.tracker_submissions USING gin (
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(candidate_name, '') || ' ' || coalesce(current_title, '') || ' ' || coalesce(role_submitted_for, '')
      ),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(current_company, '') || ' ' || coalesce(location, '') || ' ' || coalesce(industry, '') || ' ' || coalesce(client_submitted_to, '')
      ),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(additional_notes, '') || ' ' || coalesce(target_current_compensation, '')
      ),
      'C'
    )
  )
);

CREATE INDEX IF NOT EXISTS candidates_manual_fts_idx ON public.candidates_manual USING gin (
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(candidate_name, '') || ' ' || coalesce(current_title, '')),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(current_company, '') || ' ' || coalesce(location, '') || ' ' || coalesce(industry, '')
      ),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(notes, '') || ' ' || coalesce(shift, '') || ' ' || coalesce(compensation_target, '') || ' ' || coalesce(current_compensation, '')
      ),
      'C'
    )
  )
);

CREATE INDEX IF NOT EXISTS leads_fts_idx ON public.leads USING gin (
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(company, '') || ' ' || coalesce(role, '') || ' ' || coalesce(contact, '')),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(status, '') || ' ' || coalesce(next_action, '')),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(notes, '')),
      'C'
    )
  )
);

CREATE INDEX IF NOT EXISTS tracker_jobs_fts_idx ON public.tracker_jobs USING gin (
  (
    pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(job_title, '') || ' ' || coalesce(company, '')),
      'A'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector(
        'english'::regconfig,
        coalesce(client_contact, '') || ' ' || coalesce(location, '') || ' ' || coalesce(status, '') || ' ' || coalesce(owners, '')
      ),
      'B'
    )
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(job_description, '') || ' ' || coalesce(compensation, '')),
      'C'
    )
  )
);

CREATE INDEX IF NOT EXISTS notes_fts_idx ON public.notes USING gin (
  (
    pg_catalog.setweight(pg_catalog.to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
    || pg_catalog.setweight(pg_catalog.to_tsvector('english'::regconfig, public.note_body_plain_text(body)), 'B')
    || pg_catalog.setweight(
      pg_catalog.to_tsvector('english'::regconfig, coalesce(subject_type, '') || ' ' || coalesce(subject_id, '')),
      'C'
    )
  )
);

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

COMMENT ON VIEW public.client_companies IS
  'Distinct client companies aggregated from Tracker jobs with security-invoker RLS and full-text search vectors.';

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

COMMENT ON VIEW public.search_documents IS
  'Unified security-invoker full-text search documents across candidates_all, leads, tracker_jobs, client_companies, and notes.';

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

COMMENT ON FUNCTION public.search_workbench(text, integer) IS
  'Executes ranked PostgreSQL full-text search across candidates_all, leads, tracker_jobs, client_companies, and notes under caller RLS.';

REVOKE ALL ON TABLE public.client_companies, public.search_documents FROM anon;
GRANT SELECT ON TABLE public.client_companies, public.search_documents TO authenticated;

REVOKE ALL ON FUNCTION public.note_body_plain_text(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.note_body_plain_text(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.workbench_search_tsquery(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workbench_search_tsquery(text) TO authenticated;

REVOKE ALL ON FUNCTION public.search_workbench(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_workbench(text, integer) TO authenticated;
