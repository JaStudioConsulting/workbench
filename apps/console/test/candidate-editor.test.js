import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MANUAL_CANDIDATE_EDITABLE_FIELDS,
  TRACKER_CANDIDATE_OVERLAY_FIELDS,
} from "@ja/shared-types";
import {
  CANDIDATE_FORM_FIELD_CONFIGS,
  _resetCandidateEditorStoreForTesting,
  applyCandidateRecordToUiCandidate,
  buildCandidateCreatePayload,
  buildCandidateEditPayload,
  createCandidate,
  createInitialCandidateFormValues,
  describeCandidateProvenance,
  getCachedCandidateRecord,
  getCandidateById,
  getSupabaseCandidateAccessToken,
  isPrivilegedSupabaseCredential,
  listCandidates,
  loadCandidateDirectory,
  mergeCandidatesWithDirectory,
  updateCandidate,
} from "../src/features/candidate-review/candidateEditorService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const featureDir = path.resolve(here, "../src/features/candidate-review");

const VALID_USER_UUID = "11111111-1111-4111-8111-111111111111";
const MANUAL_RECORD_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function createMockSupabaseClient({
  accessToken = makeJwt({ sub: VALID_USER_UUID, role: "authenticated" }),
  userId = VALID_USER_UUID,
  error = null,
} = {}) {
  return {
    auth: {
      getSession: async () => ({
        data: {
          session: accessToken
            ? {
                access_token: accessToken,
                user: userId !== null ? { id: userId, email: "recruiter@example.invalid" } : undefined,
              }
            : null,
        },
        error,
      }),
    },
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test.beforeEach(() => {
  _resetCandidateEditorStoreForTesting();
});

test("editable field configs match shared Zod contracts for manual vs Tracker overlay records", () => {
  const allFormKeys = CANDIDATE_FORM_FIELD_CONFIGS.map((field) => field.key);
  const manualFormKeys = CANDIDATE_FORM_FIELD_CONFIGS.filter((field) => !field.trackerOnly).map((field) => field.key);

  assert.deepEqual([...manualFormKeys].sort(), [...MANUAL_CANDIDATE_EDITABLE_FIELDS].sort());
  assert.deepEqual([...allFormKeys].sort(), [...TRACKER_CANDIDATE_OVERLAY_FIELDS].sort());

  const createProv = describeCandidateProvenance(null, { mode: "create" });
  assert.equal(createProv.isManual, true);
  assert.deepEqual(createProv.editableFields, MANUAL_CANDIDATE_EDITABLE_FIELDS);

  const manualEditProv = describeCandidateProvenance({ id: `manual:${MANUAL_RECORD_UUID}` }, { mode: "edit" });
  assert.equal(manualEditProv.isManual, true);
  assert.equal(manualEditProv.candidateSource, "manual");
  assert.equal(manualEditProv.trackerSource, null);
  assert.deepEqual(manualEditProv.editableFields, MANUAL_CANDIDATE_EDITABLE_FIELDS);

  const trackerEditProv = describeCandidateProvenance(
    {
      id: "sourcing:42",
      tracker_row: 15,
      edited_at: "2026-11-08T18:00:00.000Z",
    },
    { mode: "edit" },
  );
  assert.equal(trackerEditProv.isManual, false);
  assert.equal(trackerEditProv.candidateSource, "sourcing");
  assert.equal(trackerEditProv.trackerSource, "tracker_sourcing");
  assert.equal(trackerEditProv.trackerRow, 15);
  assert.equal(trackerEditProv.hasOverlay, true);
  assert.deepEqual(trackerEditProv.editableFields, TRACKER_CANDIDATE_OVERLAY_FIELDS);
});

test("Supabase access token guard rejects missing sessions, Better Auth non-UUID IDs, and privileged keys", async () => {
  const validClient = createMockSupabaseClient();
  const token = await getSupabaseCandidateAccessToken({ client: validClient });
  assert.ok(token.length > 10);

  // Missing session -> 401
  await assert.rejects(
    () => getSupabaseCandidateAccessToken({ client: createMockSupabaseClient({ accessToken: "" }) }),
    (err) => err.code === "UNAUTHORIZED" && err.status === 401,
  );

  // Better Auth opaque user ID on session -> 401
  await assert.rejects(
    () => getSupabaseCandidateAccessToken({
      client: createMockSupabaseClient({ userId: "better-auth-opaque-id-12345" }),
    }),
    (err) => err.code === "UNAUTHORIZED" && /Supabase Auth UUID/.test(err.message),
  );

  // Better Auth non-UUID subject inside JWT -> 401
  await assert.rejects(
    () => getSupabaseCandidateAccessToken({
      client: createMockSupabaseClient({
        accessToken: makeJwt({ sub: "better_auth_user_abc", role: "authenticated" }),
        userId: VALID_USER_UUID,
      }),
    }),
    (err) => err.code === "UNAUTHORIZED" && /UUID/.test(err.message),
  );

  // Service-role JWT -> 403
  const serviceJwt = makeJwt({ sub: VALID_USER_UUID, role: "service_role" });
  assert.equal(isPrivilegedSupabaseCredential(serviceJwt), true);
  await assert.rejects(
    () => getSupabaseCandidateAccessToken({
      client: createMockSupabaseClient({ accessToken: serviceJwt }),
    }),
    (err) => err.code === "FORBIDDEN" && err.status === 403,
  );

  // Secret key prefix -> 403
  const secretKey = `sb_${"secret"}_forbidden_credential`;
  assert.equal(isPrivilegedSupabaseCredential(secretKey), true);
  await assert.rejects(
    () => getSupabaseCandidateAccessToken({
      client: createMockSupabaseClient({ accessToken: secretKey }),
    }),
    (err) => err.code === "FORBIDDEN" && err.status === 403,
  );
});

test("buildCandidateCreatePayload and buildCandidateEditPayload enforce Zod contracts and null clears", () => {
  const createPayload = buildCandidateCreatePayload({
    candidate_name: "  Alex Mercer  ",
    current_title: "  Automation Engineer ",
    current_company: "  North Star Robotics ",
    location: "Kitchener, ON",
    industry: "Automotive",
    shift: "Days",
    email: "  ALEX@EXAMPLE.INVALID ",
    phone: " 555-0133 ",
    compensation_target: "$135k",
    current_compensation: "",
    notes: "   ",
  });

  assert.deepEqual(createPayload, {
    candidate_name: "Alex Mercer",
    current_title: "Automation Engineer",
    current_company: "North Star Robotics",
    location: "Kitchener, ON",
    industry: "Automotive",
    shift: "Days",
    email: "alex@example.invalid",
    phone: "555-0133",
    compensation_target: "$135k",
  });

  // Missing required candidate_name fails validation
  assert.throws(
    () => buildCandidateCreatePayload({ candidate_name: "   ", current_title: "Engineer" }),
    (err) => err.code === "INVALID_INPUT" && err.fieldErrors?.candidate_name === "Candidate name is required",
  );

  // Tracker-only field on manual create fails validation
  assert.throws(
    () => buildCandidateCreatePayload({ candidate_name: "Alex", compensation_context: "$120k" }),
    (err) => err.code === "INVALID_INPUT" && /Unsupported field/.test(err.message),
  );

  // Forbidden write key fails validation
  assert.throws(
    () => buildCandidateCreatePayload({ candidate_name: "Alex", owner_id: VALID_USER_UUID }),
    (err) => err.code === "INVALID_INPUT" && /owner_id cannot be set/.test(err.message),
  );

  // Manual edit with baseline: changed field + cleared field (to null), untouched null omitted
  const manualBaseline = {
    id: `manual:${MANUAL_RECORD_UUID}`,
    candidate_source: "manual",
    tracker_source: null,
    candidate_source_id: MANUAL_RECORD_UUID,
    tracker_row: null,
    candidate_name: "Alex Mercer",
    current_title: "Automation Engineer",
    current_company: "North Star Robotics",
    location: "Kitchener, ON",
    industry: null,
    shift: "Days",
    email: "alex@example.invalid",
    phone: "555-0133",
    compensation_target: "$135k",
    current_compensation: null,
    compensation_context: null,
    notes: "Initial manual note",
    profile_url: null,
    role_context: null,
    client_context: null,
    source_candidate_key: null,
    source_updated_at: "2026-11-08T12:00:00.000Z",
    edited_at: "2026-11-08T12:00:00.000Z",
    is_manual: true,
  };

  const manualEditPatch = buildCandidateEditPayload(
    manualBaseline.id,
    {
      ...createInitialCandidateFormValues(manualBaseline, { mode: "edit" }),
      current_title: "Senior Automation Engineer",
      notes: "", // cleared from "Initial manual note" -> null
    },
    { baseline: manualBaseline },
  );
  assert.deepEqual(manualEditPatch, {
    current_title: "Senior Automation Engineer",
    notes: null,
  });

  // Tracker overlay edit: supports all 15 fields, wraps edits + tracker_source + tracker_row, and sends null on clear
  const trackerBaseline = {
    id: "submission:19",
    candidate_source: "submission",
    tracker_source: "tracker_submissions",
    candidate_source_id: "19",
    tracker_row: 31,
    candidate_name: "Submitted Candidate",
    current_title: "Plant Manager",
    current_company: "SteelWorks",
    location: "Hamilton, ON",
    industry: "Metals",
    shift: null,
    email: null,
    phone: null,
    compensation_target: null,
    current_compensation: null,
    compensation_context: "$160k / $145k",
    notes: "Imported submission note",
    profile_url: "https://example.com/in/submitted",
    role_context: "VP Operations",
    client_context: "Apex Metals",
    source_candidate_key: "sub-19",
    source_updated_at: "2026-11-08T12:00:00.000Z",
    edited_at: null,
    is_manual: false,
  };

  const trackerEditBody = buildCandidateEditPayload(
    trackerBaseline.id,
    {
      ...createInitialCandidateFormValues(trackerBaseline, { mode: "edit" }),
      compensation_context: "$165k target / $150k current",
      notes: "", // cleared to null
      profile_url: "https://example.com/in/submitted-updated",
    },
    { baseline: trackerBaseline },
  );

  assert.deepEqual(trackerEditBody, {
    edits: {
      compensation_context: "$165k target / $150k current",
      notes: null,
      profile_url: "https://example.com/in/submitted-updated",
    },
    tracker_source: "tracker_submissions",
    tracker_row: 31,
  });

  // Invalid profile_url scheme (non-http/https) fails Zod validation
  assert.throws(
    () => buildCandidateEditPayload("sourcing:2", { profile_url: "ftp://example.com/profile" }),
    (err) => err.code === "INVALID_INPUT" && Boolean(err.fieldErrors?.profile_url),
  );
});

test("create, edit, null-clear, and reload persistence work end-to-end against /api/candidates", async () => {
  const userToken = makeJwt({ sub: VALID_USER_UUID, role: "authenticated" });
  const client = createMockSupabaseClient({ accessToken: userToken });
  const requests = [];

  const serverRecords = new Map([
    [
      "sourcing:2",
      {
        id: "sourcing:2",
        candidate_source: "sourcing",
        tracker_source: "tracker_sourcing",
        candidate_source_id: "2",
        tracker_row: 11,
        candidate_name: "Sourced Person",
        current_title: "Maintenance Lead",
        current_company: "FabWorks",
        location: "Cambridge, ON",
        industry: "Manufacturing",
        shift: "Days",
        email: "sourced@example.invalid",
        phone: "555-0199",
        compensation_target: "$120k",
        current_compensation: "$110k",
        compensation_context: null,
        notes: "Imported sourcing note",
        profile_url: "https://example.com/in/sourced",
        role_context: "Maintenance Manager",
        client_context: null,
        source_candidate_key: "src-2",
        source_updated_at: "2026-11-08T10:00:00.000Z",
        edited_at: null,
        is_manual: false,
      },
    ],
  ]);

  async function mockFetch(urlInput, options = {}) {
    const url = new URL(urlInput);
    const method = (options.method || "GET").toUpperCase();
    const authHeader = options.headers?.Authorization || options.headers?.authorization || "";
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ method, pathname: url.pathname, search: url.search, authHeader, body });

    assert.equal(authHeader, `Bearer ${userToken}`);

    if (url.pathname === "/api/candidates" && method === "GET") {
      return jsonResponse(200, { candidates: [...serverRecords.values()] });
    }

    if (url.pathname === "/api/candidates" && method === "POST") {
      const created = {
        id: `manual:${MANUAL_RECORD_UUID}`,
        candidate_source: "manual",
        tracker_source: null,
        candidate_source_id: MANUAL_RECORD_UUID,
        tracker_row: null,
        candidate_name: body.candidate_name,
        current_title: body.current_title ?? null,
        current_company: body.current_company ?? null,
        location: body.location ?? null,
        industry: body.industry ?? null,
        shift: body.shift ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        compensation_target: body.compensation_target ?? null,
        current_compensation: body.current_compensation ?? null,
        compensation_context: null,
        notes: body.notes ?? null,
        profile_url: null,
        role_context: null,
        client_context: null,
        source_candidate_key: null,
        source_updated_at: "2026-11-08T15:00:00.000Z",
        edited_at: "2026-11-08T15:00:00.000Z",
        is_manual: true,
      };
      serverRecords.set(created.id, created);
      return jsonResponse(201, { candidate: created });
    }

    if (url.pathname.startsWith("/api/candidates/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/candidates/".length));
      const existing = serverRecords.get(id);
      if (!existing) {
        return jsonResponse(404, { error: { code: "CANDIDATE_NOT_FOUND", message: "Candidate was not found" } });
      }
      if (method === "GET") {
        return jsonResponse(200, { candidate: existing });
      }
      if (method === "PATCH") {
        const patch = body.edits || body;
        const updated = {
          ...existing,
          ...patch,
          edited_at: "2026-11-08T16:00:00.000Z",
        };
        serverRecords.set(id, updated);
        return jsonResponse(200, { candidate: updated });
      }
    }

    return jsonResponse(500, { error: { code: "UNEXPECTED", message: "Unexpected route" } });
  }

  // 1. Create a manual candidate
  const created = await createCandidate(
    {
      candidate_name: "  Dana Sterling ",
      current_title: "Director of Quality",
      current_company: "Precision Aero",
      location: "Guelph, ON",
      email: "DANA@EXAMPLE.INVALID",
      notes: "Met at manufacturing roundtable",
    },
    { client, fetchImpl: mockFetch, baseURL: "https://console.test" },
  );

  assert.equal(created.id, `manual:${MANUAL_RECORD_UUID}`);
  assert.equal(created.is_manual, true);
  assert.equal(created.candidate_name, "Dana Sterling");
  assert.equal(created.email, "dana@example.invalid");
  assert.equal(getCachedCandidateRecord(created.id)?.candidate_name, "Dana Sterling");

  // 2. Edit imported Tracker candidate (sourcing:2) with an updated title and null-cleared notes
  const baselineSourced = await getCandidateById("sourcing:2", {
    client,
    fetchImpl: mockFetch,
    baseURL: "https://console.test",
  });
  const editedOverlay = await updateCandidate(
    "sourcing:2",
    {
      ...createInitialCandidateFormValues(baselineSourced, { mode: "edit" }),
      current_title: "Reliability & Maintenance Manager",
      notes: "", // clears imported note to null
      client_context: "Maple Stamping",
    },
    {
      baseline: baselineSourced,
      clearedFields: ["notes"],
      client,
      fetchImpl: mockFetch,
      baseURL: "https://console.test",
    },
  );

  assert.equal(editedOverlay.current_title, "Reliability & Maintenance Manager");
  assert.equal(editedOverlay.notes, null);
  assert.equal(editedOverlay.client_context, "Maple Stamping");
  assert.equal(editedOverlay.location, "Cambridge, ON");

  // Verify the PATCH request body sent explicit null for notes and tracker provenance
  const patchReq = requests.find((r) => r.method === "PATCH" && r.pathname === "/api/candidates/sourcing%3A2");
  assert.ok(patchReq);
  assert.deepEqual(patchReq.body, {
    edits: {
      current_title: "Reliability & Maintenance Manager",
      notes: null,
      client_context: "Maple Stamping",
    },
    tracker_source: "tracker_sourcing",
    tracker_row: 11,
  });

  // 3. Simulate browser reload: clear in-memory store, then reload from /api/candidates
  _resetCandidateEditorStoreForTesting();
  assert.equal(getCachedCandidateRecord("sourcing:2"), null);
  assert.equal(getCachedCandidateRecord(`manual:${MANUAL_RECORD_UUID}`), null);

  const reloadedDirectory = await listCandidates({}, {
    client,
    fetchImpl: mockFetch,
    baseURL: "https://console.test",
  });
  assert.equal(reloadedDirectory.length, 2);

  // Merge onto a stale feed candidate (as happens when CandidateCard / PeopleView loads after reload)
  const staleFeedCandidate = {
    id: "sourcing:2",
    name: "Sourced Person",
    title: "Maintenance Lead",
    employer: "FabWorks",
    location: "Cambridge, ON",
    additionalNotes: "Imported sourcing note",
    stage: "Shortlist",
    activityTrail: [],
  };

  const mergedList = mergeCandidatesWithDirectory([staleFeedCandidate], reloadedDirectory);
  assert.equal(mergedList.length, 2);

  const reloadedSourced = mergedList.find((c) => c.id === "sourcing:2");
  assert.equal(reloadedSourced.title, "Reliability & Maintenance Manager");
  assert.equal(reloadedSourced.notes, null);
  assert.equal(reloadedSourced.additionalNotes, "");
  assert.equal(reloadedSourced.client_context, "Maple Stamping");
  assert.equal(reloadedSourced.stage, "Shortlist");

  const reloadedManual = mergedList.find((c) => c.id === `manual:${MANUAL_RECORD_UUID}`);
  assert.ok(reloadedManual);
  assert.equal(reloadedManual.name, "Dana Sterling");
  assert.equal(reloadedManual.is_manual, true);
  assert.equal(reloadedManual.stage, "Manual");

  const cardCandidateAfterReload = applyCandidateRecordToUiCandidate(
    staleFeedCandidate,
    getCachedCandidateRecord("sourcing:2"),
  );
  assert.equal(cardCandidateAfterReload.title, "Reliability & Maintenance Manager");
  assert.equal(cardCandidateAfterReload.notes, null);
});

test("candidate directory loads past the first 500 records without silent truncation", async () => {
  const client = createMockSupabaseClient();
  const records = Array.from({ length: 501 }, (_, index) => ({
    id: `sourcing:${index + 1}`,
    candidate_source: "sourcing",
    tracker_source: "tracker_sourcing",
    candidate_source_id: String(index + 1),
    tracker_row: index + 1,
    candidate_name: `Synthetic Candidate ${index + 1}`,
    current_title: null,
    current_company: null,
    location: null,
    industry: null,
    shift: null,
    email: null,
    phone: null,
    compensation_target: null,
    current_compensation: null,
    compensation_context: null,
    notes: null,
    profile_url: null,
    role_context: null,
    client_context: null,
    source_candidate_key: null,
    source_updated_at: null,
    edited_at: null,
    is_manual: false,
  }));
  const offsets = [];
  const fetchImpl = async (urlInput) => {
    const url = new URL(urlInput);
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 500);
    offsets.push(offset);
    return jsonResponse(200, { candidates: records.slice(offset, offset + limit) });
  };
  const loaded = await loadCandidateDirectory({ client, fetchImpl, baseURL: "https://console.test" });
  assert.equal(loaded.length, 501);
  assert.deepEqual(offsets, [0, 500]);
  assert.equal(getCachedCandidateRecord("sourcing:501")?.candidate_name, "Synthetic Candidate 501");

  const nextOwner = "22222222-2222-4222-8222-222222222222";
  await getSupabaseCandidateAccessToken({
    client: createMockSupabaseClient({
      userId: nextOwner,
      accessToken: makeJwt({ sub: nextOwner, role: "authenticated" }),
    }),
  });
  assert.equal(getCachedCandidateRecord("sourcing:501"), null);
});

test("CandidateEditorDialog, CandidateCard, and PeopleView wire accessible add/edit controls and provenance", () => {
  const dialogSource = fs.readFileSync(path.join(featureDir, "CandidateEditorDialog.jsx"), "utf8");
  const cardSource = fs.readFileSync(path.join(featureDir, "CandidateCard.jsx"), "utf8");
  const peopleSource = fs.readFileSync(path.join(featureDir, "PeopleView.jsx"), "utf8");

  // Dialog accessibility, provenance, loading/error states, and null-clear controls
  assert.match(dialogSource, /data-testid="candidate-editor-dialog"/);
  assert.match(dialogSource, /data-testid="candidate-editor-form"/);
  assert.match(dialogSource, /data-testid="candidate-provenance-badge"/);
  assert.match(dialogSource, /data-testid="candidate-editor-loading"/);
  assert.match(dialogSource, /data-testid="candidate-editor-error"/);
  assert.match(dialogSource, /data-testid=\{`clear-field-\$\{field\.key\}`\}/);
  assert.match(dialogSource, /data-testid=\{`null-indicator-\$\{field\.key\}`\}/);
  assert.match(dialogSource, /htmlFor=\{inputId\}/);

  // CandidateCard wires Edit candidate, Add candidate, provenance badge, and CandidateEditorDialog
  assert.match(cardSource, /data-testid="card-edit-candidate-button"/);
  assert.match(cardSource, /data-testid="card-add-candidate-button"/);
  assert.match(cardSource, /data-testid="card-provenance-badge"/);
  assert.match(cardSource, /data-testid="card-candidate-save-status"/);
  assert.match(cardSource, /<CandidateEditorDialog/);

  // PeopleView wires Add candidate, per-row Edit button, directory loading/error, and CandidateEditorDialog
  assert.match(peopleSource, /data-testid="people-add-candidate-button"/);
  assert.match(peopleSource, /data-testid=\{`people-edit-candidate-\$\{candidate\.id\}`\}/);
  assert.match(peopleSource, /data-testid="people-provenance-badge"/);
  assert.match(peopleSource, /data-testid="candidates-directory-loading"/);
  assert.match(peopleSource, /data-testid="candidates-directory-error"/);
  assert.match(peopleSource, /data-testid="people-candidate-save-status"/);
  assert.match(peopleSource, /<CandidateEditorDialog/);
});
