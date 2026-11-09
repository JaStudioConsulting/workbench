import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";
import { makeCandidateNotes } from "../src/features/meetings/afterCallClient.js";
import { createMeetingDraft, formatSpeakerTranscript, groupCalendarEvents, isMeetingContextLocked, safeJoinUrl } from "../src/features/meetings/meetingModel.js";
import { getMeetingStatus, startNativeMeetingCapture, stopNativeMeetingCapture, transcribeMeetingAudio } from "../src/features/meetings/meetingGatewayClient.js";
import { discardRecordingArchive, encodePcm16Wav, isSecureRecordingContext, listInterruptedRecordings, meetingCaptureState, meetingRecordingErrorMessage, meetingRecordingFilename, openRecordingArchive, recoverBrowserRecording, selectWorkbenchRecordingFormat, startBrowserRecording } from "../src/features/meetings/browserRecorder.js";
import { meetingPrintHtml } from "../src/features/meetings/meetingExport.js";
import { MEETING_TEMPLATES, renderMeetingTemplate } from "../src/features/meetings/meetingTemplates.js";
import { candidateCallHref, startCandidateCallSession } from "../src/features/meetings/candidateCallSession.js";
import { saveMeetingAndReleaseArchive } from "../src/features/meetings/meetingRetention.js";

test("recoverable audio survives failed and session-only saves until durable save succeeds", async () => {
  const archive = new Map([["recording-1", "recoverable audio"]]);
  const discardArchive = async (id) => { archive.delete(id); };
  const attempt = (saveDraft) => saveMeetingAndReleaseArchive({ saveDraft, discardArchive, recordingId: "recording-1" });
  await assert.rejects(() => attempt(async () => { throw new Error("offline"); }), /offline/);
  assert.equal(archive.get("recording-1"), "recoverable audio");
  await attempt(async () => ({ ok: true, persistence: "session_only", draft: { id: "local" } }));
  assert.equal(archive.get("recording-1"), "recoverable audio");
  await attempt(async () => ({ ok: true, persistence: "durable", draft: { id: "notes-only", transcript: "" } }));
  assert.equal(archive.get("recording-1"), "recoverable audio");
  await attempt(async () => ({ ok: true, persistence: "durable", draft: { id: "saved", transcript: "Speaker: Source words." } }));
  assert.equal(archive.has("recording-1"), false);
});

test("archive cleanup failure logs the error and keeps the durable draft", async () => {
  const cleanupError = new Error("storage unavailable");
  const logged = [];
  const result = await saveMeetingAndReleaseArchive({
    saveDraft: async () => ({ ok: true, persistence: "durable", draft: { id: "saved", transcript: "Source words." } }),
    discardArchive: async () => { throw cleanupError; },
    recordingId: "recording-1",
    logger: { error: (message, details) => logged.push({ message, details }) },
  });
  assert.equal(result.draft.id, "saved");
  assert.equal(result.archiveRetained, true);
  assert.equal(logged.length, 1);
  assert.match(logged[0].message, /cleanup failed/);
  assert.equal(logged[0].details.recordingId, "recording-1");
  assert.equal(logged[0].details.error, cleanupError);
});

test("browser archive deletion reports storage failure to the retention boundary", async () => {
  await assert.rejects(
    () => discardRecordingArchive("recording-1", { indexedDBImpl: { open: () => { throw new Error("disk failure"); } } }),
    /disk failure/,
  );
});

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
  assert.deepEqual(draft.segments, []);
  assert.deepEqual(draft.speakers, []);
});

test("meeting draft preserves native capture and speaker metadata", () => {
  const draft = createMeetingDraft({
    candidate: { id: "sourcing:7", label: "Candidate Example" },
    job: { id: "4", label: "Maintenance Manager" },
    transcript: "Ja: Hello\nCandidate: Hi",
    recording: { id: "recording-1", source: "workbench_native", status: "recovered", warning: "Recovered after restart." },
    segments: [{ start: 0, end: 1, text: "Hello", speaker: "Speaker 1", source: "microphone" }],
    speakers: ["Speaker 1", "Speaker 2", "Speaker 3"],
    speakerLabels: { "Speaker 1": "Ja" },
  });
  assert.equal(draft.recordingId, "recording-1");
  assert.equal(draft.captureStatus, "recovered");
  assert.equal(draft.speakers.length, 3);
  assert.equal(draft.speakerLabels["Speaker 1"], "Ja");
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

test("meeting helper status stays honest and exposes only availability", async () => {
  const available = await getMeetingStatus({
    baseURL: "https://gateway.example.invalid",
    fetchImpl: async () => ({ ok: true, json: async () => ({ available: true, enhanced: true, captureAvailable: true, internalPath: "/private/helper" }) }),
  });
  assert.deepEqual(available, { available: true, enhanced: true, captureAvailable: true });
  const unavailable = await getMeetingStatus({ fetchImpl: async () => { throw new Error("offline"); } });
  assert.deepEqual(unavailable, { available: false, enhanced: false, captureAvailable: false });
});

test("native capture client attaches context and returns the durable recording", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: url.toString(), options });
    if (url.toString().endsWith("/start")) return { ok: true, json: async () => ({ capture: { id: "capture-1", usedSystemAudio: true } }) };
    return { ok: true, json: async () => ({
      capture: { id: "capture-1", status: "captured", audioUrl: "/api/meetings/capture/capture-1/audio" },
      transcription: { status: "ready", source: "workbench_native" }, transcript: "You: Hello", segments: [], speakers: ["You"],
    }) };
  };
  const recording = await startNativeMeetingCapture({ jobId: "job-4", candidateId: "person-9" }, { fetchImpl, baseURL: "https://gateway.example.invalid" });
  const stopped = await recording.stop();
  assert.deepEqual(JSON.parse(requests[0].options.body), { jobId: "job-4", candidateId: "person-9" });
  assert.match(requests[1].url, /capture\/capture-1\/stop$/);
  assert.equal(stopped.capture.audioUrl, "https://gateway.example.invalid/api/meetings/capture/capture-1/audio");
  assert.equal(stopped.transcript, "You: Hello");
  assert.equal((await stopNativeMeetingCapture("capture-1", { fetchImpl, baseURL: "https://gateway.example.invalid" })).capture.id, "capture-1");
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

test("a browser WAV recording is transferred to the authenticated M1 transcription route", async () => {
  let request;
  const wav = encodePcm16Wav([new Float32Array([0, 0.25, -0.25])], 16_000);
  const result = await transcribeMeetingAudio(wav, {
    baseURL: "https://workbench.example.invalid",
    fetchImpl: async (url, options) => {
      request = { url: url.toString(), options };
      return { ok: true, json: async () => ({ transcript: "Speaker 1: Hello", source: "workbench_native", segments: [], speakers: ["Speaker 1"] }) };
    },
  });
  assert.equal(request.url, "https://workbench.example.invalid/api/meetings/transcribe");
  assert.equal(request.options.headers["Content-Type"], "audio/wav");
  assert.equal(request.options.body, wav);
  assert.equal(result.transcript, "Speaker 1: Hello");
});

test("persisted recording chunks survive a recorder interruption and can be recovered", async () => {
  const indexedDBImpl = new FakeIndexedDB();
  const meta = {
    id: "recording-recovery-1",
    status: "recording",
    format: "wav",
    mimeType: "audio/wav",
    sampleRate: 16_000,
    startedAt: "2026-11-07T12:00:00.000Z",
    jobId: "job-4",
    candidateId: "person-9",
    jobTitle: "Maintenance Manager",
    candidateName: "Candidate Example",
    source: "candidate_call",
    captureMode: "microphone",
    twoSided: false,
    warning: "Microphone only.",
  };
  const { archive, warning } = await openRecordingArchive({ indexedDBImpl, meta });
  assert.equal(warning, null);
  await archive.append(0, new Blob([new Uint8Array([1, 0, 2, 0])]));
  await archive.append(1, new Blob([new Uint8Array([3, 0, 4, 0])]));
  await archive.finish({ status: "complete" });
  const listed = await listInterruptedRecordings({ indexedDBImpl });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].jobId, "job-4");
  const recovered = await recoverBrowserRecording(meta.id, { indexedDBImpl });
  assert.equal(recovered.meta.candidateId, "person-9");
  assert.equal(recovered.blob.type, "audio/wav");
  assert.equal(recovered.blob.size, 52);
  await discardRecordingArchive(meta.id, { indexedDBImpl });
  assert.deepEqual(await listInterruptedRecordings({ indexedDBImpl }), []);
});

test("candidate Call starts recording before handing the number to the OS dialer", async () => {
  const sequence = [];
  const recording = { stop() {} };
  const session = await startCandidateCallSession({
    job: { id: "job-4", title: "Maintenance Manager" },
    candidate: { id: "person-9", name: "Candidate Example", phone: "+1 416 555 0100" },
    startRecording: async (options) => { sequence.push(["record", options]); return recording; },
    dial: (href) => sequence.push(["dial", href]),
  });
  assert.equal(candidateCallHref("+1 416 555 0100"), "tel:+14165550100");
  assert.deepEqual(sequence, [["record", { jobId: "job-4", candidateId: "person-9", jobTitle: "Maintenance Manager", candidateName: "Candidate Example", source: "candidate_call", includeSharedAudio: false }], ["dial", "tel:+14165550100"]]);
  assert.equal(session.recording, recording);
  assert.equal(session.job.id, "job-4");
  assert.equal(session.candidate.id, "person-9");
});

test("candidate Call is not placed when recorder permission fails", async () => {
  let dialled = false;
  await assert.rejects(() => startCandidateCallSession({
    job: { id: "job-4" },
    candidate: { id: "person-9", phone: "+14165550100" },
    startRecording: async () => { throw new Error("Microphone denied"); },
    dial: () => { dialled = true; },
  }), /Microphone denied/);
  assert.equal(dialled, false);
});

test("job and candidate context stays locked through every native capture phase", () => {
  assert.equal(isMeetingContextLocked({ recording: { id: "capture-1" } }), true);
  assert.equal(isMeetingContextLocked({ transcribing: true }), true);
  assert.equal(isMeetingContextLocked({ launchContext: { phase: "finalizing" } }), true);
  assert.equal(isMeetingContextLocked({ launchContext: { phase: "ready" } }), false);
});

test("recording failures give a direct recovery step", () => {
  assert.equal(
    meetingRecordingErrorMessage({ name: "NotAllowedError" }),
    "Microphone permission is blocked. Allow microphone access for Workbench, then try again.",
  );
  assert.match(meetingRecordingErrorMessage({ name: "NotReadableError" }), /already in use/);
  assert.match(meetingRecordingErrorMessage({ message: "The user declined TCCs for application, window, display capture" }), /Screen & System Audio Recording/);
});

test("meeting speaker labels rewrite the saved transcript from source segments", () => {
  const segments = [
    { start: 0, end: 1, text: "Tell me about the plant.", speaker: "Speaker 1" },
    { start: 1, end: 2, text: "It closed last month.", speaker: "Speaker 2" },
  ];
  assert.equal(
    formatSpeakerTranscript(segments, { "Speaker 1": "Ja", "Speaker 2": "Candidate" }),
    "Ja: Tell me about the plant.\nCandidate: It closed last month.",
  );
});

test("browser capture is honest about one-sided microphone recording", () => {
  assert.match(meetingCaptureState({ twoSided: false }), /microphone only/);
  assert.match(meetingCaptureState({ twoSided: false }), /not captured/);
  assert.match(meetingCaptureState({ twoSided: true }), /shared call audio/);
  assert.equal(isSecureRecordingContext(undefined), true);
  assert.equal(isSecureRecordingContext(false), false);
});

test("browser recording refuses an insecure origin before requesting the microphone", async () => {
  let microphoneRequests = 0;
  await assert.rejects(() => startBrowserRecording({
    secureContext: false,
    mediaDevices: { getUserMedia: async () => { microphoneRequests += 1; } },
  }), /secure Workbench address/);
  assert.equal(microphoneRequests, 0);
  assert.match(
    meetingRecordingErrorMessage({ code: "INSECURE_CONTEXT" }),
    /Tailscale HTTPS/,
  );
});

test("shared call audio failure still records the microphone with a warning", async () => {
  let stopped = false;
  const track = { stop() { stopped = true; } };
  const microphone = { getAudioTracks: () => [track], getTracks: () => [track] };
  class FakeAudioContext {
    constructor() { this.sampleRate = 16_000; this.destination = {}; }
    createScriptProcessor() { return { onaudioprocess: null, connect() {}, disconnect() {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async resume() {}
    async close() {}
  }
  const recording = await startBrowserRecording({
    includeSharedAudio: true,
    mediaDevices: {
      getUserMedia: async () => microphone,
      getDisplayMedia: async () => { throw new Error("No shared audio"); },
    },
    MediaRecorderImpl: { isTypeSupported: () => false },
    MediaStreamImpl: class {},
    AudioContextImpl: FakeAudioContext,
  });
  assert.equal(recording.twoSided, false);
  assert.equal(recording.captureMode, "microphone");
  assert.match(recording.warning, /microphone only/);
  await recording.cancel();
  assert.equal(stopped, true);
});

test("Meetings workspace uses browser microphone recording and the existing Calendar client", async () => {
  const [workspace, variants, recorder, app, index] = await Promise.all([
    readFile(new URL("../src/features/meetings/MeetingsWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/meetings/MeetingCaptureVariants.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/meetings/browserRecorder.js", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /getUpcomingGoogleCalendar/);
  assert.match(workspace, /Today/);
  assert.match(workspace, /Upcoming/);
  assert.match(workspace, /Past/);
  assert.match(variants, /Save meeting draft/);
  assert.match(workspace, /startBrowserRecording/);
  assert.doesNotMatch(workspace, /startNativeMeetingCapture/);
  assert.match(recorder, /getUserMedia/);
  assert.match(recorder, /getDisplayMedia/);
  assert.match(recorder, /MediaRecorderImpl/);
  assert.match(recorder, /indexedDB/);
  assert.match(app, /\["Meetings", CalendarDays\]/);
  assert.match(app, /startCandidateCallSession/);
  assert.match(app, /launchContext=\{meetingLaunch\}/);
  assert.match(app, /recordingLocked/);
  assert.match(workspace, /onLaunchChange\?\.\(\{ phase: "recording"/);
  assert.match(variants, /attached from the Call button/);
  assert.match(variants, /restored from Recent meetings/);
  assert.match(index, /Recruiting Workbench needs JavaScript/);
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
  const [workspace, variants, store, migration, captureMigration, transcriptionMigration] = await Promise.all([
    readFile(new URL("../src/features/meetings/MeetingsWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/meetings/MeetingCaptureVariants.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/meetings/meetingStore.js", import.meta.url), "utf8"),
    readFile(new URL("../../gateway/migrations/005_meeting_drafts.sql", import.meta.url), "utf8"),
    readFile(new URL("../../gateway/migrations/006_meeting_capture_metadata.sql", import.meta.url), "utf8"),
    readFile(new URL("../../gateway/migrations/007_meeting_transcription_metadata.sql", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /loadLiveReviewJobs/);
  assert.match(workspace, /loadLiveCandidatesForJob/);
  assert.match(variants, /Make candidate notes/);
  assert.match(variants, /__variant/);
  assert.match(variants, /transcript-first/);
  assert.match(workspace, /Download Markdown/);
  assert.match(workspace, /Print or save PDF/);
  assert.match(store, /export async function listRecentMeetings/);
  assert.match(store, /session_only/);
  assert.match(store, /speaker_segments/);
  assert.match(variants, /Speaker names/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /auth\.uid\(\) = owner_id/);
  assert.match(captureMigration, /recording_id/);
  assert.match(captureMigration, /speaker_labels/);
  assert.match(transcriptionMigration, /transcription_status/);
  const compiled = await transformWithEsbuild(workspace, "MeetingsWorkspace.jsx", { loader: "jsx", jsx: "automatic" });
  assert.match(compiled.code, /function MeetingsWorkspace/);
});

function fakeKey(key) {
  return JSON.stringify(key);
}

class FakeRequest {
  constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; }
  succeed(result) {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.());
  }
}

class FakeObjectStore {
  constructor(records, keyPath) { this.records = records; this.keyPath = keyPath; }
  put(value) {
    const key = Array.isArray(this.keyPath) ? this.keyPath.map((field) => value[field]) : value[this.keyPath];
    this.records.set(fakeKey(key), structuredClone(value));
    const request = new FakeRequest();
    request.succeed(key);
    return request;
  }
  get(key) {
    const request = new FakeRequest();
    request.succeed(structuredClone(this.records.get(fakeKey(key))));
    return request;
  }
  getAll() {
    const request = new FakeRequest();
    request.succeed([...this.records.values()].map((value) => structuredClone(value)));
    return request;
  }
  getAllKeys() {
    const request = new FakeRequest();
    request.succeed([...this.records.keys()].map((key) => JSON.parse(key)));
    return request;
  }
  delete(key) {
    this.records.delete(fakeKey(key));
    const request = new FakeRequest();
    request.succeed(undefined);
    return request;
  }
  index() {
    return { getAllKeys: (recordingId) => this.getAllKeysForRecording(recordingId) };
  }
  getAllKeysForRecording(recordingId) {
    const keys = [...this.records.entries()]
      .filter(([, value]) => value.recordingId === recordingId)
      .map(([key]) => JSON.parse(key));
    const request = new FakeRequest();
    request.succeed(keys);
    return request;
  }
}

class FakeTransaction {
  constructor(db, stores) {
    this.db = db;
    this.stores = Array.isArray(stores) ? stores : [stores];
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    queueMicrotask(() => queueMicrotask(() => this.oncomplete?.()));
  }
  objectStore(name) {
    if (!this.stores.includes(name)) throw new Error(`Store ${name} is not in this transaction.`);
    return this.db.store(name);
  }
}

class FakeDatabase {
  constructor() {
    this.stores = new Map([
      ["recordings", new Map()],
      ["chunks", new Map()],
    ]);
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
  }
  createObjectStore(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
  }
  store(name) {
    if (name === "chunks") return new FakeObjectStore(this.stores.get(name), ["recordingId", "sequence"]);
    return new FakeObjectStore(this.stores.get(name), "id");
  }
  transaction(stores) { return new FakeTransaction(this, stores); }
  close() {}
}

class FakeIndexedDB {
  constructor() { this.db = null; }
  open() {
    const request = new FakeRequest();
    const db = this.db || new FakeDatabase();
    this.db = db;
    request.result = db;
    queueMicrotask(() => {
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}

test("meeting transcript search filters speaker segments", async () => {
  const source = await readFile(new URL("../src/features/meetings/MeetingCaptureVariants.jsx", import.meta.url), "utf8");
  assert.match(source, /Search speaker transcript/);
  assert.match(source, /No speaker lines match this search/);
  assert.match(source, /visibleSegments/);
});
