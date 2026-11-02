const MUESLI_MEDIA_FORMATS = [
  { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "m4a" },
  { mimeType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/mpeg", extension: "mp3" },
];

function stopTracks(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

export function selectMuesliRecordingFormat(MediaRecorderImpl = globalThis.MediaRecorder) {
  if (typeof MediaRecorderImpl?.isTypeSupported !== "function") return null;
  return MUESLI_MEDIA_FORMATS.find(({ mimeType }) => MediaRecorderImpl.isTypeSupported(mimeType)) || null;
}

export function encodePcm16Wav(chunks, sampleRate) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + (sampleCount * 2));
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + (sampleCount * 2), true);
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
  view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (const rawSample of chunk) {
      const sample = Math.max(-1, Math.min(1, rawSample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function meetingRecordingFilename(blob) {
  const type = String(blob?.type || "").split(";")[0];
  if (["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(type)) return "meeting-recording.m4a";
  if (type === "audio/mpeg") return "meeting-recording.mp3";
  if (type === "audio/wav" || type === "audio/x-wav") return "meeting-recording.wav";
  throw new Error("Recording format is not supported by local transcription.");
}

async function startWavRecording({ microphone, shared, AudioContextImpl }) {
  const context = new AudioContextImpl();
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  const sources = [microphone, shared]
    .filter((stream) => stream?.getAudioTracks?.().length)
    .map((stream) => context.createMediaStreamSource(stream));
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  for (const source of sources) source.connect(processor);
  processor.connect(context.destination);
  await context.resume?.();

  return {
    async stop() {
      const sampleRate = context.sampleRate;
      processor.onaudioprocess = null;
      processor.disconnect();
      for (const source of sources) source.disconnect();
      await context.close();
      stopTracks(microphone);
      stopTracks(shared);
      return encodePcm16Wav(chunks, sampleRate);
    },
  };
}

function startMediaRecorder({ microphone, shared, format, MediaRecorderImpl, MediaStreamImpl }) {
  const stream = new MediaStreamImpl([
    ...microphone.getAudioTracks(),
    ...(shared?.getAudioTracks?.() || []),
  ]);
  const chunks = [];
  const recorder = new MediaRecorderImpl(stream, { mimeType: format.mimeType });
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size) chunks.push(event.data);
  });
  recorder.start(1000);
  return {
    stop() {
      return new Promise((resolve, reject) => {
        recorder.addEventListener("error", () => reject(new Error("Meeting recording failed.")), { once: true });
        recorder.addEventListener("stop", () => {
          stopTracks(stream);
          stopTracks(microphone);
          stopTracks(shared);
          resolve(new Blob(chunks, { type: format.mimeType }));
        }, { once: true });
        recorder.stop();
      });
    },
  };
}

export async function startBrowserRecording({
  includeSharedAudio = false,
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderImpl = globalThis.MediaRecorder,
  MediaStreamImpl = globalThis.MediaStream,
  AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
} = {}) {
  if (!mediaDevices?.getUserMedia) throw new Error("This browser cannot record meetings.");
  const format = selectMuesliRecordingFormat(MediaRecorderImpl);
  const canRecordWav = typeof AudioContextImpl === "function"
    && typeof AudioContextImpl.prototype?.createScriptProcessor === "function";
  if ((!format || typeof MediaStreamImpl !== "function") && !canRecordWav) {
    throw new Error("This browser cannot create MP4, MP3, or WAV audio for local transcription.");
  }

  const microphone = await mediaDevices.getUserMedia({ audio: true });
  let shared = null;
  try {
    if (includeSharedAudio) {
      if (!mediaDevices.getDisplayMedia) throw new Error("Shared audio is unavailable in this browser.");
      shared = await mediaDevices.getDisplayMedia({ audio: true, video: true });
      if (!shared.getAudioTracks?.().length) throw new Error("No shared call audio was selected.");
    }
    if (format && typeof MediaStreamImpl === "function") {
      return startMediaRecorder({ microphone, shared, format, MediaRecorderImpl, MediaStreamImpl });
    }
    return startWavRecording({ microphone, shared, AudioContextImpl });
  } catch (error) {
    stopTracks(microphone);
    stopTracks(shared);
    throw error;
  }
}
