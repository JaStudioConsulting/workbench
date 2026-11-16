function safeFilename(value) {
  const slug = String(value || "meeting-notes").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "meeting-notes";
}

export function downloadMeetingMarkdown({ title, markdown }, {
  documentRef = globalThis.document,
  URLImpl = globalThis.URL,
} = {}) {
  const blob = new Blob([String(markdown || "")], { type: "text/markdown;charset=utf-8" });
  const url = URLImpl.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = `${safeFilename(title)}.md`;
  link.click();
  URLImpl.revokeObjectURL(url);
}
