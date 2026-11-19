const LABELS = ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Certifications", "Additional Information"];

const valueOf = (field) => typeof field?.value === "string" ? field.value : "";
const claimValues = (items) => (Array.isArray(items) ? items : []).map((item) => typeof item === "string" ? item : item?.text).filter((value) => typeof value === "string" && value.length);
const safe = (value) => String(value || "").replace(/[\u200B\u200C\u200D\u2060\uFEFF]/gu, "");

function fromSections(sections) {
  const out = [];
  const name = safe(valueOf(sections.name));
  const title = safe(valueOf(sections.title));
  if (name) out.push(`# ${name}`);
  if (title) out.push(title);
  const sectionsData = [
    [LABELS[0], claimValues(sections.summary)],
    [LABELS[1], claimValues(sections.skills).map((value) => `- ${safe(value)}`)],
    [LABELS[2], (sections.experience || []).flatMap((role) => [
      valueOf(role.title), valueOf(role.dates), valueOf(role.company), valueOf(role.location),
      ...claimValues(role.bullets).map((value) => `- ${value}`),
    ].filter(Boolean).map(safe))],
    [LABELS[3], claimValues(sections.education).map(safe)],
    [LABELS[4], claimValues(sections.certifications).map(safe)],
    [LABELS[5], claimValues(sections.additionalInformation).map(safe)],
  ];
  for (const [label, values] of sectionsData) if (values.length) out.push(`## ${label}\n${values.join("\n")}`);
  return out.join("\n\n");
}

// Fallback for older artifacts: only the exact labels emitted by renderResume are
// structural. Any other text is retained as body text, in order.
function fromKnownText(text) {
  const labels = new Set(["Name", "Title", ...LABELS]);
  const blocks = String(text).split(/\n\s*\n/u);
  const out = [];
  let name = "", title = "";
  for (let i = 0; i < blocks.length; i += 1) {
    const lines = blocks[i].split("\n");
    const label = lines[0];
    const body = lines.slice(1).join("\n");
    if (label === "Name") name = body;
    else if (label === "Title") title = body;
    else if (labels.has(label)) out.push(`## ${label}\n${body.replace(/^[•]\s?/gmu, "- ")}`);
    else if (blocks[i].trim()) out.push(blocks[i]);
  }
  return [name && `# ${name}`, title, ...out].filter(Boolean).join("\n\n");
}

export function brandedResumeSourceText(content) {
  if (content?.sections && typeof content.sections === "object") return fromSections(content.sections);
  return typeof content?.text === "string" ? fromKnownText(content.text) : "";
}
