import { gatewayBaseURL } from "../../auth-client.js";
import { supabase } from "../../supabase-client.js";

async function supabaseAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Sign in again to use meeting capture.");
  const token = data?.session?.access_token;
  if (!token) throw new Error("Sign in to use meeting capture.");
  return token;
}

async function bearerHeaders(getAccessToken) {
  const token = await getAccessToken();
  if (typeof token !== "string" || !token.trim()) throw new Error("Sign in to use meeting capture.");
  return { Authorization: `Bearer ${token.trim()}` };
}

export async function getMeetingStatus({
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
  getAccessToken = supabaseAccessToken,
} = {}) {
  try {
    const headers = await bearerHeaders(getAccessToken);
    const response = await fetchImpl(new URL("/api/meetings/status", baseURL), {
      credentials: "include",
      headers: { Accept: "application/json", ...headers },
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
  getAccessToken = supabaseAccessToken,
} = {}) {
  const headers = await bearerHeaders(getAccessToken);
  const response = await fetchImpl(new URL("/api/meetings/capture/start", baseURL), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
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
    stop: () => stopNativeMeetingCapture(id, { fetchImpl, baseURL, getAccessToken }),
  };
}

export async function stopNativeMeetingCapture(id, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
  getAccessToken = supabaseAccessToken,
} = {}) {
  const headers = await bearerHeaders(getAccessToken);
  const response = await fetchImpl(new URL(`/api/meetings/capture/${encodeURIComponent(id)}/stop`, baseURL), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", ...headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.capture?.id !== id) throw new Error(payload?.error?.message || "Native meeting capture could not stop.");
  return {
    capture: {
      id,
      status: payload.capture.status,
      warning: payload.capture.warning || null,
      source: "workbench_native",
      jobId: String(payload.capture.jobId || ""),
      candidateId: String(payload.capture.candidateId || ""),
    },
    transcription: payload.transcription || { status: "failed", source: "workbench_native" },
    transcript: payload.transcript || "",
    segments: Array.isArray(payload.segments) ? payload.segments : [],
    speakers: Array.isArray(payload.speakers) ? payload.speakers : [],
  };
}

export async function fetchNativeCaptureAudio(id, {
  source = "mixed",
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
  getAccessToken = supabaseAccessToken,
} = {}) {
  const headers = await bearerHeaders(getAccessToken);
  const url = new URL(`/api/meetings/capture/${encodeURIComponent(id)}/audio`, baseURL);
  url.searchParams.set("source", source);
  const response = await fetchImpl(url, { credentials: "include", headers: { Accept: "audio/*", ...headers } });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || "The saved meeting audio could not be loaded.");
  }
  const blob = await response.blob();
  if (!blob?.type?.toLowerCase().startsWith("audio/") || blob.size === 0) {
    throw new Error("The saved meeting audio returned an invalid file.");
  }
  const objectUrl = URL.createObjectURL(blob);
  let released = false;
  return {
    blob,
    url: objectUrl,
    release() {
      if (released) return;
      released = true;
      URL.revokeObjectURL(objectUrl);
    },
  };
}

export async function transcribeMeetingAudio(blob, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
  getAccessToken = supabaseAccessToken,
} = {}) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Meeting audio is empty.");
  const contentType = String(blob.type || "").split(";")[0];
  if (!["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/mpeg", "audio/wav", "audio/x-wav"].includes(contentType)) {
    throw new Error("Meeting audio must be MP4, MP3, or WAV for local transcription.");
  }
  const headers = await bearerHeaders(getAccessToken);
  const response = await fetchImpl(new URL("/api/meetings/transcribe", baseURL), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": blob.type,
      ...headers,
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
