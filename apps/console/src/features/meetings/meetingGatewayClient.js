import { gatewayBaseURL } from "../../auth-client.js";

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
  return { transcript: payload.transcript, source: payload.source || "muesli_cli" };
}
