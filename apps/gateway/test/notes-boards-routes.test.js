import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  BoardDeleteResponseSchema,
  BoardListResponseSchema,
  BoardResponseSchema,
  MAX_BOARD_SCENE_BYTES,
  MAX_NOTE_BODY_BYTES,
  NoteDeleteResponseSchema,
  NoteListResponseSchema,
  NoteResponseSchema,
} from "@ja/shared-types";
import { createApp } from "../app.js";

const SUPABASE_URL = "https://abnfffkmxqixrwzackjf.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0";
const FIRST_OWNER = "11111111-1111-4111-8111-111111111111";
const SECOND_OWNER = "22222222-2222-4222-8222-222222222222";
const UNAUTHORIZED_OWNER = "33333333-3333-4333-8333-333333333333";

const FIRST_MANUAL_CANDIDATE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_MANUAL_CANDIDATE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIRST_MEETING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECOND_MEETING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const MIGRATION_008_SQL = `
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_edits TO authenticated;
CREATE POLICY candidate_edits_select_own ON public.candidate_edits
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
`;

const MIGRATION_009_SQL = `
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidates_manual TO authenticated;
CREATE POLICY candidates_manual_select_own ON public.candidates_manual
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
`;

const MIGRATION_020_SQL = `
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

CREATE INDEX notes_owner_updated_idx ON public.notes (owner_id, updated_at DESC);
CREATE INDEX notes_owner_subject_idx ON public.notes (owner_id, subject_type, subject_id);

CREATE TABLE public.boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  subject_type text,
  subject_id text,
  scene jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scene) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boards_subject_pair CHECK (
    (subject_type IS NULL AND subject_id IS NULL)
    OR (subject_type IS NOT NULL AND subject_type IN ('candidate', 'job', 'meeting')
      AND subject_id IS NOT NULL AND length(btrim(subject_id)) > 0)
  )
);

CREATE INDEX boards_owner_updated_idx ON public.boards (owner_id, updated_at DESC);
CREATE INDEX boards_owner_subject_idx ON public.boards (owner_id, subject_type, subject_id);

CREATE FUNCTION public.touch_workbench_content_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = GREATEST(clock_timestamp(), OLD.updated_at + interval '1 millisecond');
  RETURN NEW;
END;
$$;

CREATE TRIGGER notes_touch_updated_at
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_workbench_content_updated_at();

CREATE TRIGGER boards_touch_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.touch_workbench_content_updated_at();

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notes, public.boards FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notes, public.boards TO authenticated;

CREATE POLICY notes_select_own ON public.notes FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY notes_insert_own ON public.notes FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY notes_update_own ON public.notes FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY notes_delete_own ON public.notes FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY boards_select_own ON public.boards FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY boards_insert_own ON public.boards FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY boards_update_own ON public.boards FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
CREATE POLICY boards_delete_own ON public.boards FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());
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

async function createPgliteNotesBoardsHarness() {
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
    CREATE TABLE public.tracker_jobs (
      job_id bigint PRIMARY KEY,
      tracker_row integer NOT NULL,
      job_title text NOT NULL,
      company text,
      location text,
      status text,
      imported_at timestamptz NOT NULL DEFAULT now()
    );
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
    ALTER TABLE public.tracker_jobs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_candidates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_sourcing ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_submissions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tracker_jobs_read ON public.tracker_jobs FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY tracker_candidates_read ON public.tracker_candidates FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY tracker_sourcing_read ON public.tracker_sourcing FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY tracker_submissions_read ON public.tracker_submissions FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT SELECT ON public.tracker_jobs, public.tracker_candidates, public.tracker_sourcing, public.tracker_submissions TO authenticated;
  `);

  const migration005 = await readFile(new URL("../migrations/005_meeting_drafts.sql", import.meta.url), "utf8");
  await db.exec(migration005);
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_drafts TO authenticated;");
  await db.exec(MIGRATION_008_SQL);
  await db.exec(MIGRATION_009_SQL);
  const migration010 = await readFile(new URL("../migrations/010_candidates_all.sql", import.meta.url), "utf8");
  await db.exec(migration010);
  await db.exec(MIGRATION_020_SQL);
  const migration022 = await readFile(new URL("../migrations/022_notes_origin_key.sql", import.meta.url), "utf8");
  await db.exec(migration022);

  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)", [
    FIRST_OWNER,
    "review@example.invalid",
    SECOND_OWNER,
    "peer@example.invalid",
    UNAUTHORIZED_OWNER,
    "denied@example.invalid",
  ]);

  await db.query(
    `INSERT INTO public.tracker_jobs (job_id, tracker_row, job_title, company, location, status)
     VALUES (501, 1, 'Program Manager', 'Apex Tooling', 'Guelph, ON', 'Active')`,
  );
  await db.query(
    `INSERT INTO public.tracker_sourcing (id, tracker_row, candidate_name, current_title, current_company, role)
     VALUES (2, 11, 'Sourced Person', 'Maintenance Lead', 'FabWorks', 'Maintenance Manager')`,
  );
  await db.query(
    `INSERT INTO public.candidates_manual (id, owner_id, candidate_name, current_title, location)
     VALUES
       ($1, $2, 'First Owner Manual', 'Plant Manager', 'Toronto, ON'),
       ($3, $4, 'Second Owner Manual', 'Quality Director', 'Hamilton, ON')`,
    [FIRST_MANUAL_CANDIDATE_ID, FIRST_OWNER, SECOND_MANUAL_CANDIDATE_ID, SECOND_OWNER],
  );
  await db.query(
    `INSERT INTO public.meeting_drafts (id, owner_id, job_id, candidate_source, candidate_source_id, event_title, transcript, notes)
     VALUES
       ($1, $2, 501, 'sourcing', 2, 'First Owner Screen', 'Speaker: Hello', 'Initial call note'),
       ($3, $4, 501, 'sourcing', 2, 'Second Owner Screen', 'Speaker: Private', 'Private call note')`,
    [FIRST_MEETING_ID, FIRST_OWNER, SECOND_MEETING_ID, SECOND_OWNER],
  );

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

  function buildContentListFilter(url, jsonColumn) {
    const conditions = [];
    const values = [];

    const idParam = url.searchParams.get("id");
    if (idParam?.startsWith("eq.")) {
      values.push(idParam.slice(3));
      conditions.push(`id = $${values.length}::uuid`);
    }
    const ownerParam = url.searchParams.get("owner_id");
    if (ownerParam?.startsWith("eq.")) {
      values.push(ownerParam.slice(3));
      conditions.push(`owner_id = $${values.length}::uuid`);
    }
    const subjectTypeParam = url.searchParams.get("subject_type");
    if (subjectTypeParam === "is.null") {
      conditions.push("subject_type IS NULL");
    } else if (subjectTypeParam === "not.is.null") {
      conditions.push("subject_type IS NOT NULL");
    } else if (subjectTypeParam?.startsWith("eq.")) {
      values.push(subjectTypeParam.slice(3));
      conditions.push(`subject_type = $${values.length}`);
    }
    const subjectIdParam = url.searchParams.get("subject_id");
    if (subjectIdParam === "is.null") {
      conditions.push("subject_id IS NULL");
    } else if (subjectIdParam?.startsWith("eq.")) {
      values.push(subjectIdParam.slice(3));
      conditions.push(`subject_id = $${values.length}`);
    }
    const titleParam = url.searchParams.get("title");
    if (titleParam?.startsWith("ilike.*") && titleParam.endsWith("*")) {
      values.push(`%${titleParam.slice(7, -1)}%`);
      conditions.push(`title ILIKE $${values.length}`);
    }
    const originKeyParam = url.searchParams.get("origin_key");
    if (originKeyParam?.startsWith("eq.")) {
      values.push(originKeyParam.slice(3));
      conditions.push(`origin_key = $${values.length}`);
    }
    const cursorMatch = url.searchParams.get("or")?.match(/^\(updated_at\.lt\.([^,]+),and\(updated_at\.eq\.([^,]+),created_at\.lt\.([^)]*)\),and\(updated_at\.eq\.([^,]+),created_at\.eq\.([^,]+),id\.gt\.([^)]+)\)\)$/);
    if (cursorMatch) {
      const [, afterUpdated, , afterCreated, , , afterId] = cursorMatch;
      values.push(afterUpdated, afterCreated, afterId);
      const updated = values.length - 2;
      const created = values.length - 1;
      const id = values.length;
      conditions.push(`(updated_at < $${updated}::timestamptz OR (updated_at = $${updated}::timestamptz AND created_at < $${created}::timestamptz) OR (updated_at = $${updated}::timestamptz AND created_at = $${created}::timestamptz AND id > $${id}::uuid))`);
    }
    const limit = Number(url.searchParams.get("limit") || 50);
    const offset = Number(url.searchParams.get("offset") || 0);
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return {
      whereSql,
      values,
      limit,
      offset,
      jsonColumn,
    };
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
    });

    assert.equal(apiKey, PUBLISHABLE_KEY, "Gateway must send publishable key as apikey");
    assert.doesNotMatch(apiKey, /secret|service_role/i);
    assert.doesNotMatch(token, /secret|service_role/i);
    assert.ok(
      !["/rest/v1/tracker_jobs", "/rest/v1/tracker_candidates", "/rest/v1/tracker_sourcing", "/rest/v1/tracker_submissions", "/rest/v1/loxo_candidates", "/rest/v1/loxo_jobs"].includes(url.pathname) || method === "GET",
      "Notes and boards routes must never write to Tracker or Loxo tables",
    );

    const user = tokens.get(token);
    if (url.pathname === "/auth/v1/user") {
      if (!user) return jsonResponse(401, { message: "Invalid token" });
      return jsonResponse(200, { id: user.id, email: user.email, role: "authenticated" });
    }
    if (!user) return jsonResponse(401, { message: "Invalid token" });

    try {
      return await withRlsSession(user, async () => {
        if (url.pathname === "/rest/v1/candidates_all" && method === "GET") {
          const idEq = url.searchParams.get("id")?.slice(3);
          const result = await db.query(
            "SELECT * FROM public.candidates_all WHERE id = $1 LIMIT 1",
            [idEq],
          );
          return jsonResponse(200, result.rows);
        }

        if (url.pathname === "/rest/v1/tracker_jobs" && method === "GET") {
          const jobIdEq = Number(url.searchParams.get("job_id")?.slice(3));
          const result = await db.query(
            "SELECT job_id FROM public.tracker_jobs WHERE job_id = $1 LIMIT 1",
            [jobIdEq],
          );
          return jsonResponse(200, result.rows);
        }

        if (url.pathname === "/rest/v1/meeting_drafts" && method === "GET") {
          const idEq = url.searchParams.get("id")?.slice(3);
          const ownerEq = url.searchParams.get("owner_id")?.slice(3);
          const result = await db.query(
            "SELECT id, owner_id, candidate_source, candidate_source_id FROM public.meeting_drafts WHERE id = $1::uuid AND owner_id = $2::uuid LIMIT 1",
            [idEq, ownerEq],
          );
          return jsonResponse(200, result.rows);
        }

        for (const [table, jsonCol] of [["notes", "body"], ["boards", "scene"]]) {
          if (url.pathname === `/rest/v1/${table}`) {
            if (method === "GET") {
              const { whereSql, values, limit, offset } = buildContentListFilter(url, jsonCol);
              const result = await db.query(
                `SELECT * FROM public.${table} ${whereSql} ORDER BY updated_at DESC, created_at DESC, id ASC LIMIT ${limit} OFFSET ${offset}`,
                values,
              );
              return jsonResponse(200, result.rows);
            }

            if (method === "POST") {
              const payload = JSON.parse(options.body);
              const withOriginKey = table === "notes" && Boolean(payload.origin_key);
              const result = await db.query(
                `INSERT INTO public.${table} (owner_id, title, subject_type, subject_id, ${jsonCol}${withOriginKey ? ", origin_key" : ""})
                 VALUES ($1::uuid, $2, $3, $4, $5::jsonb${withOriginKey ? ", $6" : ""})
                 RETURNING *`,
                [
                  payload.owner_id,
                  payload.title,
                  payload.subject_type,
                  payload.subject_id,
                  JSON.stringify(payload[jsonCol]),
                  ...(withOriginKey ? [payload.origin_key] : []),
                ],
              );
              return jsonResponse(201, result.rows);
            }

            if (method === "PATCH") {
              const payload = JSON.parse(options.body);
              const idEq = url.searchParams.get("id")?.slice(3);
              const ownerEq = url.searchParams.get("owner_id")?.slice(3);
              const updatedAtEq = url.searchParams.get("updated_at")?.slice(3);
              assert.ok(updatedAtEq, "PATCH must atomically guard the last observed updated_at");
              const cols = Object.keys(payload);
              const setClause = cols
                .map((col, idx) => (col === jsonCol ? `${col} = $${idx + 1}::jsonb` : `${col} = $${idx + 1}`))
                .join(", ");
              const values = [
                ...cols.map((col) => (col === jsonCol ? JSON.stringify(payload[col]) : payload[col])),
                idEq,
                ownerEq,
                updatedAtEq,
              ];
              const result = await db.query(
                `UPDATE public.${table}
                 SET ${setClause}
                 WHERE id = $${cols.length + 1}::uuid AND owner_id = $${cols.length + 2}::uuid
                   AND updated_at = $${cols.length + 3}::timestamptz
                 RETURNING *`,
                values,
              );
              return jsonResponse(200, result.rows);
            }

            if (method === "DELETE") {
              const idEq = url.searchParams.get("id")?.slice(3);
              const ownerEq = url.searchParams.get("owner_id")?.slice(3);
              const result = await db.query(
                `DELETE FROM public.${table}
                 WHERE id = $1::uuid AND owner_id = $2::uuid
                 RETURNING *`,
                [idEq, ownerEq],
              );
              return jsonResponse(200, result.rows);
            }
          }
        }

        throw new Error(`Unexpected PostgREST request: ${method} ${url.pathname}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database error";
      if (/row-level security/i.test(message)) {
        return jsonResponse(403, { code: "42501", message });
      }
      if (/duplicate key value violates unique constraint/i.test(message)) {
        return jsonResponse(409, { code: "23505", message });
      }
      return jsonResponse(400, { code: "23514", message });
    }
  }

  return { db, fetchImpl, recordedRequests };
}

test("notes and boards routes support owner-scoped CRUD, autosave updates, and subject links for candidate, job, meeting, and unlinked records", async () => {
  const harness = await createPgliteNotesBoardsHarness();
  try {
    const app = await createApp({
      env: {
        APP_TRUSTED_ORIGINS: "https://console.test",
        AUTH_ALLOWED_GOOGLE_EMAILS: "review@example.invalid,peer@example.invalid",
      },
      recruitmentContextLoader: testRecruitmentContext,
      notesBoardsFetch: harness.fetchImpl,
    });

    const owner1Headers = { authorization: "Bearer supabase-token-owner-1" };
    const owner2Headers = { authorization: "Bearer supabase-token-owner-2" };

    // 1. Create notes for all 4 permitted subject link patterns: candidate, job, meeting, and unlinked (null)
    const candidateNoteRes = await request(app, "POST", "/api/notes", {
      headers: owner1Headers,
      body: {
        title: "  Candidate Screen Notes  ",
        subject_type: "candidate",
        subject_id: "sourcing:2",
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Strong maintenance lead in Ontario." }],
            },
          ],
        },
      },
    });
    assert.equal(candidateNoteRes.status, 201);
    const candidateNote = NoteResponseSchema.parse(candidateNoteRes.body).note;
    assert.equal(candidateNote.owner_id, FIRST_OWNER);
    assert.equal(candidateNote.title, "Candidate Screen Notes");
    assert.equal(candidateNote.subject_type, "candidate");
    assert.equal(candidateNote.subject_id, "sourcing:2");

    const manualCandidateNoteRes = await request(app, "POST", "/api/notes", {
      headers: owner1Headers,
      body: {
        title: "Manual Candidate Note",
        subject_type: "candidate",
        subject_id: `manual:${FIRST_MANUAL_CANDIDATE_ID.toUpperCase()}`,
      },
    });
    assert.equal(manualCandidateNoteRes.status, 201);
    const manualCandidateNote = NoteResponseSchema.parse(manualCandidateNoteRes.body).note;
    assert.equal(manualCandidateNote.subject_id, `manual:${FIRST_MANUAL_CANDIDATE_ID}`);
    assert.deepEqual(manualCandidateNote.body, {});

    const jobNoteRes = await request(app, "POST", "/api/notes", {
      headers: owner1Headers,
      body: {
        title: "Apex Intake Brief",
        subject_type: "job",
        subject_id: "501",
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Must have automotive launch background." }] }],
        },
      },
    });
    assert.equal(jobNoteRes.status, 201);
    const jobNote = NoteResponseSchema.parse(jobNoteRes.body).note;
    assert.equal(jobNote.subject_type, "job");
    assert.equal(jobNote.subject_id, "501");

    const meetingNoteRes = await request(app, "POST", "/api/notes", {
      headers: owner1Headers,
      body: {
        title: "Screen Debrief",
        subject_type: "meeting",
        subject_id: FIRST_MEETING_ID.toUpperCase(),
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Follow up on shift preference." }] }],
        },
      },
    });
    assert.equal(meetingNoteRes.status, 201);
    const meetingNote = NoteResponseSchema.parse(meetingNoteRes.body).note;
    assert.equal(meetingNote.subject_type, "meeting");
    assert.equal(meetingNote.subject_id, FIRST_MEETING_ID);

    const unlinkedNoteRes = await request(app, "POST", "/api/notes", {
      headers: owner1Headers,
      body: {
        title: "General Recruiting Scratchpad",
      },
    });
    assert.equal(unlinkedNoteRes.status, 201);
    const unlinkedNote = NoteResponseSchema.parse(unlinkedNoteRes.body).note;
    assert.equal(unlinkedNote.subject_type, null);
    assert.equal(unlinkedNote.subject_id, null);

    // 2. Autosave updates on notes via PATCH and PUT, including optimistic concurrency check
    const autosave1Res = await request(app, "PATCH", `/api/notes/${candidateNote.id}`, {
      headers: owner1Headers,
      body: {
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", marks: [{ type: "bold" }], text: "Updated during autosave." }],
            },
          ],
        },
        expected_updated_at: candidateNote.updated_at,
      },
    });
    assert.equal(autosave1Res.status, 200);
    const autosavedNote1 = NoteResponseSchema.parse(autosave1Res.body).note;
    assert.equal(autosavedNote1.body.content[0].content[0].text, "Updated during autosave.");

    // Stale expected_updated_at returns 409 AUTOSAVE_CONFLICT
    const staleAutosaveRes = await request(app, "PUT", `/api/notes/${candidateNote.id}`, {
      headers: owner1Headers,
      body: {
        title: "Stale Overwrite Attempt",
        expected_updated_at: "2020-01-01T00:00:00.000Z",
      },
    });
    assert.equal(staleAutosaveRes.status, 409);
    assert.equal(staleAutosaveRes.body.error.code, "AUTOSAVE_CONFLICT");

    // Unlink note by setting subject_type: null, subject_id: null via PUT
    const unlinkedUpdateRes = await request(app, "PUT", `/api/notes/${manualCandidateNote.id}`, {
      headers: owner1Headers,
      body: {
        title: "Unlinked Note",
        subject_type: null,
        subject_id: null,
      },
    });
    assert.equal(unlinkedUpdateRes.status, 200);
    const unlinkedUpdated = NoteResponseSchema.parse(unlinkedUpdateRes.body).note;
    assert.equal(unlinkedUpdated.subject_type, null);
    assert.equal(unlinkedUpdated.subject_id, null);

    // 3. List notes with subject filters, unlinked filter, and title query
    const allOwner1Notes = await request(app, "GET", "/api/notes", { headers: owner1Headers });
    assert.equal(allOwner1Notes.status, 200);
    assert.equal(NoteListResponseSchema.parse(allOwner1Notes.body).notes.length, 5);

    const firstPageNote = allOwner1Notes.body.notes[0];
    const cursor = new URLSearchParams({
      limit: "2",
      after_updated_at: firstPageNote.updated_at,
      after_created_at: firstPageNote.created_at,
      after_id: firstPageNote.id,
    });
    const nextNotesPage = await request(app, "GET", `/api/notes?${cursor}`, { headers: owner1Headers });
    assert.equal(nextNotesPage.status, 200);
    assert.equal(nextNotesPage.body.notes.length, 2);
    assert.ok(nextNotesPage.body.notes.every((note) => note.owner_id === FIRST_OWNER));
    assert.ok(nextNotesPage.body.notes.every((note) => note.id !== firstPageNote.id));

    const candidateSubjectNotes = await request(
      app,
      "GET",
      "/api/notes?subject_type=candidate&subject_id=sourcing:2",
      { headers: owner1Headers },
    );
    assert.equal(candidateSubjectNotes.status, 200);
    assert.equal(candidateSubjectNotes.body.notes.length, 1);
    assert.equal(candidateSubjectNotes.body.notes[0].id, candidateNote.id);

    const unlinkedNotesList = await request(app, "GET", "/api/notes?unlinked=true", { headers: owner1Headers });
    assert.equal(unlinkedNotesList.status, 200);
    assert.equal(unlinkedNotesList.body.notes.length, 2);

    const searchNotesList = await request(app, "GET", "/api/notes?q=Intake", { headers: owner1Headers });
    assert.equal(searchNotesList.status, 200);
    assert.equal(searchNotesList.body.notes.length, 1);
    assert.equal(searchNotesList.body.notes[0].id, jobNote.id);

    // 4. Create, autosave update, list, get, and delete Excalidraw boards
    const createdBoardRes = await request(app, "POST", "/api/boards", {
      headers: owner1Headers,
      body: {
        title: "Apex Org Chart",
        subject_type: "job",
        subject_id: "501",
        scene: {
          type: "excalidraw",
          version: 2,
          elements: [
            {
              id: "box-vp",
              type: "rectangle",
              x: 100,
              y: 60,
              width: 180,
              height: 80,
            },
          ],
          appState: { viewBackgroundColor: "#ffffff" },
          files: {},
        },
      },
    });
    assert.equal(createdBoardRes.status, 201);
    const createdBoard = BoardResponseSchema.parse(createdBoardRes.body).board;
    assert.equal(createdBoard.owner_id, FIRST_OWNER);
    assert.equal(createdBoard.subject_type, "job");
    assert.equal(createdBoard.subject_id, "501");
    assert.equal(createdBoard.scene.elements.length, 1);

    const updatedBoardRes = await request(app, "PUT", `/api/boards/${createdBoard.id}`, {
      headers: owner1Headers,
      body: {
        scene: {
          type: "excalidraw",
          version: 2,
          elements: [
            ...createdBoard.scene.elements,
            {
              id: "box-pm",
              type: "rectangle",
              x: 100,
              y: 200,
              width: 180,
              height: 80,
            },
          ],
          appState: { viewBackgroundColor: "#f8fafc" },
          files: {},
        },
        expected_updated_at: createdBoard.updated_at,
      },
    });
    assert.equal(updatedBoardRes.status, 200);
    const updatedBoard = BoardResponseSchema.parse(updatedBoardRes.body).board;
    assert.equal(updatedBoard.scene.elements.length, 2);

    const fetchedBoardRes = await request(app, "GET", `/api/boards/${createdBoard.id}`, {
      headers: owner1Headers,
    });
    assert.equal(fetchedBoardRes.status, 200);
    assert.equal(BoardResponseSchema.parse(fetchedBoardRes.body).board.scene.elements.length, 2);

    const jobBoardsList = await request(app, "GET", "/api/boards?subject_type=job&subject_id=501", {
      headers: owner1Headers,
    });
    assert.equal(jobBoardsList.status, 200);
    assert.equal(BoardListResponseSchema.parse(jobBoardsList.body).boards.length, 1);

    // 5. Cross-owner isolation (Owner 2 sees 0 rows and gets 404 on Owner 1 IDs)
    const owner2Notes = await request(app, "GET", "/api/notes", { headers: owner2Headers });
    assert.equal(owner2Notes.status, 200);
    assert.deepEqual(owner2Notes.body.notes, []);

    assert.equal(
      (await request(app, "GET", `/api/notes/${candidateNote.id}`, { headers: owner2Headers })).status,
      404,
    );
    assert.equal(
      (await request(app, "PATCH", `/api/notes/${candidateNote.id}`, {
        headers: owner2Headers,
        body: { title: "Hijack" },
      })).status,
      404,
    );
    assert.equal(
      (await request(app, "DELETE", `/api/notes/${candidateNote.id}`, { headers: owner2Headers })).status,
      404,
    );
    assert.equal(
      (await request(app, "GET", `/api/boards/${createdBoard.id}`, { headers: owner2Headers })).status,
      404,
    );
    assert.equal(
      (await request(app, "DELETE", `/api/boards/${createdBoard.id}`, { headers: owner2Headers })).status,
      404,
    );

    // 6. Delete by owner succeeds and subsequent GET/DELETE returns 404
    const deletedNoteRes = await request(app, "DELETE", `/api/notes/${unlinkedNote.id}`, {
      headers: owner1Headers,
    });
    assert.equal(deletedNoteRes.status, 200);
    assert.deepEqual(NoteDeleteResponseSchema.parse(deletedNoteRes.body), {
      deleted: true,
      id: unlinkedNote.id,
    });
    assert.equal(
      (await request(app, "GET", `/api/notes/${unlinkedNote.id}`, { headers: owner1Headers })).status,
      404,
    );
    assert.equal(
      (await request(app, "DELETE", `/api/notes/${unlinkedNote.id}`, { headers: owner1Headers })).status,
      404,
    );

    const deletedBoardRes = await request(app, "DELETE", `/api/boards/${createdBoard.id}`, {
      headers: owner1Headers,
    });
    assert.equal(deletedBoardRes.status, 200);
    assert.deepEqual(BoardDeleteResponseSchema.parse(deletedBoardRes.body), {
      deleted: true,
      id: createdBoard.id,
    });
    assert.equal(
      (await request(app, "GET", `/api/boards/${createdBoard.id}`, { headers: owner1Headers })).status,
      404,
    );
  } finally {
    await harness.db.close();
  }
});

test("notes and boards routes enforce auth boundaries, subject existence and ownership, schema validation, and size bounds", async () => {
  const harness = await createPgliteNotesBoardsHarness();
  try {
    const app = await createApp({
      env: {
        APP_TRUSTED_ORIGINS: "https://console.test",
        AUTH_ALLOWED_GOOGLE_EMAILS: "review@example.invalid",
      },
      recruitmentContextLoader: testRecruitmentContext,
      notesBoardsFetch: harness.fetchImpl,
    });

    const validHeaders = { authorization: "Bearer supabase-token-owner-1" };

    // 1. Missing token -> 401
    assert.equal((await request(app, "GET", "/api/notes")).status, 401);
    assert.equal((await request(app, "GET", "/api/boards")).status, 401);

    // 2. Better Auth non-UUID session ID -> 401 (never used as owner_id)
    const betterAuthNoteRes = await request(app, "POST", "/api/notes", {
      headers: { authorization: "Bearer better-auth-non-uuid-token" },
      body: { title: "Should Reject" },
    });
    assert.equal(betterAuthNoteRes.status, 401);
    assert.equal(betterAuthNoteRes.body.error.code, "UNAUTHORIZED");

    // 3. Unapproved Google email -> 403
    assert.equal(
      (await request(app, "GET", "/api/notes", {
        headers: { authorization: "Bearer supabase-token-unapproved-email" },
      })).status,
      403,
    );

    // 4. RLS denied recruiter -> 403 on write
    const rlsDeniedRes = await request(app, "POST", "/api/boards", {
      headers: { authorization: "Bearer supabase-token-rls-denied" },
      body: { title: "Blocked" },
    });
    assert.equal(rlsDeniedRes.status, 403);
    assert.equal(rlsDeniedRes.body.error.code, "FORBIDDEN");

    // 5. Service role bearer token -> 403
    const serviceRoleToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.sig`;
    assert.equal(
      (await request(app, "GET", "/api/boards", {
        headers: { authorization: `Bearer ${serviceRoleToken}` },
      })).status,
      403,
    );

    // 6. Non-existent or other-owner subjects -> 404 SUBJECT_NOT_FOUND
    const missingCandidateRes = await request(app, "POST", "/api/notes", {
      headers: validHeaders,
      body: {
        title: "Missing Candidate",
        subject_type: "candidate",
        subject_id: "sourcing:9999",
      },
    });
    assert.equal(missingCandidateRes.status, 404);
    assert.equal(missingCandidateRes.body.error.code, "SUBJECT_NOT_FOUND");

    const otherOwnerManualCandidateRes = await request(app, "POST", "/api/notes", {
      headers: validHeaders,
      body: {
        title: "Other Owner Manual Candidate",
        subject_type: "candidate",
        subject_id: `manual:${SECOND_MANUAL_CANDIDATE_ID}`,
      },
    });
    assert.equal(otherOwnerManualCandidateRes.status, 404);
    assert.equal(otherOwnerManualCandidateRes.body.error.code, "SUBJECT_NOT_FOUND");

    const missingJobRes = await request(app, "POST", "/api/boards", {
      headers: validHeaders,
      body: {
        title: "Missing Job",
        subject_type: "job",
        subject_id: "999999",
      },
    });
    assert.equal(missingJobRes.status, 404);
    assert.equal(missingJobRes.body.error.code, "SUBJECT_NOT_FOUND");

    const otherOwnerMeetingRes = await request(app, "POST", "/api/notes", {
      headers: validHeaders,
      body: {
        title: "Other Owner Meeting",
        subject_type: "meeting",
        subject_id: SECOND_MEETING_ID,
      },
    });
    assert.equal(otherOwnerMeetingRes.status, 404);
    assert.equal(otherOwnerMeetingRes.body.error.code, "SUBJECT_NOT_FOUND");

    // 7. Invalid note/board IDs, forbidden client fields, invalid subject pairs, and malformed JSON -> 400
    assert.equal((await request(app, "GET", "/api/notes/not-a-uuid", { headers: validHeaders })).status, 400);
    assert.equal((await request(app, "GET", "/api/boards/not-a-uuid", { headers: validHeaders })).status, 400);

    assert.equal(
      (await request(app, "POST", "/api/notes", {
        headers: validHeaders,
        body: { title: "Spoof Owner", owner_id: SECOND_OWNER },
      })).status,
      400,
    );
    assert.equal(
      (await request(app, "POST", "/api/boards", {
        headers: validHeaders,
        body: { title: "Spoof ID", id: FIRST_MEETING_ID },
      })).status,
      400,
    );
    assert.equal(
      (await request(app, "POST", "/api/notes", {
        headers: validHeaders,
        body: { title: "Half Subject", subject_type: "candidate" },
      })).status,
      400,
    );
    assert.equal(
      (await request(app, "POST", "/api/notes", {
        headers: validHeaders,
        body: { title: "Invalid Subject Type", subject_type: "none" },
      })).status,
      400,
    );
    assert.equal(
      (await request(app, "POST", "/api/notes", {
        headers: validHeaders,
        body: { title: "Invalid Body", body: { type: "paragraph", content: "not-an-array" } },
      })).status,
      400,
    );
    assert.equal(
      (await request(app, "POST", "/api/boards", {
        headers: validHeaders,
        body: { title: "Invalid Scene", scene: { elements: [{ id: "", type: "rectangle" }] } },
      })).status,
      400,
    );

    // 8. Oversized note body and board scene -> 400 INVALID_INPUT
    const oversizedNoteRes = await request(app, "POST", "/api/notes", {
      headers: validHeaders,
      body: {
        title: "Oversized Note",
        body: {
          type: "doc",
          content: Array.from({ length: 8 }, () => ({
            type: "paragraph",
            content: [{ type: "text", text: "x".repeat(Math.ceil(MAX_NOTE_BODY_BYTES / 6)) }],
          })),
        },
      },
    });
    assert.equal(oversizedNoteRes.status, 400);
    assert.equal(oversizedNoteRes.body.error.code, "INVALID_INPUT");

    const oversizedBoardRes = await request(app, "POST", "/api/boards", {
      headers: validHeaders,
      body: {
        title: "Oversized Board",
        scene: {
          elements: [{ id: "el-1", type: "rectangle" }],
          files: {
            "f-1": {
              id: "f-1",
              mimeType: "image/png",
              dataURL: `data:image/png;base64,${"A".repeat(MAX_BOARD_SCENE_BYTES)}`,
            },
          },
        },
      },
    });
    assert.equal(oversizedBoardRes.status, 400);
    assert.equal(oversizedBoardRes.body.error.code, "INVALID_INPUT");

    // 9. Service-role key configured in environment fails closed with 503 SUPABASE_UNAVAILABLE
    const misconfiguredApp = await createApp({
      env: {
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: `sb_${"secret"}_forbidden_server_credential`,
      },
      recruitmentContextLoader: testRecruitmentContext,
      notesBoardsFetch: harness.fetchImpl,
    });
    const misconfiguredNotesRes = await request(misconfiguredApp, "GET", "/api/notes", { headers: validHeaders });
    assert.equal(misconfiguredNotesRes.status, 503);
    assert.equal(misconfiguredNotesRes.body.error.code, "SUPABASE_UNAVAILABLE");

    const misconfiguredBoardsRes = await request(misconfiguredApp, "GET", "/api/boards", { headers: validHeaders });
    assert.equal(misconfiguredBoardsRes.status, 503);
    assert.equal(misconfiguredBoardsRes.body.error.code, "SUPABASE_UNAVAILABLE");
  } finally {
    await harness.db.close();
  }
});

test("meeting origin keys are idempotent and bound to the owner and exact candidate", async () => {
  const harness = await createPgliteNotesBoardsHarness();
  try {
    const app = await createApp({
      env: { APP_TRUSTED_ORIGINS: "https://console.test", AUTH_ALLOWED_GOOGLE_EMAILS: "review@example.invalid,peer@example.invalid" },
      recruitmentContextLoader: testRecruitmentContext,
      notesBoardsFetch: harness.fetchImpl,
    });
    const headers = { authorization: "Bearer supabase-token-owner-1" };
    const body = {
      title: "After call",
      subject_type: "candidate",
      subject_id: "sourcing:2",
      origin_key: `meeting_draft:${FIRST_MEETING_ID}`,
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Verbatim call notes" }] }] },
    };
    const first = await request(app, "POST", "/api/notes", { headers, body });
    assert.equal(first.status, 201);
    assert.equal(first.body.note.origin_key, body.origin_key);
    const repeated = await request(app, "POST", "/api/notes", { headers, body: { ...body, title: "Changed title" } });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.note.id, first.body.note.id);
    assert.equal(repeated.body.note.title, "After call");

    const wrongCandidate = await request(app, "POST", "/api/notes", {
      headers, body: { ...body, subject_id: `manual:${FIRST_MANUAL_CANDIDATE_ID}` },
    });
    assert.equal(wrongCandidate.status, 409);
    assert.equal(wrongCandidate.body.error.code, "NOTE_ORIGIN_CONFLICT");

    const otherOwnersMeeting = await request(app, "POST", "/api/notes", {
      headers, body: { ...body, origin_key: `meeting_draft:${SECOND_MEETING_ID}` },
    });
    assert.equal(otherOwnersMeeting.status, 409);
    assert.equal(otherOwnersMeeting.body.error.code, "NOTE_ORIGIN_CONFLICT");

    const malformed = await request(app, "POST", "/api/notes", {
      headers, body: { ...body, origin_key: "meeting_draft:not-a-uuid" },
    });
    assert.equal(malformed.status, 400);
  } finally {
    await harness.db.close();
  }
});
