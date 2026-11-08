const JOIN_HOSTS = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "teams.live.com",
  "ringcentral.com",
  "webex.com",
];

function eventDate(event) {
  if (!event?.start?.value) return null;
  const value = event.start.kind === "date"
    ? `${event.start.value}T00:00:00.000Z`
    : event.start.value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function sameLocalDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function safeJoinUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const allowed = JOIN_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isMeetingContextLocked({ launchContext, recording, transcribing } = {}) {
  return Boolean(recording) || Boolean(transcribing) || ["starting", "recording", "finalizing"].includes(launchContext?.phase);
}

export function formatSpeakerTranscript(segments = [], speakerLabels = {}) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const speaker = speakerLabels[segment.speaker] || segment.speaker || "Speaker";
      const text = String(segment.text || "").trim();
      return text ? `${speaker}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function groupCalendarEvents(events, now = new Date()) {
  const grouped = { today: [], upcoming: [], past: [] };
  for (const event of Array.isArray(events) ? events : []) {
    const start = eventDate(event);
    if (!start) continue;
    if (sameLocalDay(start, now)) grouped.today.push(event);
    else if (start > now) grouped.upcoming.push(event);
    else grouped.past.push(event);
  }
  return grouped;
}

export function createMeetingDraft({ event = null, candidate = null, job = null, transcript = "", notes = "", recording = null, transcription = null, segments = [], speakers = [], speakerLabels = {}, existingId = null } = {}) {
  return {
    idempotencyKey: globalThis.crypto?.randomUUID?.() || `meeting-${Date.now()}`,
    existingId,
    event: event ? {
      title: event.title || "Untitled meeting",
      start: event.start,
      end: event.end,
      joinUrl: safeJoinUrl(event.joinUrl),
    } : null,
    candidate: candidate?.label ? { id: candidate.id || null, label: candidate.label.trim() } : null,
    job: job?.label ? { id: job.id || null, label: job.label.trim() } : null,
    transcript: String(transcript || "").trim(),
    notes: String(notes || "").trim(),
    transcriptStatus: String(transcript || "").trim() ? "ready" : "awaiting_transcription",
    source: recording?.source || "browser_recording",
    recordingId: recording?.id || null,
    captureStatus: recording?.status || (String(transcript || "").trim() ? "transcribed" : "captured"),
    captureWarning: recording?.warning || null,
    transcriptionStatus: transcription?.status || (String(transcript || "").trim() ? "ready" : "pending"),
    transcriptionWarning: transcription?.warning || null,
    transcriptionSource: transcription?.source || null,
    transcriptionModel: transcription?.model || null,
    segments: Array.isArray(segments) ? segments : [],
    speakers: Array.isArray(speakers) ? speakers : [],
    speakerLabels: speakerLabels && typeof speakerLabels === "object" ? speakerLabels : {},
    createdAt: new Date().toISOString(),
  };
}
