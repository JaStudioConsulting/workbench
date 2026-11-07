const SIX_MONTHS = 6;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function getCandidateSourceCoverage(candidate) {
  const sources = [
    { key: "resume", label: "Resume", present: Boolean(clean(candidate.fullResumeText)) },
    { key: "transcript", label: "Transcript", present: Boolean(clean(candidate.transcriptText)) },
    { key: "callNotes", label: "Call notes", present: Boolean(clean(candidate.callNotes)) },
    { key: "additionalNotes", label: "Additional notes", present: Boolean(clean(candidate.additionalNotes)) },
  ];

  return {
    sources,
    present: sources.filter((source) => source.present),
    missing: sources.filter((source) => !source.present),
  };
}

export function buildBrandResumePayload(candidate) {
  return {
    name: clean(candidate.name),
    headline: clean(candidate.title),
    summary: clean(candidate.profileSummary || candidate.writeUpSummary),
    skills: list(candidate.skills),
    experience: list(candidate.workHistory).map((role) => ({
      title: clean(role.title),
      dates: clean(role.dates),
      company: clean(role.company),
      location: clean(role.location),
      bullets: list(role.bullets),
    })),
    education: list(candidate.education),
    education_heading: "Education & Certifications",
    sections: list(candidate.certifications).length
      ? [{ heading: "Certifications", items: list(candidate.certifications) }]
      : [],
  };
}

function profileWorkHistoryText(workHistory) {
  return list(workHistory).map((role) => {
    const heading = [clean(role.title), clean(role.company)].filter(Boolean).join(" at ");
    const dates = clean(role.dates)
      || [clean(role.startDate), clean(role.endDate)].filter(Boolean).join(" to ");
    const details = [
      heading,
      [dates, clean(role.location)].filter(Boolean).join(" | "),
      ...list(role.bullets).map((bullet) => `- ${bullet}`),
    ].filter(Boolean);
    return details.join("\n");
  }).filter(Boolean).join("\n\n");
}

export function getResumeSource(candidate = {}) {
  const resumeText = clean(candidate.fullResumeText);
  if (resumeText) {
    return {
      kind: "resume",
      text: candidate.fullResumeText,
      payload: buildBrandResumePayload(candidate),
      usedSources: ["fullResumeText"],
    };
  }

  const workHistoryText = profileWorkHistoryText(candidate.workHistory);
  const profileFields = [
    ["title", clean(candidate.title)],
    ["workHistory", workHistoryText],
    ["profileSummary", clean(candidate.profileSummary)],
    ["skills", list(candidate.skills).join(", ")],
    ["callNotes", clean(candidate.callNotes)],
    ["transcriptText", clean(candidate.transcriptText)],
  ].filter(([, value]) => Boolean(value));

  if (!clean(candidate.name) || !profileFields.length) {
    return { kind: "none", text: "", payload: null, usedSources: [] };
  }

  const labels = {
    title: "Title",
    workHistory: "Professional Experience",
    profileSummary: "Professional Summary",
    skills: "Core Competencies & Skills",
    callNotes: "Call Notes",
    transcriptText: "Transcript",
  };
  const text = [
    clean(candidate.name),
    ...profileFields.flatMap(([key, value]) => ["", labels[key], value]),
  ].join("\n");

  return {
    kind: "profile",
    text,
    payload: buildBrandResumePayload(candidate),
    usedSources: ["name", ...profileFields.map(([key]) => key)],
  };
}

export function buildCandidateWriteUp(candidate) {
  const coverage = getCandidateSourceCoverage(candidate);
  const facts = [
    clean(candidate.title) && `Current title: ${clean(candidate.title)}`,
    clean(candidate.employer) && `Current employer: ${clean(candidate.employer)}`,
    clean(candidate.location) && `Location: ${clean(candidate.location)}`,
    clean(candidate.stage) && `Pipeline stage: ${clean(candidate.stage)}`,
  ].filter(Boolean);
  const highlights = list(candidate.writeUpHighlights).length
    ? list(candidate.writeUpHighlights)
    : list(candidate.workHistory).flatMap((role) => list(role.bullets)).slice(0, 4);
  const summary = clean(candidate.writeUpSummary || candidate.profileSummary);

  const lines = [
    clean(candidate.name),
    clean(candidate.title),
    "",
    "Profile Summary",
    summary || "No source-backed profile summary is available.",
    "",
    "Source Facts",
    ...facts.map((fact) => `- ${fact}`),
    "",
    "Key Highlights",
    ...(highlights.length
      ? highlights.map((highlight) => `- ${highlight}`)
      : ["- No source-backed highlights are available."]),
    "",
    "Call Notes",
    clean(candidate.callNotes) || "Not provided.",
    "",
    "Transcript Evidence",
    clean(candidate.transcriptText) || "Not provided.",
    "",
    "Additional Notes",
    clean(candidate.additionalNotes) || "Not provided.",
    "",
    `Sources present: ${coverage.present.map((source) => source.label).join(", ") || "None"}`,
    `Sources missing: ${coverage.missing.map((source) => source.label).join(", ") || "None"}`,
  ];

  return { text: lines.join("\n"), coverage, highlights, summary };
}

export function openBrandedResume(candidate) {
  const resumeWindow = window.open("/resume-brander.html", "_blank");
  if (!resumeWindow) {
    return { ok: false, error: "Allow pop-ups to open the branded resume." };
  }

  const payload = buildBrandResumePayload(candidate);
  const sendPayload = () => {
    if (!resumeWindow.closed) {
      resumeWindow.postMessage(
        { type: "tttg-load-candidate", payload },
        window.location.origin
      );
    }
  };

  [250, 700, 1400].forEach((delay) => window.setTimeout(sendPayload, delay));
  return { ok: true };
}

export function getOwnershipStatus(activityTrail, now = new Date()) {
  const contacts = list(activityTrail)
    .filter((event) => !event.isJa && event.actor && !event.actorUnknown)
    .map((event) => ({ ...event, timestamp: Date.parse(event.date) }))
    .filter((event) => Number.isFinite(event.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);

  const latest = contacts[0];
  if (!latest) {
    return { active: false, latest: null, months: SIX_MONTHS };
  }

  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - SIX_MONTHS);
  return {
    active: latest.timestamp >= cutoff.getTime(),
    latest,
    months: SIX_MONTHS,
  };
}
