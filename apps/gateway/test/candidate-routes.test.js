import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CandidateListResponseSchema, CandidateResponseSchema } from "@ja/shared-types";
import { createApp } from "../app.js";

const SUPABASE_URL = "https://abnfffkmxqixrwzackjf.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_0Y8w6xekEjAr3vHZUMr1hA_-fcvvtq0";
const FIRST_OWNER = "11111111-1111-4111-8111-111111111111";
const SECOND_OWNER = "22222222-2222-4222-8222-222222222222";
const UNAUTHORIZED_OWNER = "33333333-3333-4333-8333-333333333333";

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

CREATE FUNCTION public.touch_candidate_edits_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER candidate_edits_touch_updated_at
  BEFORE UPDATE ON public.candidate_edits
  FOR EACH ROW EXECUTE FUNCTION public.touch_candidate_edits_updated_at();

ALTER TABLE public.candidate_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.candidate_edits FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidate_edits TO authenticated;

CREATE POLICY candidate_edits_select_own ON public.candidate_edits
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidate_edits_insert_own ON public.candidate_edits
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidate_edits_update_own ON public.candidate_edits
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidate_edits_delete_own ON public.candidate_edits
  FOR DELETE TO authenticated
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

CREATE FUNCTION public.touch_candidates_manual_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER candidates_manual_touch_updated_at
  BEFORE UPDATE ON public.candidates_manual
  FOR EACH ROW EXECUTE FUNCTION public.touch_candidates_manual_updated_at();

ALTER TABLE public.candidates_manual ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.candidates_manual FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.candidates_manual TO authenticated;

CREATE POLICY candidates_manual_select_own ON public.candidates_manual
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidates_manual_insert_own ON public.candidates_manual
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidates_manual_update_own ON public.candidates_manual
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter())
  WITH CHECK ((SELECT auth.uid()) = owner_id AND public.is_authorized_recruiter());

CREATE POLICY candidates_manual_delete_own ON public.candidates_manual
  FOR DELETE TO authenticated
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

async function createPgliteSupabaseHarness() {
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
    ALTER TABLE public.tracker_candidates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_sourcing ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.tracker_submissions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tracker_candidates_read ON public.tracker_candidates FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY tracker_sourcing_read ON public.tracker_sourcing FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    CREATE POLICY tracker_submissions_read ON public.tracker_submissions FOR SELECT TO authenticated USING (public.is_authorized_recruiter());
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT SELECT ON public.tracker_candidates, public.tracker_sourcing, public.tracker_submissions TO authenticated;
  `);
  await db.exec(MIGRATION_008_SQL);
  await db.exec(MIGRATION_009_SQL);
  const migration010 = await readFile(new URL("../migrations/010_candidates_all.sql", import.meta.url), "utf8");
  await db.exec(migration010);

  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)", [
    FIRST_OWNER,
    "review@example.invalid",
    SECOND_OWNER,
    "peer@example.invalid",
    UNAUTHORIZED_OWNER,
    "denied@example.invalid",
  ]);
  await db.query(
    `INSERT INTO public.tracker_candidates
      (id, tracker_row, candidate_name, current_title, current_company, location, industry, shift, email, phone, compensation_target, current_compensation, notes)
     VALUES (1, 7, 'Source Name', 'Source Title', 'Source Co', 'Toronto, ON', 'Packaging', 'Days', 'source@example.invalid', '555-0100', '$120k', '$110k', 'Source Note')`,
  );
  await db.query(
    `INSERT INTO public.tracker_sourcing
      (id, tracker_row, candidate_name, current_title, current_company, personal_email, mobile_number, source_notes, profile_url, role, candidate_key)
     VALUES (2, 11, 'Sourced Person', 'Maintenance Lead', 'FabWorks', 'sourced@example.invalid', '555-0199', 'Found on sheet', 'https://example.com/in/sourced', 'Maintenance Manager', 'src-key-2')`,
  );
  await db.query(
    `INSERT INTO public.tracker_submissions
      (id, tracker_row, candidate_name, current_title, current_company, location, industry, target_current_compensation, additional_notes, role_submitted_for, client_submitted_to, candidate_key)
     VALUES (3, 19, 'Submitted Person', 'Plant Director', 'SteelCo', 'Hamilton, ON', 'Metals', '$160k / $145k', 'Strong ops leader', 'VP Operations', 'Apex Industrial', 'sub-key-3')`,
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

    const user = tokens.get(token);
    if (url.pathname === "/auth/v1/user") {
      if (!user) return jsonResponse(401, { message: "Invalid token" });
      return jsonResponse(200, { id: user.id, email: user.email, role: "authenticated" });
    }
    if (!user) return jsonResponse(401, { message: "Invalid token" });

    try {
      return await withRlsSession(user, async () => {
        if (url.pathname === "/rest/v1/candidates_all" && method === "GET") {
          const conditions = [];
          const values = [];
          const idParam = url.searchParams.get("id");
          if (idParam?.startsWith("eq.")) {
            values.push(idParam.slice(3));
            conditions.push(`id = $${values.length}`);
          }
          const sourceParam = url.searchParams.get("candidate_source");
          if (sourceParam?.startsWith("eq.")) {
            values.push(sourceParam.slice(3));
            conditions.push(`candidate_source = $${values.length}`);
          }
          const orParam = url.searchParams.get("or");
          if (orParam) {
            const match = orParam.match(/ilike\.\*([^*]+)\*/);
            if (match) {
              values.push(`%${match[1]}%`);
              const p = `$${values.length}`;
              conditions.push(
                `(COALESCE(candidate_name,'') ILIKE ${p} OR COALESCE(current_title,'') ILIKE ${p} OR COALESCE(current_company,'') ILIKE ${p} OR COALESCE(location,'') ILIKE ${p} OR COALESCE(industry,'') ILIKE ${p} OR COALESCE(email,'') ILIKE ${p} OR COALESCE(notes,'') ILIKE ${p} OR COALESCE(role_context,'') ILIKE ${p} OR COALESCE(client_context,'') ILIKE ${p})`,
              );
            }
          }
          const limit = Number(url.searchParams.get("limit") || 100);
          const offset = Number(url.searchParams.get("offset") || 0);
          const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
          const result = await db.query(
            `SELECT * FROM public.candidates_all ${whereSql} ORDER BY edited_at DESC NULLS LAST, source_updated_at DESC NULLS LAST, id ASC LIMIT ${limit} OFFSET ${offset}`,
            values,
          );
          return jsonResponse(200, result.rows);
        }

        if (url.pathname === "/rest/v1/candidates_manual" && method === "POST") {
          const payload = JSON.parse(options.body);
          const columns = Object.keys(payload);
          const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(", ");
          const values = columns.map((col) => payload[col]);
          const result = await db.query(
            `INSERT INTO public.candidates_manual (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
            values,
          );
          return jsonResponse(201, result.rows);
        }

        if (url.pathname === "/rest/v1/candidates_manual" && method === "PATCH") {
          const payload = JSON.parse(options.body);
          const idEq = url.searchParams.get("id")?.slice(3);
          const ownerEq = url.searchParams.get("owner_id")?.slice(3);
          const cols = Object.keys(payload);
          const setClause = cols.map((col, idx) => `${col} = $${idx + 1}`).join(", ");
          const values = [...cols.map((col) => payload[col]), idEq, ownerEq];
          const result = await db.query(
            `UPDATE public.candidates_manual SET ${setClause} WHERE id = $${cols.length + 1}::uuid AND owner_id = $${cols.length + 2}::uuid RETURNING *`,
            values,
          );
          return jsonResponse(200, result.rows);
        }

        if (url.pathname === "/rest/v1/candidate_edits" && method === "GET") {
          const ownerEq = url.searchParams.get("owner_id")?.slice(3);
          const sourceEq = url.searchParams.get("tracker_source")?.slice(3);
          const rowEq = Number(url.searchParams.get("tracker_row")?.slice(3));
          const result = await db.query(
            "SELECT id, owner_id, tracker_source, tracker_row, edits FROM public.candidate_edits WHERE owner_id = $1::uuid AND tracker_source = $2 AND tracker_row = $3 LIMIT 1",
            [ownerEq, sourceEq, rowEq],
          );
          return jsonResponse(200, result.rows);
        }

        if (url.pathname === "/rest/v1/candidate_edits" && method === "POST") {
          const payload = JSON.parse(options.body);
          const result = await db.query(
            `INSERT INTO public.candidate_edits (owner_id, tracker_source, tracker_row, edits)
             VALUES ($1::uuid, $2, $3, $4::jsonb)
             ON CONFLICT (owner_id, tracker_source, tracker_row)
             DO UPDATE SET edits = EXCLUDED.edits
             RETURNING *`,
            [payload.owner_id, payload.tracker_source, payload.tracker_row, JSON.stringify(payload.edits)],
          );
          return jsonResponse(201, result.rows);
        }

        throw new Error(`Unexpected PostgREST request: ${method} ${url.pathname}`);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database error";
      if (/row-level security/i.test(message)) {
        return jsonResponse(403, { code: "42501", message });
      }
      return jsonResponse(400, { code: "23514", message });
    }
  }

  return { db, fetchImpl, recordedRequests };
}

test("candidate routes add, edit, and read manual and Tracker-overlaid candidates against migrations 008, 009, and 010", async () => {
  const harness = await createPgliteSupabaseHarness();
  try {
    const app = await createApp({
      env: {
        APP_TRUSTED_ORIGINS: "https://console.test",
        AUTH_ALLOWED_GOOGLE_EMAILS: "review@example.invalid,peer@example.invalid",
      },
      recruitmentContextLoader: testRecruitmentContext,
      candidateFetch: harness.fetchImpl,
    });

    const owner1Headers = { authorization: "Bearer supabase-token-owner-1" };
    const owner2Headers = { authorization: "Bearer supabase-token-owner-2" };

    // 1. Initial read lists all 3 imported Tracker sources
    const initialList = await request(app, "GET", "/api/candidates", { headers: owner1Headers });
    assert.equal(initialList.status, 200);
    const parsedInitial = CandidateListResponseSchema.parse(initialList.body);
    assert.equal(parsedInitial.candidates.length, 3);
    assert.deepEqual(
      parsedInitial.candidates.map((c) => c.id).sort(),
      ["sourcing:2", "submission:3", "tracker_candidates:1"],
    );

    // 2. Manual candidate add (migration 009) uses Supabase Auth UUID as owner_id
    const createdRes = await request(app, "POST", "/api/candidates", {
      headers: owner1Headers,
      body: {
        candidate_name: "  Manual Candidate  ",
        current_title: "Operations Director",
        current_company: "Maple Industrial",
        location: "Mississauga, ON",
        email: "MANUAL@EXAMPLE.INVALID",
        phone: "555-0144",
        compensation_target: "$175k",
        notes: "Added directly in Workbench",
      },
    });
    assert.equal(createdRes.status, 201);
    const createdCandidate = CandidateResponseSchema.parse(createdRes.body).candidate;
    assert.match(createdCandidate.id, /^manual:[0-9a-f-]{36}$/);
    assert.equal(createdCandidate.candidate_source, "manual");
    assert.equal(createdCandidate.tracker_source, null);
    assert.equal(createdCandidate.tracker_row, null);
    assert.equal(createdCandidate.is_manual, true);
    assert.equal(createdCandidate.candidate_name, "Manual Candidate");
    assert.equal(createdCandidate.email, "manual@example.invalid");

    // Verify owner_id in candidates_manual is the exact Supabase Auth user UUID
    const manualDbRows = (await harness.db.query("SELECT owner_id, candidate_name FROM public.candidates_manual")).rows;
    assert.equal(manualDbRows.length, 1);
    assert.equal(manualDbRows[0].owner_id, FIRST_OWNER);

    // 3. Edit manual candidate (migration 009) including clearing a field with null
    const editedManualRes = await request(app, "PATCH", `/api/candidates/${createdCandidate.id}`, {
      headers: owner1Headers,
      body: {
        current_title: "VP of Operations",
        notes: null,
      },
    });
    assert.equal(editedManualRes.status, 200);
    const editedManual = CandidateResponseSchema.parse(editedManualRes.body).candidate;
    assert.equal(editedManual.current_title, "VP of Operations");
    assert.equal(editedManual.notes, null);
    assert.equal(editedManual.candidate_name, "Manual Candidate");

    // 4. Other owner cannot read or edit owner 1's manual candidate (RLS enforced)
    assert.equal(
      (await request(app, "GET", `/api/candidates/${createdCandidate.id}`, { headers: owner2Headers })).status,
      404,
    );
    assert.equal(
      (await request(app, "PATCH", `/api/candidates/${createdCandidate.id}`, {
        headers: owner2Headers,
        body: { current_title: "Hijacked Title" },
      })).status,
      404,
    );

    // 5. Tracker candidate overlay edit (migrations 008 + 010)
    const overlayRes1 = await request(app, "PATCH", "/api/candidates/tracker_candidates:1", {
      headers: owner1Headers,
      body: {
        current_title: "Edited Tracker Title",
        notes: null,
      },
    });
    assert.equal(overlayRes1.status, 200);
    const overlaid1 = CandidateResponseSchema.parse(overlayRes1.body).candidate;
    assert.equal(overlaid1.id, "tracker_candidates:1");
    assert.equal(overlaid1.current_title, "Edited Tracker Title");
    assert.equal(overlaid1.notes, null);
    assert.equal(overlaid1.location, "Toronto, ON");
    assert.ok(overlaid1.edited_at);

    // Second partial edit merges onto existing overlay without losing first edit
    const overlayRes2 = await request(app, "PATCH", "/api/candidates/tracker_candidates:1", {
      headers: owner1Headers,
      body: {
        edits: { location: "Burlington, ON" },
        tracker_source: "tracker_candidates",
        tracker_row: 7,
      },
    });
    assert.equal(overlayRes2.status, 200);
    const overlaid2 = CandidateResponseSchema.parse(overlayRes2.body).candidate;
    assert.equal(overlaid2.current_title, "Edited Tracker Title");
    assert.equal(overlaid2.notes, null);
    assert.equal(overlaid2.location, "Burlington, ON");

    // Verify underlying tracker_candidates table was NOT modified!
    const rawTrackerRow = (
      await harness.db.query("SELECT candidate_name, current_title, location, notes FROM public.tracker_candidates WHERE id = 1")
    ).rows[0];
    assert.deepEqual(rawTrackerRow, {
      candidate_name: "Source Name",
      current_title: "Source Title",
      location: "Toronto, ON",
      notes: "Source Note",
    });

    // 6. Tracker re-import does not overwrite owner's overlay edits
    await harness.db.query(
      "UPDATE public.tracker_candidates SET current_title = 'Reimported Title', notes = 'Reimported Note', current_company = 'New Imported Co' WHERE id = 1",
    );

    const afterReimportOwner1 = await request(app, "GET", "/api/candidates/tracker_candidates:1", {
      headers: owner1Headers,
    });
    assert.equal(afterReimportOwner1.status, 200);
    assert.equal(afterReimportOwner1.body.candidate.current_title, "Edited Tracker Title");
    assert.equal(afterReimportOwner1.body.candidate.notes, null);
    assert.equal(afterReimportOwner1.body.candidate.location, "Burlington, ON");
    assert.equal(afterReimportOwner1.body.candidate.current_company, "New Imported Co");

    // Owner 2 sees the unedited reimported Tracker row
    const afterReimportOwner2 = await request(app, "GET", "/api/candidates/tracker_candidates:1", {
      headers: owner2Headers,
    });
    assert.equal(afterReimportOwner2.status, 200);
    assert.equal(afterReimportOwner2.body.candidate.current_title, "Reimported Title");
    assert.equal(afterReimportOwner2.body.candidate.notes, "Reimported Note");
    assert.equal(afterReimportOwner2.body.candidate.edited_at, null);

    // 7. Submissioncompensation_context overlay works without splitting target/current
    const submissionEdit = await request(app, "PATCH", "/api/candidates/submission:3", {
      headers: owner1Headers,
      body: {
        compensation_context: "$165k base + 15% bonus",
      },
    });
    assert.equal(submissionEdit.status, 200);
    assert.equal(submissionEdit.body.candidate.compensation_context, "$165k base + 15% bonus");

    // 8. Filter by source and search query
    const manualOnly = await request(app, "GET", "/api/candidates?source=manual", { headers: owner1Headers });
    assert.equal(manualOnly.status, 200);
    assert.equal(manualOnly.body.candidates.length, 1);
    assert.equal(manualOnly.body.candidates[0].id, createdCandidate.id);

    const searchResult = await request(app, "GET", "/api/candidates?q=Burlington", { headers: owner1Headers });
    assert.equal(searchResult.status, 200);
    assert.equal(searchResult.body.candidates.length, 1);
    assert.equal(searchResult.body.candidates[0].id, "tracker_candidates:1");
  } finally {
    await harness.db.close();
  }
});

test("candidate routes reject Better Auth non-UUID IDs, service role keys, invalid keys, and forbidden fields", async () => {
  const harness = await createPgliteSupabaseHarness();
  try {
    const app = await createApp({
      env: {
        APP_TRUSTED_ORIGINS: "https://console.test",
        AUTH_ALLOWED_GOOGLE_EMAILS: "review@example.invalid",
      },
      recruitmentContextLoader: testRecruitmentContext,
      candidateFetch: harness.fetchImpl,
    });

    const validHeaders = { authorization: "Bearer supabase-token-owner-1" };

    // Missing token -> 401
    assert.equal((await request(app, "GET", "/api/candidates")).status, 401);

    // Better Auth non-UUID user ID -> 401 (never used as owner_id)
    const betterAuthRes = await request(app, "POST", "/api/candidates", {
      headers: { authorization: "Bearer better-auth-non-uuid-token" },
      body: { candidate_name: "Should Reject" },
    });
    assert.equal(betterAuthRes.status, 401);
    assert.equal(betterAuthRes.body.error.code, "UNAUTHORIZED");

    // Unapproved email -> 403
    const unapprovedRes = await request(app, "GET", "/api/candidates", {
      headers: { authorization: "Bearer supabase-token-unapproved-email" },
    });
    assert.equal(unapprovedRes.status, 403);

    // RLS denied recruiter -> 403 on write
    const rlsDeniedRes = await request(app, "POST", "/api/candidates", {
      headers: { authorization: "Bearer supabase-token-rls-denied" },
      body: { candidate_name: "Blocked Recruiter" },
    });
    assert.equal(rlsDeniedRes.status, 403);
    assert.equal(rlsDeniedRes.body.error.code, "FORBIDDEN");

    // Service role bearer token -> 403
    const serviceRoleToken = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.sig`;
    const serviceTokenRes = await request(app, "GET", "/api/candidates", {
      headers: { authorization: `Bearer ${serviceRoleToken}` },
    });
    assert.equal(serviceTokenRes.status, 403);

    // Invalid candidate source keys -> 400
    assert.equal((await request(app, "GET", "/api/candidates/unknown:1", { headers: validHeaders })).status, 400);
    assert.equal((await request(app, "GET", "/api/candidates/sourcing:0", { headers: validHeaders })).status, 400);
    assert.equal((await request(app, "GET", "/api/candidates/manual:not-a-uuid", { headers: validHeaders })).status, 400);

    // Non-existent Tracker candidate -> 404
    assert.equal((await request(app, "GET", "/api/candidates/sourcing:9999", { headers: validHeaders })).status, 404);
    assert.equal(
      (await request(app, "PATCH", "/api/candidates/sourcing:9999", {
        headers: validHeaders,
        body: { current_title: "Missing" },
      })).status,
      404,
    );

    // Client-supplied owner_id or provenance keys -> 400
    assert.equal(
      (await request(app, "POST", "/api/candidates", {
        headers: validHeaders,
        body: { candidate_name: "Spoof", owner_id: SECOND_OWNER },
      })).status,
      400,
    );
    assert.equal(
      (await request(app, "PATCH", "/api/candidates/sourcing:2", {
        headers: validHeaders,
        body: { owner_id: SECOND_OWNER, current_title: "Spoof" },
      })).status,
      400,
    );

    // Empty edit payload -> 400
    assert.equal(
      (await request(app, "PATCH", "/api/candidates/sourcing:2", {
        headers: validHeaders,
        body: {},
      })).status,
      400,
    );

    // Mismatched tracker_source or tracker_row on overlay edit -> 400
    assert.equal(
      (await request(app, "PATCH", "/api/candidates/sourcing:2", {
        headers: validHeaders,
        body: {
          edits: { current_title: "Wrong Source" },
          tracker_source: "tracker_candidates",
        },
      })).status,
      400,
    );
    assert.equal(
      (await request(app, "PATCH", "/api/candidates/sourcing:2", {
        headers: validHeaders,
        body: {
          edits: { current_title: "Wrong Row" },
          tracker_row: 999,
        },
      })).status,
      400,
    );

    // Manual candidate rejects Tracker-only fields and null candidate_name -> 400
    const manualUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert.equal(
      (await request(app, "PATCH", `/api/candidates/manual:${manualUuid}`, {
        headers: validHeaders,
        body: { compensation_context: "$100k" },
      })).status,
      400,
    );
    assert.equal(
      (await request(app, "PATCH", `/api/candidates/manual:${manualUuid}`, {
        headers: validHeaders,
        body: { candidate_name: null },
      })).status,
      400,
    );

    // Service-role key configured in environment fails closed with 503
    const misconfiguredApp = await createApp({
      env: {
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: `sb_${"secret"}_forbidden_server_credential`,
      },
      recruitmentContextLoader: testRecruitmentContext,
      candidateFetch: harness.fetchImpl,
    });
    const misconfiguredRes = await request(misconfiguredApp, "GET", "/api/candidates", { headers: validHeaders });
    assert.equal(misconfiguredRes.status, 503);
    assert.equal(misconfiguredRes.body.error.code, "SUPABASE_UNAVAILABLE");
  } finally {
    await harness.db.close();
  }
});
