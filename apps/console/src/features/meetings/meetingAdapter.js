import { transcribeMeetingAudio } from "./meetingGatewayClient.js";
import { saveMeetingDraft } from "./meetingStore.js";

export function createMeetingAdapter({ saveDraft = saveMeetingDraft, transcribe = transcribeMeetingAudio } = {}) {
  return {
    async transcribe(audioBlob) {
      return transcribe(audioBlob);
    },
    async saveDraft(draft) {
      return saveDraft(draft);
    },
  };
}
