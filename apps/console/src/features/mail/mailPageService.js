export const FOLLOW_UP_SUBJECT = "Following up";

export function buildFollowUp(profile = {}) {
  const signature = String(profile.signature || "").trim();
  const body = [
    "Hi,",
    "",
    "Following up on my previous note. Let me know if you would be open to a quick conversation.",
    ...(signature ? ["", signature] : []),
  ].join("\n");
  return { subject: FOLLOW_UP_SUBJECT, body };
}

export function repliedAtFor(entry, replies) {
  if (!replies?.available || !entry?.candidateEmail) return null;
  const value = replies.latestByEmail?.[String(entry.candidateEmail).toLowerCase()];
  if (!value) return null;
  const repliedAt = Date.parse(value);
  const outreachAt = Date.parse(entry.createdAt);
  if (!Number.isFinite(repliedAt) || !Number.isFinite(outreachAt) || repliedAt < outreachAt) return null;
  return value;
}

export function mailtoUrl({ to, subject, body }) {
  const recipient = String(to || "").trim();
  const query = new URLSearchParams({ subject: String(subject || ""), body: String(body || "") });
  return `mailto:${encodeURIComponent(recipient)}?${query.toString()}`;
}

export function channelLabel(value) {
  return value === "gmail_draft" ? "Gmail draft" : value === "mailto" ? "Open in Mail" : value === "copy" ? "Copied" : "Not on file";
}
