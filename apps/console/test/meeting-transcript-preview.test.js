import assert from "node:assert/strict";
import test from "node:test";
import { loadMeetingTranscriptPreview, meetingIdFromOriginKey } from "../src/features/notes/meetingTranscriptPreview.js";

const MEETING = "44444444-4444-4444-8444-444444444444";
const OWNER = "11111111-1111-4111-8111-111111111111";
const originKey = `meeting_draft:${MEETING}`;

function clientFor(row, { userId = OWNER, error = null } = {}) {
  const calls = [];
  const query = {
    select(columns) { calls.push(["select", columns]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    async maybeSingle() { return { data: row, error }; },
  };
  return {
    calls,
    auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null }, error: null }) },
    from(table) { calls.push(["from", table]); return query; },
  };
}

test("preview reads the current transcript only for its owner and exact candidate source key", async () => {
  const client = clientFor({
    id: MEETING,
    owner_id: OWNER,
    candidate_source: "sourcing",
    candidate_source_id: 12,
    transcript: "Verbatim call transcript",
  });
  assert.equal(meetingIdFromOriginKey(originKey), MEETING);
  assert.deepEqual(await loadMeetingTranscriptPreview({ originKey, candidateId: "sourcing:12", client }), {
    status: "available", transcript: "Verbatim call transcript",
  });
  assert.deepEqual(client.calls, [
    ["from", "meeting_drafts"],
    ["select", "id,owner_id,candidate_source,candidate_source_id,transcript"],
    ["eq", "id", MEETING],
  ]);
  assert.equal((await loadMeetingTranscriptPreview({ originKey, candidateId: "submission:12", client })).status, "unavailable");
  assert.equal((await loadMeetingTranscriptPreview({ originKey, candidateId: "sourcing:12", client: clientFor({
    id: MEETING, owner_id: "22222222-2222-4222-8222-222222222222",
    candidate_source: "sourcing", candidate_source_id: 12, transcript: "Private",
  }) })).status, "unavailable");
});

test("preview removes transcript text when the RLS row is absent or retention clears it", async () => {
  assert.equal((await loadMeetingTranscriptPreview({
    originKey, candidateId: "sourcing:12", client: clientFor(null),
  })).transcript, null);
  assert.deepEqual(await loadMeetingTranscriptPreview({
    originKey, candidateId: "sourcing:12", client: clientFor({
      id: MEETING, owner_id: OWNER, candidate_source: "sourcing", candidate_source_id: 12, transcript: "",
    }),
  }), { status: "unavailable", transcript: null });
  const noSession = clientFor(null, { userId: null });
  assert.equal((await loadMeetingTranscriptPreview({ originKey, candidateId: "sourcing:12", client: noSession })).status, "unavailable");
  assert.deepEqual(noSession.calls, []);
  assert.equal(meetingIdFromOriginKey("meeting_draft:not-a-uuid"), null);
});
