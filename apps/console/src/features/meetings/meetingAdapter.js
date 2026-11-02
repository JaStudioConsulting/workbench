import { transcribeMeetingAudio } from "./meetingGatewayClient.js";

export function createMeetingAdapter({ saveDraft, transcribe = transcribeMeetingAudio } = {}) {
  return {
    async transcribe(audioBlob) {
      return transcribe(audioBlob);
    },
    async saveDraft(draft) {
      if (typeof saveDraft === "function") return saveDraft(draft);
      return { ok: true, draft, persistence: "session_only" };
    },
  };
}
