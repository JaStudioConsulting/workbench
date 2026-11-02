import { gatewayBaseURL } from "../../auth-client.js";

export async function transcribeMeetingAudio(blob, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
} = {}) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Meeting audio is empty.");
  const response = await fetchImpl(new URL("/api/meetings/transcribe", baseURL), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": blob.type || "audio/webm",
    },
    body: blob,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.transcript !== "string") {
    throw new Error(payload?.error?.message || "Meeting transcription failed.");
  }
  return { transcript: payload.transcript, source: payload.source || "muesli_cli" };
}
