import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";
import { makeCandidateNotes } from "../src/features/meetings/afterCallClient.js";
import { createMeetingDraft, groupCalendarEvents, safeJoinUrl } from "../src/features/meetings/meetingModel.js";
import { transcribeMeetingAudio } from "../src/features/meetings/meetingGatewayClient.js";
import { encodePcm16Wav, meetingRecordingFilename, selectWorkbenchRecordingFormat, startBrowserRecording } from "../src/features/meetings/browserRecorder.js";
import { meetingPrintHtml } from "../src/features/meetings/meetingExport.js";
import { MEETING_TEMPLATES, renderMeetingTemplate } from "../src/features/meetings/meetingTemplates.js";

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
      return { ok: true, json: async () => ({ transcript: "Source audio words.", source: "workbench_native" }) };
    },
  });
  assert.deepEqual(result, { transcript: "Source audio words.", source: "workbench_native" });
  assert.equal(request.url, "https://gateway.example.invalid/api/meetings/transcribe");
  assert.equal(request.options.credentials, "include");
  assert.equal(request.options.headers["Content-Type"], "audio/mp4");
});

test("meeting recorder prefers Workbench-compatible MP4 and never selects WebM", () => {
  const checked = [];
  const format = selectWorkbenchRecordingFormat({
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

test("recruiter templates use transcript sentences and mark absent topics", () => {
  assert.deepEqual(MEETING_TEMPLATES.map((item) => item.label), ["Candidate screen", "Client intake", "Reference check"]);
  const result = renderMeetingTemplate("candidate_screen", "I am looking because the plant closed. My salary is 90000. I can interview Monday.");
  assert.match(result.sections.find((section) => section.heading === "Motivation").content, /plant closed/);
  assert.equal(result.sections.find((section) => section.heading === "Experience").content, "Not discussed");
  assert.match(result.markdown, /## Compensation and vacation/);
});

test("meeting print export is clean black Arial HTML", () => {
  const template = renderMeetingTemplate("reference_check", "I would rehire them.");
  const html = meetingPrintHtml({ title: "Reference check", template });
  assert.match(html, /font-family:Arial/);
  assert.match(html, /color:#000/);
  assert.doesNotMatch(html, /gradient/i);
  assert.match(html, /I would rehire them\./);
});

test("candidate notes call the existing after-call workflow then save a write-up draft", async () => {
  let request;
  let saved;
  const result = await makeCandidateNotes({
    job: { id: "42", title: "Maintenance Manager", company: "Source company", location: "Ontario" },
    candidate: { id: "sourcing:7", name: "Candidate Example", title: "Supervisor", profileSummary: "Maintenance leadership" },
    transcript: "Candidate stated a two week notice period.",
  }, {
    baseURL: "https://gateway.example.invalid",
    fetchImpl: async (url, options) => {
      request = { url: url.toString(), options };
      return { ok: true, json: async () => ({ loxoDraft: { bullets: ["Meeting transcript: Candidate stated a two week notice period."] } }) };
    },
    createDraft: async (input) => { saved = input; return { id: "draft-1" }; },
  });
  assert.equal(new URL(request.url).pathname, "/api/workflows/after-call/prepare");
  assert.equal(request.options.credentials, "include");
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.verifiedFacts[0].source, "transcript");
  assert.equal(saved.kind, "write_up");
  assert.match(saved.body, /two week notice period/);
  assert.equal(result.draft.id, "draft-1");
});

test("meetings workspace compiles and uses live selectors, templates, exports, and durable store fallback", async () => {
  const [workspace, store, migration] = await Promise.all([
    readFile(new URL("../src/features/meetings/MeetingsWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/meetings/meetingStore.js", import.meta.url), "utf8"),
    readFile(new URL("../../gateway/migrations/003_meeting_drafts.sql", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /loadLiveReviewJobs/);
  assert.match(workspace, /loadLiveCandidatesForJob/);
  assert.match(workspace, /Make candidate notes/);
  assert.match(workspace, /Download Markdown/);
  assert.match(workspace, /Print or save PDF/);
  assert.match(store, /export async function listRecentMeetings/);
  assert.match(store, /session_only/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /auth\.uid\(\) = owner_id/);
  const compiled = await transformWithEsbuild(workspace, "MeetingsWorkspace.jsx", { loader: "jsx", jsx: "automatic" });
  assert.match(compiled.code, /function MeetingsWorkspace/);
});
