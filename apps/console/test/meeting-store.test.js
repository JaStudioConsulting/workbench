import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingDraft } from "../src/features/meetings/meetingModel.js";
import { listRecentMeetings, saveMeetingDraft } from "../src/features/meetings/meetingStore.js";

function meetingDatabase({ writeError = null, readError = null, loseFirstResponse = false } = {}) {
  const rows = new Map();
  const writes = [];
  let lostResponse = false;
  return {
    rows, writes,
    client: {
      from(table) {
        assert.equal(table, "meeting_drafts");
        return {
          upsert(payload, options) {
            assert.deepEqual(options, { onConflict: "id" });
            writes.push(structuredClone(payload));
            return { select() { return this; }, async single() {
              if (writeError) return { data: null, error: writeError };
              const row = { created_at: "2026-11-14T14:00:00Z", ...rows.get(payload.id), ...structuredClone(payload) };
              rows.set(row.id, row);
              if (loseFirstResponse && !lostResponse) {
                lostResponse = true;
                return { data: null, error: { code: "NETWORK_ERROR" } };
              }
              return { data: structuredClone(row), error: null };
            } };
          },
          select() { return this; }, order() { return this; },
          async limit(count) { return { data: [...rows.values()].slice(0, count).map((row) => structuredClone(row)), error: readError }; },
        };
      },
    },
  };
}

test("notes-only meeting saves and reloads without candidate, job, or invented transcript", async () => {
  const db = meetingDatabase();
  const draft = createMeetingDraft({ notes: "Ask about interview availability." });
  const result = await saveMeetingDraft({ draft }, { client: db.client });
  assert.equal(result.persistence, "durable");
  assert.equal(result.draft.id, draft.idempotencyKey);
  assert.equal(result.draft.candidateId, null);
  assert.equal(result.draft.jobId, null);
  assert.equal(result.draft.transcript, "");
  assert.equal(result.draft.transcriptionStatus, "disabled");
  assert.equal(result.draft.transcriptStatus, "awaiting_input");
  const [reloaded] = await listRecentMeetings({ client: db.client });
  assert.deepEqual(reloaded, result.draft);
  assert.equal(db.writes[0].candidate_source_id, null);
});

test("manual UUID meeting identity survives save and reload without numeric coercion", async () => {
  const db = meetingDatabase();
  const candidateId = "manual:11111111-1111-4111-8111-111111111111";
  const draft = createMeetingDraft({ candidate: { id: candidateId }, notes: "Candidate confirmed availability." });
  const result = await saveMeetingDraft({ draft }, { client: db.client });
  const [reloaded] = await listRecentMeetings({ client: db.client });
  assert.equal(result.draft.candidateId, candidateId);
  assert.equal(reloaded.candidateId, candidateId);
  assert.equal(reloaded.jobId, null);
  assert.equal(db.writes[0].candidate_id, candidateId);
  assert.equal(db.writes[0].candidate_source, null);
  assert.equal(db.writes[0].candidate_source_id, null);
});

test("imported candidate identities keep compatible legacy columns only where supported", async () => {
  for (const [candidateId, source, sourceId] of [["sourcing:7", "sourcing", 7], ["submission:8", "submission", 8], ["tracker_candidates:9", null, null]]) {
    const db = meetingDatabase();
    const draft = createMeetingDraft({ transcript: "Verbatim supplied transcript." });
    const result = await saveMeetingDraft({ draft, candidate: { id: candidateId }, job: { id: "42" } }, { client: db.client });
    assert.equal(result.draft.candidateId, candidateId);
    assert.equal(result.draft.jobId, "42");
    assert.equal(db.writes[0].candidate_source, source);
    assert.equal(db.writes[0].candidate_source_id, sourceId);
    assert.equal(result.draft.transcript, "Verbatim supplied transcript.");
    assert.equal(result.draft.transcriptionStatus, "ready");
  }
});

test("recording-only meeting persists its audio reference with transcription disabled", async () => {
  const db = meetingDatabase();
  const draft = createMeetingDraft({ recording: { id: "browser-recording-1", status: "captured", source: "browser" } });
  const result = await saveMeetingDraft({ draft }, { client: db.client });
  assert.equal(result.draft.recordingId, "browser-recording-1");
  assert.equal(result.draft.captureStatus, "captured");
  assert.equal(result.draft.transcriptionStatus, "disabled");
  assert.equal(result.draft.transcript, "");
});

test("retry after a lost save response updates the same meeting rather than duplicating it", async () => {
  const db = meetingDatabase({ loseFirstResponse: true });
  const draft = createMeetingDraft({ notes: "Source notes." });
  await assert.rejects(saveMeetingDraft({ draft }, { client: db.client }), /could not be persisted/);
  const result = await saveMeetingDraft({ draft }, { client: db.client });
  assert.equal(db.rows.size, 1);
  assert.equal(result.draft.id, draft.idempotencyKey);
  assert.deepEqual(db.writes.map((row) => row.id), [draft.idempotencyKey, draft.idempotencyKey]);
});

test("invalid identities and empty meetings fail before persistence", async () => {
  const db = meetingDatabase();
  const draft = createMeetingDraft({ notes: "Source notes." });
  await assert.rejects(saveMeetingDraft({ draft, candidate: { id: "manual:7" } }, { client: db.client }), /valid candidate/);
  await assert.rejects(saveMeetingDraft({ draft, job: { id: "job-7" } }, { client: db.client }), /valid job/);
  await assert.rejects(saveMeetingDraft({ draft: { ...draft, idempotencyKey: "not-a-uuid" } }, { client: db.client }), /valid save identifier/);
  await assert.rejects(saveMeetingDraft({ draft: createMeetingDraft() }, { client: db.client }), /recording, transcript, or meeting notes/);
  assert.equal(db.writes.length, 0);
});

test("database failures never become session-only success or an empty saved-meeting list", async () => {
  const db = meetingDatabase({ writeError: { code: "42P01" }, readError: { code: "PGRST205" } });
  await assert.rejects(saveMeetingDraft({ draft: createMeetingDraft({ notes: "Keep this draft." }) }, { client: db.client }), /could not be persisted/);
  await assert.rejects(listRecentMeetings({ client: db.client }), /could not be loaded/);
});
