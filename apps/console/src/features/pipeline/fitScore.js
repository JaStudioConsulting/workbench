import { isInCanada, province } from "./location.js";

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "from", "into", "this", "that", "role", "work", "years", "year",
  "manager", "specialist", "coordinator", "technician", "engineer", "senior", "junior", "lead",
]);
const INDUSTRY_TERMS = [
  "accounting", "automotive", "construction", "distribution", "finance", "food", "logistics",
  "manufacturing", "mining", "packaging", "pharmaceutical", "retail", "transportation", "warehouse",
];
const PROCESS_TERMS = [
  "automation", "budgeting", "closing", "commissioning", "continuous improvement", "costing", "erp",
  "fabrication", "forecasting", "gmp", "lean", "maintenance", "payroll", "plc", "procurement", "quality",
  "robotics", "six sigma", "welding",
];

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(text).filter(Boolean).join(" ");
  return String(value || "").trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9+#]+/g, " ").replace(/\s+/g, " ").trim();
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function terms(value) {
  return unique(normalized(value).split(" ").filter((term) => term.length > 2 && !STOP_WORDS.has(term)));
}

function overlap(left, right) {
  const rightTerms = new Set(terms(right));
  return terms(left).filter((term) => rightTerms.has(term));
}

function sourceJobText(job) {
  return text([
    job?.title, job?.jobTitle, job?.description, job?.jobDescription, job?.summary, job?.industry,
    job?.skills, job?.requirements, job?.responsibilities, job?.processes,
  ]);
}

function sourceCandidateText(candidate) {
  return text([
    candidate?.title, candidate?.currentTitle, candidate?.profileSummary, candidate?.fitEvidence,
    candidate?.skills, candidate?.certifications, candidate?.workHistory,
  ]);
}

function matchedKeywords(jobText, candidateText, vocabulary) {
  const cleanJob = normalized(jobText);
  const cleanCandidate = normalized(candidateText);
  return vocabulary.filter((item) => cleanJob.includes(normalized(item)) && cleanCandidate.includes(normalized(item)));
}

function explicitYears(value) {
  const matches = [...text(value).matchAll(/\b(\d{1,2})(?:\+)?\s*(?:years?|yrs?)\b/gi)];
  return matches.reduce((largest, match) => Math.max(largest, Number(match[1]) || 0), 0);
}

function parsedDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function shortRecentRole(role, now = new Date()) {
  const explicitMonths = Number(role?.durationMonths);
  if (Number.isFinite(explicitMonths)) return explicitMonths > 0 && explicitMonths < 12;
  const start = parsedDate(role?.startDate);
  const end = parsedDate(role?.endDate) || (/(present|current)/i.test(text(role?.dates)) ? now : null);
  if (!start || !end) return false;
  const months = ((end.getFullYear() - start.getFullYear()) * 12) + end.getMonth() - start.getMonth();
  return months >= 0 && months < 12 && ((now.getTime() - end.getTime()) / 31_557_600_000) < 3;
}

function priorPositiveNote(candidate) {
  return (candidate?.activityTrail || []).find((item) => {
    const noteText = text([item?.type, item?.note]);
    return /\bAI Marked Yes\b/i.test(noteText) || /\bGood Fit\b/i.test(noteText);
  });
}

export function scoreFit(job, candidate) {
  const workHistory = Array.isArray(candidate?.workHistory) ? candidate.workHistory : [];
  const candidateTitle = text(candidate?.title || candidate?.currentTitle);
  if (!candidateTitle && workHistory.length === 0) {
    return { level: "unknown", strengths: [], gaps: ["No title or work history in source"], roleMatches: [], basis: "rules" };
  }

  const jobTitle = text(job?.title || job?.jobTitle);
  const jobText = sourceJobText(job);
  const candidateText = sourceCandidateText(candidate);
  const titleOverlap = overlap(jobTitle, candidateTitle);
  const industryMatches = matchedKeywords(jobText, candidateText, INDUSTRY_TERMS);
  const processMatches = matchedKeywords(jobText, candidateText, PROCESS_TERMS);
  const roleMatches = workHistory.map((role, index) => {
    const matches = overlap(jobTitle, text([role?.title, role?.bullets, role?.description]));
    return matches.length ? { index, why: `Matches role terms: ${matches.slice(0, 3).join(", ")}` } : null;
  }).filter(Boolean);
  const strengths = [];
  const gaps = [];
  let evidence = 0;

  if (titleOverlap.length) {
    strengths.push(`Title matches: ${titleOverlap.slice(0, 3).join(", ")}`);
    evidence += 2;
  } else if (jobTitle) {
    gaps.push("No clear title overlap in source");
  }
  if (roleMatches.length) {
    strengths.push(`Work history matches ${roleMatches.length === 1 ? "a relevant role" : "relevant roles"}`);
    evidence += Math.min(2, roleMatches.length);
  }
  if (industryMatches.length) {
    strengths.push(`Industry match: ${industryMatches.slice(0, 3).join(", ")}`);
    evidence += 1;
  }
  if (processMatches.length) {
    strengths.push(`Process match: ${processMatches.slice(0, 3).join(", ")}`);
    evidence += Math.min(2, processMatches.length);
  }

  const years = explicitYears(candidateText);
  const requiredYears = explicitYears(text([job?.description, job?.jobDescription, job?.requirements]));
  if (years && requiredYears) {
    if (years >= requiredYears) {
      strengths.push("Source-stated experience meets the job requirement");
      evidence += 1;
    } else {
      gaps.push("Source-stated experience is below the job requirement");
    }
  } else if (years) {
    strengths.push("Relevant years are stated in the candidate source");
    evidence += 1;
  }

  const jobProvince = province(job?.location);
  const candidateProvince = province(candidate?.location);
  if (jobProvince && candidateProvince && jobProvince === candidateProvince) {
    strengths.push(`Same province: ${jobProvince}`);
    evidence += 1;
  } else if (isInCanada(job?.location) && isInCanada(candidate?.location)) {
    strengths.push("Job and candidate are in Canada");
    evidence += 1;
  } else if (isInCanada(job?.location) && candidate?.location && !isInCanada(candidate.location)) {
    gaps.push("Candidate location is not identified as Canada");
  }

  if (workHistory.some((role) => shortRecentRole(role))) gaps.push("Recent work history includes a stint under one year");
  if (priorPositiveNote(candidate)) {
    strengths.push("Earlier review note marked the candidate as a good fit");
    evidence += 1;
  }

  const level = evidence >= 5 ? "strong" : evidence >= 2 ? "possible" : "weak";
  return { level, strengths: unique(strengths), gaps: unique(gaps), roleMatches, basis: "rules" };
}

