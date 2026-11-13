const WORKBENCH_MEDIA_FORMATS = [
  { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "m4a" },
  { mimeType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/mpeg", extension: "mp3" },
];

const RECORDING_DB_NAME = "workbench-meeting-recordings";
const RECORDING_DB_VERSION = 2;
const RECORDING_META_STORE = "recordings";
const RECORDING_CHUNK_STORE = "chunks";
const MEETING_DRAFT_STORE = "drafts";
const WAV_SAMPLE_RATE = 16_000;
const RECOVERABLE_STATUSES = new Set(["recording", "complete"]);

function stopTracks(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function wavHeader(byteLength, sampleRate) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, byteLength, true);
  return buffer;
}

function pcm16Blob(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "application/octet-stream" });
}

export function selectWorkbenchRecordingFormat(MediaRecorderImpl = globalThis.MediaRecorder) {
  if (typeof MediaRecorderImpl?.isTypeSupported !== "function") return null;
  return WORKBENCH_MEDIA_FORMATS.find(({ mimeType }) => MediaRecorderImpl.isTypeSupported(mimeType)) || null;
}

export function encodePcm16Wav(chunks, sampleRate) {
  const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = wavHeader(samples * 2, sampleRate);
  const body = new ArrayBuffer(samples * 2);
  const view = new DataView(body);
  let offset = 0;
  for (const chunk of chunks) {
    for (const rawSample of chunk) {
      const sample = Math.max(-1, Math.min(1, rawSample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([header, body], { type: "audio/wav" });
}

export function encodePcm16WavFromBlobs(chunks, sampleRate) {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.size, 0);
  return new Blob([wavHeader(byteLength, sampleRate), ...chunks], { type: "audio/wav" });
}

export function meetingRecordingFilename(blob) {
  const type = String(blob?.type || "").split(";")[0];
  if (["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(type)) return "meeting-recording.m4a";
  if (type === "audio/mpeg") return "meeting-recording.mp3";
  if (type === "audio/wav" || type === "audio/x-wav") return "meeting-recording.wav";
  throw new Error("Recording format is not supported by local transcription.");
}

export function meetingRecordingErrorMessage(error) {
  const message = String(error?.message || "");
  if (error?.code === "INSECURE_CONTEXT" || /secure context|requires https/i.test(message)) {
    return "Recording needs the secure Workbench address. Open the Tailscale HTTPS link, then try again.";
  }
  if (/screencapturekit|screen.*record|system audio|declined tcc/i.test(message)) {
    return "Mac call-audio permission is blocked. In System Settings, allow Screen & System Audio Recording for Workbench, then try again.";
  }
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Microphone permission is blocked. Allow microphone access for Workbench, then try again.";
  }
  if (error?.name === "NotFoundError") return "No microphone was found. Connect a microphone, then try again.";
  if (error?.name === "NotReadableError" || error?.name === "AbortError") {
    return "The microphone is unavailable or already in use. Close the other audio app, then try again.";
  }
  return message || "Meeting recording could not start.";
}

export function meetingCaptureState(recording) {
  if (!recording) return "Recording uses this device's microphone. Audio is sent to the M1 for transcription.";
  if (recording.twoSided) return "Recording this device's microphone and shared call audio.";
  return "Recording this device's microphone only. The other party's audio is not captured.";
}

export function isSecureRecordingContext(secureContext = globalThis.isSecureContext) {
  return secureContext !== false;
}

function createRecordingId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `recording-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Recording storage is unavailable."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Recording storage is unavailable."));
    transaction.onabort = () => reject(transaction.error || new Error("Recording storage is unavailable."));
  });
}

function openRecordingDb(indexedDBImpl) {
  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(RECORDING_DB_NAME, RECORDING_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDING_META_STORE)) db.createObjectStore(RECORDING_META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(RECORDING_CHUNK_STORE)) {
        const store = db.createObjectStore(RECORDING_CHUNK_STORE, { keyPath: ["recordingId", "sequence"] });
        store.createIndex("recordingId", "recordingId", { unique: false });
      }
      if (!db.objectStoreNames.contains(MEETING_DRAFT_STORE)) db.createObjectStore(MEETING_DRAFT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Recording storage is unavailable."));
  });
}

async function withRecordingDb(indexedDBImpl, action) {
  const db = await openRecordingDb(indexedDBImpl);
  try {
    return await action(db);
  } finally {
    db.close?.();
  }
}

function orderedChunks(records, recordingId) {
  return records
    .filter((record) => record.recordingId === recordingId && record.blob?.size)
    .sort((left, right) => left.sequence - right.sequence)
    .map((record) => record.blob);
}

function assembleRecording(meta, chunks) {
  if (meta.format === "wav") return encodePcm16WavFromBlobs(chunks, meta.sampleRate || WAV_SAMPLE_RATE);
  return new Blob(chunks, { type: meta.mimeType });
}

function createMemoryArchive(meta) {
  const records = [];
  return {
    mode: "memory",
    warning: null,
    getMeta: () => ({ ...meta }),
    async append(sequence, blob) { records.push({ recordingId: meta.id, sequence, blob }); },
    async finish(patch = {}) { Object.assign(meta, patch, { updatedAt: new Date().toISOString() }); },
    async assemble() { return assembleRecording(meta, orderedChunks(records, meta.id)); },
    async remove() { records.length = 0; },
  };
}

function createIndexedDbArchive(indexedDBImpl, meta) {
  let writeQueue = Promise.resolve();
  return {
    mode: "indexeddb",
    warning: null,
    getMeta: () => ({ ...meta }),
    append(sequence, blob) {
      writeQueue = writeQueue.catch(() => {}).then(() => withRecordingDb(indexedDBImpl, async (db) => {
        const transaction = db.transaction(RECORDING_CHUNK_STORE, "readwrite");
        transaction.objectStore(RECORDING_CHUNK_STORE).put({ recordingId: meta.id, sequence, blob });
        await transactionDone(transaction);
      }));
      return writeQueue;
    },
    async finish(patch = {}) {
      await writeQueue;
      Object.assign(meta, patch, { updatedAt: new Date().toISOString() });
      await withRecordingDb(indexedDBImpl, async (db) => {
        const transaction = db.transaction(RECORDING_META_STORE, "readwrite");
        transaction.objectStore(RECORDING_META_STORE).put({ ...meta });
        await transactionDone(transaction);
      });
    },
    async assemble() {
      await writeQueue;
      const records = await withRecordingDb(indexedDBImpl, (db) => {
        const transaction = db.transaction(RECORDING_CHUNK_STORE, "readonly");
        return requestAsPromise(transaction.objectStore(RECORDING_CHUNK_STORE).getAll());
      });
      return assembleRecording(meta, orderedChunks(records, meta.id));
    },
    async remove() {
      await writeQueue.catch(() => {});
      await withRecordingDb(indexedDBImpl, async (db) => {
        const transaction = db.transaction([RECORDING_META_STORE, RECORDING_CHUNK_STORE], "readwrite");
        transaction.objectStore(RECORDING_META_STORE).delete(meta.id);
        const chunkStore = transaction.objectStore(RECORDING_CHUNK_STORE);
        const index = chunkStore.index("recordingId");
        const request = index.getAllKeys(meta.id);
        request.onsuccess = () => request.result.forEach((key) => chunkStore.delete(key));
        await transactionDone(transaction);
      });
    },
  };
}

export async function openRecordingArchive({
  indexedDBImpl = globalThis.indexedDB,
  meta,
} = {}) {
  if (!meta?.id) throw new Error("A recording id is required.");
  if (!indexedDBImpl?.open) {
    return {
      archive: createMemoryArchive(meta),
      warning: "This browser cannot keep the recording on disk while it runs. Keep this tab open until the transcript is ready.",
    };
  }
  try {
    const archive = createIndexedDbArchive(indexedDBImpl, meta);
    await archive.finish({ status: "recording" });
    return { archive, warning: null };
  } catch {
    return {
      archive: createMemoryArchive(meta),
      warning: "This browser cannot keep the recording on disk while it runs. Keep this tab open until the transcript is ready.",
    };
  }
}

export async function listInterruptedRecordings({ ownerId, indexedDBImpl = globalThis.indexedDB } = {}) {
  if (!ownerId || !indexedDBImpl?.open) return [];
  try {
    const records = await withRecordingDb(indexedDBImpl, (db) => {
      const transaction = db.transaction(RECORDING_META_STORE, "readonly");
      return requestAsPromise(transaction.objectStore(RECORDING_META_STORE).getAll());
    });
    return records
      .filter((record) => record.ownerId === String(ownerId) && RECOVERABLE_STATUSES.has(record.status))
      .sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")));
  } catch {
    throw new Error("Recoverable recordings could not be checked. Try again.");
  }
}

function localMeetingDraftId(ownerId, jobId, candidateId) {
  return `meeting-draft:${String(ownerId)}:${String(jobId)}:${String(candidateId)}`;
}

export async function saveLocalMeetingDraft(draft, { indexedDBImpl = globalThis.indexedDB } = {}) {
  const ownerId = String(draft?.ownerId || "").trim();
  const jobId = String(draft?.jobId || "").trim();
  const candidateId = String(draft?.candidateId || "").trim();
  if (!ownerId || !jobId || !candidateId) throw new Error("Sign in and choose a job and candidate to keep an unsaved draft on this device.");
  if (!indexedDBImpl?.open) throw new Error("This browser cannot keep an unsaved meeting draft after you close the page.");
  const saved = {
    id: localMeetingDraftId(ownerId, jobId, candidateId),
    ownerId,
    jobId,
    candidateId,
    transcript: String(draft.transcript || ""),
    notes: String(draft.notes || ""),
    templateId: String(draft.templateId || ""),
    eventTitle: String(draft.eventTitle || ""),
    updatedAt: new Date().toISOString(),
  };
  await withRecordingDb(indexedDBImpl, async (db) => {
    const transaction = db.transaction(MEETING_DRAFT_STORE, "readwrite");
    transaction.objectStore(MEETING_DRAFT_STORE).put(saved);
    await transactionDone(transaction);
  });
  return { ...saved, persistence: "device" };
}

export async function loadLocalMeetingDraft({ ownerId, jobId, candidateId }, { indexedDBImpl = globalThis.indexedDB } = {}) {
  if (!ownerId || !jobId || !candidateId || !indexedDBImpl?.open) return null;
  const draft = await withRecordingDb(indexedDBImpl, async (db) => {
    const transaction = db.transaction(MEETING_DRAFT_STORE, "readonly");
    return requestAsPromise(transaction.objectStore(MEETING_DRAFT_STORE).get(localMeetingDraftId(ownerId, jobId, candidateId)));
  }).catch(() => { throw new Error("The unsaved meeting draft could not be checked on this device."); });
  if (!draft || draft.ownerId !== String(ownerId) || draft.jobId !== String(jobId) || draft.candidateId !== String(candidateId)) return null;
  return { ...draft, persistence: "device" };
}

export async function deleteLocalMeetingDraft({ ownerId, jobId, candidateId }, { indexedDBImpl = globalThis.indexedDB } = {}) {
  if (!ownerId || !jobId || !candidateId || !indexedDBImpl?.open) return;
  await withRecordingDb(indexedDBImpl, async (db) => {
    const transaction = db.transaction(MEETING_DRAFT_STORE, "readwrite");
    transaction.objectStore(MEETING_DRAFT_STORE).delete(localMeetingDraftId(ownerId, jobId, candidateId));
    await transactionDone(transaction);
  });
}

export async function recoverBrowserRecording(recordingId, { ownerId, indexedDBImpl = globalThis.indexedDB } = {}) {
  if (!recordingId || !ownerId || !indexedDBImpl?.open) throw new Error("That recording is no longer available on this device.");
  const result = await withRecordingDb(indexedDBImpl, async (db) => {
    const transaction = db.transaction([RECORDING_META_STORE, RECORDING_CHUNK_STORE], "readonly");
    const meta = await requestAsPromise(transaction.objectStore(RECORDING_META_STORE).get(recordingId));
    const records = await requestAsPromise(transaction.objectStore(RECORDING_CHUNK_STORE).getAll());
    return { meta, records };
  });
  if (!result.meta || result.meta.ownerId !== String(ownerId)) throw new Error("That recording is no longer available on this device.");
  const blob = assembleRecording(result.meta, orderedChunks(result.records, recordingId));
  if (!blob.size) throw new Error("That recording has no saved audio.");
  return { blob, meta: result.meta };
}

export async function discardRecordingArchive(recordingId, { ownerId, indexedDBImpl = globalThis.indexedDB } = {}) {
  if (!recordingId || !ownerId || !indexedDBImpl?.open) return;
  await withRecordingDb(indexedDBImpl, async (db) => {
    const transaction = db.transaction([RECORDING_META_STORE, RECORDING_CHUNK_STORE], "readwrite");
    const done = transactionDone(transaction);
    const metaStore = transaction.objectStore(RECORDING_META_STORE);
    const meta = await requestAsPromise(metaStore.get(recordingId));
    if (meta?.ownerId !== String(ownerId)) {
      await done;
      return;
    }
    metaStore.delete(recordingId);
    const chunkStore = transaction.objectStore(RECORDING_CHUNK_STORE);
    const request = chunkStore.index("recordingId").getAllKeys(recordingId);
    request.onsuccess = () => request.result.forEach((key) => chunkStore.delete(key));
    await done;
  });
}

function createAudioContext(AudioContextImpl, sampleRate) {
  if (sampleRate) {
    try { return new AudioContextImpl({ sampleRate }); } catch { /* Fall back to the device sample rate. */ }
  }
  return new AudioContextImpl();
}

function createMixGraph({ microphone, shared, AudioContextImpl }) {
  const context = createAudioContext(AudioContextImpl);
  if (typeof context.createMediaStreamDestination !== "function") {
    context.close?.();
    return null;
  }
  const destination = context.createMediaStreamDestination();
  const sources = [microphone, shared]
    .filter((stream) => stream?.getAudioTracks?.().length)
    .map((stream) => context.createMediaStreamSource(stream));
  for (const source of sources) source.connect(destination);
  return { context, sources, stream: destination.stream };
}

async function startWavRecording({ microphone, shared, AudioContextImpl, onChunk }) {
  const context = createAudioContext(AudioContextImpl, WAV_SAMPLE_RATE);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const sources = [microphone, shared]
    .filter((stream) => stream?.getAudioTracks?.().length)
    .map((stream) => context.createMediaStreamSource(stream));
  const mute = typeof context.createGain === "function" ? context.createGain() : null;
  if (mute) mute.gain.value = 0;
  processor.onaudioprocess = (event) => {
    onChunk(pcm16Blob(new Float32Array(event.inputBuffer.getChannelData(0))));
  };
  for (const source of sources) source.connect(processor);
  processor.connect(mute || context.destination);
  if (mute) mute.connect(context.destination);
  await context.resume?.();

  return {
    sampleRate: context.sampleRate,
    getError: () => null,
    async stopAudio() {
      processor.onaudioprocess = null;
      processor.disconnect();
      for (const source of sources) source.disconnect();
      mute?.disconnect();
      await context.close();
      stopTracks(microphone);
      stopTracks(shared);
    },
  };
}

function startMediaRecorder({ microphone, shared, format, MediaRecorderImpl, AudioContextImpl, onChunk }) {
  const graph = shared && AudioContextImpl ? createMixGraph({ microphone, shared, AudioContextImpl }) : null;
  if (shared && !graph) throw new Error("This browser cannot mix shared call audio with the microphone.");
  const stream = graph?.stream || microphone;
  const recorder = new MediaRecorderImpl(stream, { mimeType: format.mimeType });
  let failure = null;
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) onChunk(event.data);
  });
  recorder.addEventListener("error", (event) => {
    failure = event.error || new Error("Meeting recording failed.");
  });
  recorder.start(1000);
  if (recorder.state && recorder.state !== "recording") throw new Error("Meeting recording could not start.");

  return {
    mimeType: format.mimeType,
    getError: () => failure,
    async stopAudio() {
      try {
        await new Promise((resolve, reject) => {
          if (recorder.state === "inactive") { resolve(); return; }
          const timer = setTimeout(() => reject(new Error("Meeting recording did not stop cleanly.")), 5000);
          const done = () => { clearTimeout(timer); resolve(); };
          recorder.addEventListener("stop", done, { once: true });
          recorder.addEventListener("error", () => { if (recorder.state === "inactive") done(); }, { once: true });
          try { recorder.stop(); } catch (error) { clearTimeout(timer); reject(error); }
        });
      } finally {
        stopTracks(stream);
        stopTracks(microphone);
        stopTracks(shared);
        for (const source of graph?.sources || []) source.disconnect();
        await graph?.context.close();
      }
    },
  };
}

export async function startBrowserRecording({
  includeSharedAudio = false,
  ownerId = "",
  jobId = "",
  candidateId = "",
  jobTitle = "",
  candidateName = "",
  source = "meeting",
  sessionId = createRecordingId(),
  secureContext = globalThis.isSecureContext,
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderImpl = globalThis.MediaRecorder,
  MediaStreamImpl = globalThis.MediaStream,
  AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
  indexedDBImpl = globalThis.indexedDB,
  archiveFactory = openRecordingArchive,
} = {}) {
  if (!isSecureRecordingContext(secureContext)) {
    const error = new Error("Recording requires the secure Workbench address.");
    error.code = "INSECURE_CONTEXT";
    throw error;
  }
  if (!String(ownerId || "").trim()) throw new Error("Sign in before starting a recording that can be recovered on this device.");
  if (!mediaDevices?.getUserMedia) throw new Error("This browser cannot record meetings.");
  const format = selectWorkbenchRecordingFormat(MediaRecorderImpl);
  const canRecordWav = typeof AudioContextImpl === "function"
    && typeof AudioContextImpl.prototype?.createScriptProcessor === "function";
  if ((!format || typeof MediaStreamImpl !== "function") && !canRecordWav) {
    throw new Error("This browser cannot create MP4, MP3, or WAV audio for local transcription.");
  }

  const startedAt = new Date().toISOString();
  const microphone = await mediaDevices.getUserMedia({ audio: true });
  if (!microphone?.getAudioTracks?.().length) {
    stopTracks(microphone);
    throw new Error("No microphone audio was available.");
  }
  let shared = null;
  let warning = "";
  if (includeSharedAudio) {
    try {
      if (!mediaDevices.getDisplayMedia) throw new Error("Shared audio is unavailable in this browser.");
      shared = await mediaDevices.getDisplayMedia({ audio: true, video: true });
      if (!shared?.getAudioTracks?.().length) {
        warning = "No shared call audio was selected. This recording uses this device's microphone only.";
        stopTracks(shared);
        shared = null;
      }
    } catch {
      warning = "Shared call audio could not be captured. This recording uses this device's microphone only.";
      stopTracks(shared);
      shared = null;
    }
  }
  if (!shared && !warning) warning = "Recording this device's microphone only. Other-party audio is not captured.";

  const meta = {
    id: sessionId,
    ownerId: String(ownerId),
    status: "recording",
    format: null,
    mimeType: null,
    sampleRate: null,
    startedAt,
    updatedAt: startedAt,
    jobId: String(jobId || ""),
    candidateId: String(candidateId || ""),
    jobTitle: String(jobTitle || ""),
    candidateName: String(candidateName || ""),
    source,
    captureMode: shared ? "microphone+shared" : "microphone",
    twoSided: Boolean(shared),
    warning,
  };
  const opened = await archiveFactory({ indexedDBImpl, meta });
  const archive = opened.archive;
  const archiveWarning = opened.warning;
  warning = [warning, archiveWarning].filter(Boolean).join(" ");
  meta.warning = warning;

  let sequence = 0;
  let chunkQueue = Promise.resolve();
  let chunkFailure = null;
  const onChunk = (blob) => {
    const current = sequence;
    sequence += 1;
    chunkQueue = chunkQueue
      .then(() => archive.append(current, blob))
      .catch((error) => { chunkFailure = error; });
  };

  let backend;
  const canMix = typeof AudioContextImpl === "function" && typeof AudioContextImpl.prototype?.createMediaStreamDestination === "function";
  if (shared && !canMix && !canRecordWav) {
    warning = [warning, "Shared call audio could not be mixed; recording the microphone only."].filter(Boolean).join(" ");
    stopTracks(shared);
    shared = null;
  }
  const useMediaRecorder = Boolean(format) && (!shared || canMix);
  try {
    if (useMediaRecorder) {
      backend = startMediaRecorder({ microphone, shared, format, MediaRecorderImpl, AudioContextImpl, onChunk });
      meta.format = "media";
      meta.mimeType = format.mimeType;
    } else if (canRecordWav) {
      if (shared && !canMix) warning = [warning, "Shared call audio could not be mixed; recording the microphone only."].filter(Boolean).join(" ");
      if (shared && !canMix) {
        stopTracks(shared);
        shared = null;
        meta.twoSided = false;
        meta.captureMode = "microphone";
      }
      backend = await startWavRecording({ microphone, shared, AudioContextImpl, onChunk });
      meta.format = "wav";
      meta.mimeType = "audio/wav";
      meta.sampleRate = backend.sampleRate;
    } else {
      throw new Error("This browser cannot create MP4, MP3, or WAV audio for local transcription.");
    }
    meta.warning = warning;
    meta.twoSided = Boolean(shared);
    meta.captureMode = shared ? "microphone+shared" : "microphone";
    await archive.finish({
      status: "recording",
      warning: meta.warning,
      twoSided: meta.twoSided,
      captureMode: meta.captureMode,
      format: meta.format,
      mimeType: meta.mimeType,
      sampleRate: meta.sampleRate,
    });
  } catch (error) {
    stopTracks(microphone);
    stopTracks(shared);
    await archive.remove();
    throw error;
  }

  let stopPromise = null;
  const active = {
    id: sessionId,
    jobId: meta.jobId,
    candidateId: meta.candidateId,
    jobTitle: meta.jobTitle,
    candidateName: meta.candidateName,
    source,
    captureMode: meta.captureMode,
    twoSided: meta.twoSided,
    warning: meta.warning,
    startedAt,
    archiveMode: archive.mode,
    captureStatus: "captured",
    active: true,
    get state() { return backend?.recorder?.state || (active.active ? "recording" : "inactive"); },
    async stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        let stopError = null;
        try { await backend.stopAudio(); } catch (error) { stopError = error; }
        await chunkQueue;
        const backendFailure = stopError || backend.getError?.();
        const finalWarning = [
          meta.warning,
          backendFailure ? "Recording stopped unexpectedly. Partial audio was kept." : "",
          chunkFailure ? "Some audio chunks could not be saved." : "",
        ].filter(Boolean).join(" ");
        active.captureStatus = backendFailure || chunkFailure ? "partial" : "captured";
        active.warning = finalWarning || null;
        active.active = false;
        await archive.finish({
          status: "complete",
          warning: active.warning,
          twoSided: active.twoSided,
          captureMode: active.captureMode,
          format: meta.format,
          mimeType: meta.mimeType,
          sampleRate: meta.sampleRate,
        });
        const blob = await archive.assemble();
        if (!blob.size || (meta.format === "wav" && blob.size <= 44)) {
          throw new Error("Recording produced no audio. Try again.");
        }
        return blob;
      })();
      return stopPromise;
    },
    async cancel() {
      try { await backend.stopAudio(); } catch { /* Cleanup is best effort. */ }
      stopTracks(microphone);
      stopTracks(shared);
      await archive.remove();
      active.active = false;
    },
  };
  return active;
}
