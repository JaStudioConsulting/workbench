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

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function meetingPrintHtml({ title, template }) {
  const sections = template.sections.map((section) => `<section><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.content)}</p></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;color:#000;background:#fff;max-width:760px;margin:40px auto;line-height:1.45}h1{font-size:24px}h2{font-size:16px;margin-top:24px;border-bottom:1px solid #bbb;padding-bottom:4px}p{white-space:pre-wrap}@media print{body{margin:0;max-width:none}}</style></head><body><h1>${escapeHtml(title)}</h1>${sections}</body></html>`;
}

export function printMeetingPdf({ title, template }, { openWindow = globalThis.open } = {}) {
  const printWindow = openWindow("", "_blank", "noopener,noreferrer");
  if (!printWindow) throw new Error("Print window was blocked.");
  printWindow.document.open();
  printWindow.document.write(meetingPrintHtml({ title, template }));
  printWindow.document.close();
  printWindow.addEventListener("load", () => printWindow.print(), { once: true });
}

