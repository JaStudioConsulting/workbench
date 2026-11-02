import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMeetingDraft, groupCalendarEvents, safeJoinUrl } from "../src/features/meetings/meetingModel.js";
import { transcribeMeetingAudio } from "../src/features/meetings/meetingGatewayClient.js";
import { encodePcm16Wav, meetingRecordingFilename, selectMuesliRecordingFormat, startBrowserRecording } from "../src/features/meetings/browserRecorder.js";

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
  const result = await transcribeMeetingAudio(new Blob(["audio"], { type: "audio/mp4" }), {
    baseURL: "https://gateway.example.invalid",
    fetchImpl: async (url, options) => {
      request = { url: url.toString(), options };
      return { ok: true, json: async () => ({ transcript: "Source audio words.", source: "muesli_cli" }) };
    },
  });
  assert.deepEqual(result, { transcript: "Source audio words.", source: "muesli_cli" });
  assert.equal(request.url, "https://gateway.example.invalid/api/meetings/transcribe");
  assert.equal(request.options.credentials, "include");
  assert.equal(request.options.headers["Content-Type"], "audio/mp4");
});

test("meeting recorder prefers Muesli-compatible MP4 and never selects WebM", () => {
  const checked = [];
  const format = selectMuesliRecordingFormat({
    isTypeSupported(type) {
      checked.push(type);
      return type === "audio/mp4" || type === "audio/webm";
    },
  });
  assert.deepEqual(format, { mimeType: "audio/mp4", extension: "m4a" });
  assert.equal(checked.includes("audio/webm"), false);
  assert.equal(meetingRecordingFilename(new Blob(["audio"], { type: "audio/mp4" })), "meeting-recording.m4a");
  assert.throws(() => meetingRecordingFilename(new Blob(["audio"], { type: "audio/webm" })), /not supported/i);
});

test("WAV fallback emits a valid PCM file accepted by local transcription", async () => {
  const wav = encodePcm16Wav([new Float32Array([-1, 0, 1])], 48_000);
  const bytes = new Uint8Array(await wav.arrayBuffer());
  assert.equal(wav.type, "audio/wav");
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  assert.equal(bytes.length, 50);
});

test("gateway client rejects WebM before making a transcription request", async () => {
  let calls = 0;
  await assert.rejects(() => transcribeMeetingAudio(new Blob(["audio"], { type: "audio/webm" }), {
    fetchImpl: async () => { calls += 1; },
  }), /MP4, MP3, or WAV/);
  assert.equal(calls, 0);
});

test("unsupported browsers fail before requesting microphone access", async () => {
  let microphoneRequests = 0;
  await assert.rejects(() => startBrowserRecording({
    mediaDevices: { getUserMedia: async () => { microphoneRequests += 1; } },
    MediaRecorderImpl: { isTypeSupported: (type) => type === "audio/webm" },
    MediaStreamImpl: class {},
    AudioContextImpl: null,
  }), /cannot create MP4, MP3, or WAV/);
  assert.equal(microphoneRequests, 0);
});

test("browser recording falls back to PCM WAV when MP4 is unavailable", async () => {
  let processor;
  let stopped = false;
  const track = { stop() { stopped = true; } };
  const microphone = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  class FakeAudioContext {
    constructor() { this.sampleRate = 48_000; this.destination = {}; }
    createScriptProcessor() {
      processor = { onaudioprocess: null, connect() {}, disconnect() {} };
      return processor;
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async resume() {}
    async close() {}
  }
  const recording = await startBrowserRecording({
    mediaDevices: { getUserMedia: async () => microphone },
    MediaRecorderImpl: { isTypeSupported: () => false },
    MediaStreamImpl: class {},
    AudioContextImpl: FakeAudioContext,
  });
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([0, 0.5]) } });
  const blob = await recording.stop();
  assert.equal(blob.type, "audio/wav");
  assert.equal(meetingRecordingFilename(blob), "meeting-recording.wav");
  assert.equal(stopped, true);
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
