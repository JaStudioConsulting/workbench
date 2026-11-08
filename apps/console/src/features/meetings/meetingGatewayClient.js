import { gatewayBaseURL } from "../../auth-client.js";

export async function getMeetingStatus({
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
} = {}) {
  try {
    const response = await fetchImpl(new URL("/api/meetings/status", baseURL), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { available: false, enhanced: false, captureAvailable: false };
    const payload = await response.json();
    return { available: Boolean(payload?.available), enhanced: Boolean(payload?.enhanced), captureAvailable: Boolean(payload?.captureAvailable) };
  } catch {
    return { available: false, enhanced: false, captureAvailable: false };
  }
}

export async function startNativeMeetingCapture({ jobId, candidateId }, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
} = {}) {
  const response = await fetchImpl(new URL("/api/meetings/capture/start", baseURL), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, candidateId }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.capture?.id || payload.capture.usedSystemAudio !== true) {
    throw new Error(payload?.error?.message || "Native microphone and system-audio capture could not start.");
  }
  const id = payload.capture.id;
  return {
    id,
    jobId: String(jobId),
    candidateId: String(candidateId),
    source: "workbench_native",
    usedSystemAudio: true,
    stop: () => stopNativeMeetingCapture(id, { fetchImpl, baseURL }),
  };
}

export async function stopNativeMeetingCapture(id, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
} = {}) {
  const response = await fetchImpl(new URL(`/api/meetings/capture/${encodeURIComponent(id)}/stop`, baseURL), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.capture?.id !== id) throw new Error(payload?.error?.message || "Native meeting capture could not stop.");
  return {
    capture: {
      id,
      status: payload.capture.status,
      warning: payload.capture.warning || null,
      source: "workbench_native",
      audioUrl: new URL(payload.capture.audioUrl, baseURL).toString(),
      jobId: String(payload.capture.jobId || ""),
      candidateId: String(payload.capture.candidateId || ""),
    },
    transcription: payload.transcription || { status: "failed", source: "workbench_native" },
    transcript: payload.transcript || "",
    segments: Array.isArray(payload.segments) ? payload.segments : [],
    speakers: Array.isArray(payload.speakers) ? payload.speakers : [],
  };
}

export async function transcribeMeetingAudio(blob, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
} = {}) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Meeting audio is empty.");
  const contentType = String(blob.type || "").split(";")[0];
  if (!["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/mpeg", "audio/wav", "audio/x-wav"].includes(contentType)) {
    throw new Error("Meeting audio must be MP4, MP3, or WAV for local transcription.");
  }
  const response = await fetchImpl(new URL("/api/meetings/transcribe", baseURL), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": blob.type,
    },
    body: blob,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.transcript !== "string") {
    throw new Error(payload?.error?.message || "Meeting transcription failed.");
  }
  return {
    transcript: payload.transcript,
    source: payload.source || "workbench_native",
    ...(Array.isArray(payload.segments) ? { segments: payload.segments } : {}),
    ...(Array.isArray(payload.speakers) ? { speakers: payload.speakers } : {}),
    ...(payload.warning ? { warning: payload.warning } : {}),
  };
}
