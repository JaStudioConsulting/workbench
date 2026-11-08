import { meetingRecordingErrorMessage, startBrowserRecording } from "./browserRecorder.js";

export function candidateCallHref(phone) {
  const value = String(phone || "").trim();
  if (!value) return null;
  return `tel:${value.replace(/\s/g, "")}`;
}

export async function startCandidateCallSession({
  job,
  candidate,
  startRecording = startBrowserRecording,
  dial = (href) => globalThis.location?.assign?.(href),
} = {}) {
  const href = candidateCallHref(candidate?.phone);
  if (!job?.id || !candidate?.id || !href) {
    throw new Error("A real job, candidate, and phone number are required to start a recorded call.");
  }

  let recording;
  try {
    recording = await startRecording({
      jobId: String(job.id),
      candidateId: String(candidate.id),
      jobTitle: String(job.title || ""),
      candidateName: String(candidate.name || ""),
      source: "candidate_call",
      includeSharedAudio: false,
    });
  } catch (error) {
    throw new Error(meetingRecordingErrorMessage(error), { cause: error });
  }
  if (!recording || recording.active === false) {
    await recording?.cancel?.();
    throw new Error("The microphone recording did not start. The call was not placed.");
  }
  dial(href);
  return {
    job,
    candidate,
    href,
    recording,
    source: "candidate_call",
    phase: "recording",
    startedAt: recording.startedAt || new Date().toISOString(),
  };
}
