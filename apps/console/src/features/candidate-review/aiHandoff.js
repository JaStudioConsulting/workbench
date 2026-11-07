// "For your AI" handoff text (A5). Built only from what is on the card.

export const AI_MODULES = [
  { id: "brandedresume", label: "Branded resume", todo: "Build the TTTG branded resume for this candidate (brandedresume)." },
  { id: "write-up", label: "Write-up", todo: "Write the candidate write-up from source facts (write-up)." },
  { id: "ja-writer", label: "Outreach draft", todo: "Draft the outreach message in Ja's voice (ja-writer)." },
  { id: "loxo", label: "Loxo update", todo: "Queue the Loxo update for this candidate (loxo)." },
];

export function loxoPersonId(candidate) {
  if (candidate?.loxoPersonId) return String(candidate.loxoPersonId);
  const match = String(candidate?.profileUrl || "").match(/people\/(\d+)/);
  return match ? match[1] : "Not on file";
}

export function buildAiHandoff({ candidate, job, ticked }) {
  const set = ticked instanceof Set ? ticked : new Set(ticked || []);
  const todos = AI_MODULES.filter((module) => set.has(module.id)).map((module) => module.todo);
  const role = [job?.title, job?.company].filter(Boolean).join(" at ") || "Not on file";
  const lines = [
    "Route through the Recruiter front door ($recruiter).",
    `Candidate: ${candidate?.name || "Not on file"}`,
    `Loxo person id: ${loxoPersonId(candidate)}`,
    `Loxo job id: ${job?.loxoJobId || job?.id || "Not on file"}`,
    `Role in play: ${role}`,
    "todo:",
  ];
  if (todos.length === 0) lines.push("(nothing ticked yet)");
  else todos.forEach((todo, index) => lines.push(`${index + 1}. ${todo}`));
  return lines.join("\n");
}
