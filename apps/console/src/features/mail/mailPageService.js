export function mailtoUrl({ to, subject, body }) {
  const recipient = String(to || "").trim();
  const query = new URLSearchParams({ subject: String(subject || ""), body: String(body || "") });
  return `mailto:${encodeURIComponent(recipient)}?${query.toString()}`;
}

export function channelLabel(value) {
  return value === "mailto" ? "Open in Mail" : value === "copy" ? "Copied" : value ? "Draft saved" : "Not on file";
}
