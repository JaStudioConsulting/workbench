import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMeetingDraft, groupCalendarEvents, safeJoinUrl } from "../src/features/meetings/meetingModel.js";
import { transcribeMeetingAudio } from "../src/features/meetings/meetingGatewayClient.js";

function event(title, value, joinUrl = null) {
  return {
    title,
    start: { kind: "dateTime", value },
    end: { kind: "dateTime", value: new Date(new Date(value).getTime() + 30 * 60 * 1000).toISOString() },
    allDay: false,
    joinUrl,
  };
}

test("meeting links allow supported providers and reject arbitrary URLs", () => {
  assert.equal(safeJoinUrl("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
  assert.equal(safeJoinUrl("https://company.zoom.us/j/123"), "https://company.zoom.us/j/123");
  assert.equal(safeJoinUrl("https://evil.example/meeting"), null);
  assert.equal(safeJoinUrl("javascript:alert(1)"), null);
});

test("calendar events group into today, upcoming, and past", () => {
  const now = new Date(2026, 10, 2, 12, 0, 0);
  const grouped = groupCalendarEvents([
    event("Past", "2026-11-01T15:00:00.000Z"),
    event("Today", "2026-11-02T18:00:00.000Z"),
    event("Upcoming", "2026-11-03T15:00:00.000Z"),
  ], now);
  assert.deepEqual(grouped.past.map((item) => item.title), ["Past"]);
  assert.deepEqual(grouped.today.map((item) => item.title), ["Today"]);
  assert.deepEqual(grouped.upcoming.map((item) => item.title), ["Upcoming"]);
});

test("meeting draft never invents a transcript", () => {
  const draft = createMeetingDraft({
    event: event("Candidate call", "2026-11-02T18:00:00.000Z"),
    candidate: { label: "Candidate Example" },
    job: { label: "Robotics role" },
  });
  assert.equal(draft.transcript, "");
  assert.equal(draft.notes, "");
  assert.equal(draft.transcriptStatus, "awaiting_transcription");
  assert.equal(draft.candidate.label, "Candidate Example");
  assert.equal(draft.job.label, "Robotics role");
});

test("browser audio is sent only to the authenticated Workbench gateway", async () => {
  let request;
  const result = await transcribeMeetingAudio(new Blob(["audio"], { type: "audio/webm" }), {
    baseURL: "https://gateway.example.invalid",
    fetchImpl: async (url, options) => {
      request = { url: url.toString(), options };
      return { ok: true, json: async () => ({ transcript: "Source audio words.", source: "muesli_cli" }) };
    },
  });
  assert.deepEqual(result, { transcript: "Source audio words.", source: "muesli_cli" });
  assert.equal(request.url, "https://gateway.example.invalid/api/meetings/transcribe");
  assert.equal(request.options.credentials, "include");
  assert.equal(request.options.headers["Content-Type"], "audio/webm");
});

test("Meetings workspace uses browser recording and the existing Calendar client", async () => {
  const [workspace, recorder, app] = await Promise.all([
    readFile(new URL("../src/features/meetings/MeetingsWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/meetings/browserRecorder.js", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /getUpcomingGoogleCalendar/);
  assert.match(workspace, /Today/);
  assert.match(workspace, /Upcoming/);
  assert.match(workspace, /Past/);
  assert.match(workspace, /Save meeting draft/);
  assert.match(workspace, /adapter\.transcribe\(blob\)/);
  assert.match(recorder, /getUserMedia/);
  assert.match(recorder, /getDisplayMedia/);
  assert.match(recorder, /MediaRecorderImpl/);
  assert.match(app, /\["Meetings", CalendarDays\]/);
});
