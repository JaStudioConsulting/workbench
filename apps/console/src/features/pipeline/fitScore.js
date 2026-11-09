import { canadianCity, isInCanada, province } from "./location.js";

export const FIT_LEVELS = Object.freeze(["strong", "possible", "weak", "unknown"]);
export const ROLE_LEVELS = Object.freeze([
  "entry",
  "individual",
  "senior",
  "lead",
  "supervisor",
  "manager",
  "director",
  "executive",
]);

const FIT_LEVEL_ORDER = Object.freeze({
  strong: 0,
  possible: 1,
  weak: 2,
  unknown: 3,
});

const LEVEL_RANK = Object.freeze({
  entry: 0,
  individual: 1,
  senior: 2,
  lead: 3,
  supervisor: 4,
  manager: 5,
  director: 6,
  executive: 7,
});

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "from", "into", "this", "that", "role", "work", "years", "year",
  "manager", "specialist", "coordinator", "technician", "engineer", "senior", "junior", "lead",
]);

const SHORT_DOMAIN_TERMS = new Set(["qa", "qc", "hr", "it", "ap", "ar", "bi"]);

const ROLE_FUNCTION_TERMS = new Set([
  "accountant", "administrator", "advisor", "analyst", "architect", "assembler", "associate",
  "auditor", "bookkeeper", "buyer", "clerk", "consultant", "controller", "comptroller",
  "coordinator", "designer", "developer", "director", "dispatcher", "driver", "electrician",
  "engineer", "estimator", "executive", "fabricator", "fitter", "foreman", "foreperson",
  "inspector", "installer", "intern", "lead", "machinist", "manager", "mechanic", "millwright",
  "operator", "planner", "president", "programmer", "recruiter", "representative", "scientist",
  "specialist", "superintendent", "supervisor", "technician", "toolmaker", "trainee", "welder",
]);

const LEVEL_MODIFIER_WORDS = new Set([
  "and", "the", "for", "with", "of", "in", "to", "at", "on", "by",
  "senior", "sr", "junior", "jr", "entry", "intermediate", "mid", "principal",
]);

const PLACEHOLDER_VALUES = new Set([
  "title not recorded",
  "company not recorded",
  "job title not on file",
  "company not on file",
  "unnamed candidate",
  "unknown",
  "unknown job",
  "not recorded",
  "not on file",
  "n a",
  "none",
]);

const CLOSED_JOB_STATUSES = new Set([
  "closed", "filled", "cancelled", "canceled", "inactive", "on hold", "hold", "paused", "archived", "draft",
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

const ROLE_FAMILIES = [
  ["program", "project", "pmo", "delivery"],
  ["logistics", "supply", "chain", "freight", "warehouse", "shipping", "transportation", "dispatch"],
  ["maintenance", "millwright", "reliability", "mechanic"],
  ["accounting", "accountant", "controller", "comptroller", "finance", "audit", "tax", "payroll", "bookkeeper"],
  ["quality", "qa", "qc", "inspection", "compliance"],
  ["manufacturing", "production", "plant", "operations"],
  ["procurement", "purchasing", "buyer", "sourcing", "materials"],
  ["welding", "welder", "fitter", "fabricator"],
];

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(text).filter(Boolean).join(" ");
  return String(value || "").trim();
}

function normalized(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9+#]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanField(value) {
  const raw = text(value);
  if (!raw) return "";
  return PLACEHOLDER_VALUES.has(normalized(raw)) ? "" : raw;
}

function cleanLocation(value) {
  return cleanField(value);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function terms(value) {
  return unique(
    normalized(value)
      .split(" ")
      .filter((term) => (term.length > 2 || SHORT_DOMAIN_TERMS.has(term)) && !STOP_WORDS.has(term)),
  );
}

function functionTerms(value) {
  return unique(
    normalized(value)
      .split(" ")
      .filter((term) => ROLE_FUNCTION_TERMS.has(term)),
  );
}

function allCoreTitleWords(value) {
  return unique(
    normalized(value)
      .split(" ")
      .filter((term) => (term.length > 2 || SHORT_DOMAIN_TERMS.has(term)) && !LEVEL_MODIFIER_WORDS.has(term)),
  );
}

function overlap(left, right) {
  const rightTerms = new Set(terms(right));
  const direct = terms(left).filter((term) => rightTerms.has(term));
  if (direct.length > 0) return direct;
  if (terms(left).length === 0 && terms(right).length === 0) {
    const rightFunctions = new Set(functionTerms(right));
    return functionTerms(left).filter((term) => rightFunctions.has(term));
  }
  return [];
}

function relatedRoleTerms(leftTitle, rightTitle) {
  const leftWords = new Set(allCoreTitleWords(leftTitle));
  const rightWords = new Set(allCoreTitleWords(rightTitle));
  if (leftWords.size === 0 || rightWords.size === 0) return [];
  for (const family of ROLE_FAMILIES) {
    const leftMatches = family.filter((term) => leftWords.has(term));
    const rightMatches = family.filter((term) => rightWords.has(term));
    if (leftMatches.length > 0 && rightMatches.length > 0) {
      return unique([...leftMatches, ...rightMatches]);
    }
  }
  return [];
}

function extractTitleFromRecord(value) {
  if (typeof value === "string") return cleanField(value);
  if (!value || typeof value !== "object") return "";
  return cleanField(
    value.title || value.jobTitle || value.job_title || value.currentTitle || value.current_title || value.role,
  );
}

export function inferRoleLevel(value) {
  if (!value) return null;
  const explicitLevel = typeof value === "object" ? cleanField(value.level || value.seniority) : "";
  const titleText = extractTitleFromRecord(value);
  const combined = normalized(explicitLevel ? `${explicitLevel} ${titleText}` : titleText);
  if (!combined) return null;
  const padded = ` ${combined} `;

  if (
    /\b(chief|ceo|cfo|coo|cto|cio|svp|evp|vice president|president)\b/.test(padded)
    || /\bvp\b/.test(padded)
    || (/\bexecutive\b/.test(padded) && !/\b(account executive|sales executive|executive assistant)\b/.test(padded))
  ) {
    return "executive";
  }
  if (/\bdirector\b/.test(padded)) return "director";
  if (/\b(manager|gm|general manager|plant manager|program manager|project manager|controller|comptroller|superintendent|head of)\b/.test(padded)) {
    return "manager";
  }
  if (/\b(supervisor|foreman|foreperson)\b/.test(padded)) return "supervisor";
  if (
    /\b(lead|team lead|shift lead|production lead|principal)\b/.test(padded)
    || /\bstaff (engineer|developer|architect|scientist|technician|designer|programmer)\b/.test(padded)
  ) {
    return "lead";
  }
  if (/\b(senior|sr)\b/.test(padded)) return "senior";
  if (/\b(junior|jr|entry|intern|trainee|apprentice|co op|coop)\b/.test(padded)) return "entry";
  if (
    /\b(intermediate|mid|individual)\b/.test(padded)
    || functionTerms(combined).length > 0
    || terms(combined).length > 0
  ) {
    return "individual";
  }
  return null;
}

function getWorkHistory(candidate) {
  if (Array.isArray(candidate?.workHistory)) return candidate.workHistory;
  if (Array.isArray(candidate?.work_history)) return candidate.work_history;
  return [];
}

export function compareRoleLevels(job, candidate) {
  const jobLevel = inferRoleLevel(job);
  const candidateLevel = inferRoleLevel(candidate);
  const workHistory = getWorkHistory(candidate);
  const historyLevels = unique(workHistory.map((role) => inferRoleLevel(role?.title || role)).filter(Boolean));

  if (!jobLevel || (!candidateLevel && historyLevels.length === 0)) {
    return { jobLevel, candidateLevel, status: "unknown", reason: "", gap: "" };
  }
  if (candidateLevel === jobLevel) {
    return { jobLevel, candidateLevel, status: "match", reason: `Level match: ${jobLevel}`, gap: "" };
  }
  if (historyLevels.includes(jobLevel)) {
    return {
      jobLevel,
      candidateLevel: candidateLevel || jobLevel,
      status: "history_match",
      reason: `Work history includes ${jobLevel} level role`,
      gap: "",
    };
  }
  if (!candidateLevel) {
    return { jobLevel, candidateLevel: null, status: "unknown", reason: "", gap: "" };
  }
  const diff = Math.abs(LEVEL_RANK[candidateLevel] - LEVEL_RANK[jobLevel]);
  if (diff === 1) {
    return {
      jobLevel,
      candidateLevel,
      status: "adjacent",
      reason: LEVEL_RANK[candidateLevel] > LEVEL_RANK[jobLevel]
        ? `Adjacent level: candidate is ${candidateLevel} for ${jobLevel} role`
        : "",
      gap: LEVEL_RANK[candidateLevel] < LEVEL_RANK[jobLevel]
        ? `Level gap: candidate is ${candidateLevel}, job is ${jobLevel}`
        : "",
    };
  }
  return {
    jobLevel,
    candidateLevel,
    status: "mismatch",
    reason: "",
    gap: `Level mismatch: candidate is ${candidateLevel}, job is ${jobLevel}`,
  };
}

export function isOpenJob(job) {
  if (!job || typeof job !== "object") return false;
  if (job.isOpen === false || job.open === false || job.active === false) return false;
  const title = extractTitleFromRecord(job);
  if (!title) return false;
  const status = normalized(job.status);
  if (!status) return job.isOpen === true || job.open === true || job.active === true;
  if (CLOSED_JOB_STATUSES.has(status)) return false;
  return status === "active" || status === "open";
}

function sourceJobText(job) {
  return text([
    extractTitleFromRecord(job),
    job?.description,
    job?.jobDescription,
    job?.job_description,
    job?.summary,
    job?.industry,
    job?.skills,
    job?.requirements,
    job?.responsibilities,
    job?.processes,
  ]);
}

function sourceCandidateText(candidate) {
  return text([
    extractTitleFromRecord(candidate),
    candidate?.profileSummary,
    candidate?.profile_summary,
    candidate?.fitEvidence,
    candidate?.fit_evidence,
    candidate?.skills,
    candidate?.certifications,
    candidate?.licenses_certifications,
    candidate?.industry,
    candidate?.notes,
    candidate?.additionalNotes,
    candidate?.additional_notes,
    candidate?.fullResumeText,
    candidate?.resume_text,
    getWorkHistory(candidate),
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
  const workHistory = getWorkHistory(candidate);
  const candidateTitle = extractTitleFromRecord(candidate);
  if (!candidateTitle && workHistory.length === 0) {
    return { level: "unknown", strengths: [], gaps: ["No title or work history in source"], roleMatches: [], basis: "rules" };
  }

  const jobTitle = extractTitleFromRecord(job);
  const jobText = sourceJobText(job);
  const candidateText = sourceCandidateText(candidate);
  const titleOverlap = overlap(jobTitle, candidateTitle);
  const relatedTerms = titleOverlap.length === 0 ? relatedRoleTerms(jobTitle, candidateTitle) : [];
  const industryMatches = matchedKeywords(jobText, candidateText, INDUSTRY_TERMS);
  const processMatches = matchedKeywords(jobText, candidateText, PROCESS_TERMS);
  const roleMatches = workHistory.map((role, index) => {
    const matches = overlap(jobTitle, text([role?.title, role?.bullets, role?.description]));
    return matches.length ? { index, why: `Matches role terms: ${matches.slice(0, 3).join(", ")}` } : null;
  }).filter(Boolean);
  const levelComparison = compareRoleLevels(job, candidate);

  const strengths = [];
  const gaps = [];
  let evidence = 0;

  if (titleOverlap.length) {
    strengths.push(`Title matches: ${titleOverlap.slice(0, 3).join(", ")}`);
    evidence += 2;
    const jobCoreWords = allCoreTitleWords(jobTitle);
    const candidateCoreSet = new Set(allCoreTitleWords(candidateTitle));
    if (jobCoreWords.length > 0 && jobCoreWords.every((word) => candidateCoreSet.has(word))) {
      evidence += 1;
    }
  } else if (relatedTerms.length && levelComparison.status !== "mismatch") {
    strengths.push(`Related title terms: ${relatedTerms.slice(0, 3).join(", ")}`);
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

  const hasRoleRelevance = Boolean(
    titleOverlap.length
    || (relatedTerms.length && levelComparison.status !== "mismatch")
    || roleMatches.length
    || industryMatches.length
    || processMatches.length,
  );

  if (levelComparison.status === "match") {
    if (hasRoleRelevance || levelComparison.jobLevel !== "individual") {
      strengths.push(levelComparison.reason);
    }
    if (hasRoleRelevance) {
      evidence += 1;
    }
  } else if (levelComparison.status === "history_match") {
    strengths.push(levelComparison.reason);
    if (hasRoleRelevance) {
      evidence += 1;
    }
  } else if (levelComparison.status === "adjacent") {
    if (levelComparison.reason) strengths.push(levelComparison.reason);
    if (levelComparison.gap) gaps.push(levelComparison.gap);
  } else if (levelComparison.status === "mismatch") {
    gaps.push(levelComparison.gap);
    evidence = Math.max(0, evidence - 2);
  }

  const years = explicitYears(candidateText);
  const requiredYears = explicitYears(text([job?.description, job?.jobDescription, job?.job_description, job?.requirements]));
  if (years && requiredYears) {
    if (years >= requiredYears) {
      strengths.push("Source-stated experience meets the job requirement");
      if (hasRoleRelevance) evidence += 1;
    } else {
      gaps.push("Source-stated experience is below the job requirement");
    }
  } else if (years) {
    strengths.push("Relevant years are stated in the candidate source");
    if (hasRoleRelevance) evidence += 1;
  }

  const jobLoc = cleanLocation(job?.location);
  const candLoc = cleanLocation(candidate?.location);
  const jobProvince = province(jobLoc);
  const candidateProvince = province(candLoc);
  const jobCity = canadianCity(jobLoc);
  const candidateCity = canadianCity(candLoc);
  const jobInCanada = isInCanada(jobLoc);
  const candidateInCanada = isInCanada(candLoc);

  if (jobProvince && candidateProvince && jobProvince === candidateProvince) {
    if (jobCity && candidateCity && jobCity === candidateCity) {
      strengths.push(`Same city: ${jobCity}`);
    }
    strengths.push(`Same province: ${jobProvince}`);
    if (hasRoleRelevance) evidence += 1;
  } else if (jobInCanada && candidateInCanada) {
    strengths.push("Job and candidate are in Canada");
    if (jobProvince && candidateProvince && jobProvince !== candidateProvince) {
      gaps.push(`Different province: candidate in ${candidateProvince}, job in ${jobProvince}`);
    } else if (hasRoleRelevance) {
      evidence += 1;
    }
  } else if (jobInCanada && candLoc && !candidateInCanada) {
    gaps.push("Candidate location is not identified as Canada");
  } else if (jobInCanada && !candLoc) {
    gaps.push("Candidate location is not in source");
  }

  if (workHistory.some((role) => shortRecentRole(role))) {
    gaps.push("Recent work history includes a stint under one year");
  }
  if (priorPositiveNote(candidate)) {
    strengths.push("Earlier review note marked the candidate as a good fit");
    if (hasRoleRelevance) evidence += 1;
  }

  let level = !hasRoleRelevance ? "weak" : evidence >= 5 ? "strong" : evidence >= 2 ? "possible" : "weak";
  if (jobInCanada && candLoc && !candidateInCanada) {
    level = "weak";
  } else if (jobInCanada && !candLoc && level === "strong") {
    level = "possible";
  }
  if (levelComparison.status === "mismatch" && level === "strong") {
    level = "possible";
  }

  return { level, strengths: unique(strengths), gaps: unique(gaps), roleMatches, basis: "rules" };
}

export function matchCandidateToJob(candidate, job) {
  const fit = scoreFit(job, candidate);
  const levelComparison = compareRoleLevels(job, candidate);
  const jobId = text(job?.id ?? job?.job_id ?? job?.jobId ?? job?.loxoJobId);
  const jobTitle = extractTitleFromRecord(job);
  const company = cleanField(job?.company);
  const location = cleanLocation(job?.location);
  const reasons = fit.level === "strong"
    ? [...fit.strengths]
    : unique([...fit.strengths, ...fit.gaps]);

  return {
    jobId,
    jobTitle,
    title: jobTitle,
    company,
    location,
    level: fit.level,
    fitLevel: fit.level,
    jobLevel: levelComparison.jobLevel,
    candidateLevel: levelComparison.candidateLevel,
    reasons,
    strengths: fit.strengths,
    gaps: fit.gaps,
    roleMatches: fit.roleMatches,
    basis: fit.basis,
  };
}

function hasPrefix(items, prefix) {
  return Array.isArray(items) && items.some((item) => String(item).startsWith(prefix));
}

function compareJobMatches(left, right) {
  const levelDiff = (FIT_LEVEL_ORDER[left.level] ?? 9) - (FIT_LEVEL_ORDER[right.level] ?? 9);
  if (levelDiff !== 0) return levelDiff;

  const sameCityDiff = Number(hasPrefix(right.strengths, "Same city:")) - Number(hasPrefix(left.strengths, "Same city:"));
  if (sameCityDiff !== 0) return sameCityDiff;

  const sameProvinceDiff = Number(hasPrefix(right.strengths, "Same province:")) - Number(hasPrefix(left.strengths, "Same province:"));
  if (sameProvinceDiff !== 0) return sameProvinceDiff;

  const levelMatchDiff = Number(hasPrefix(right.strengths, "Level match:")) - Number(hasPrefix(left.strengths, "Level match:"));
  if (levelMatchDiff !== 0) return levelMatchDiff;

  const directTitleDiff = Number(hasPrefix(right.strengths, "Title matches:")) - Number(hasPrefix(left.strengths, "Title matches:"));
  if (directTitleDiff !== 0) return directTitleDiff;

  const strengthsDiff = (right.strengths?.length || 0) - (left.strengths?.length || 0);
  if (strengthsDiff !== 0) return strengthsDiff;

  return (left.gaps?.length || 0) - (right.gaps?.length || 0);
}

export function matchCandidateToOpenJobs(candidate, jobs = [], options = {}) {
  if (!candidate || typeof candidate !== "object") return [];
  const list = Array.isArray(jobs) ? jobs : [];
  const openOnly = options.openOnly !== false;
  const canadaOnly = options.canadaOnly !== false;
  const includeWeak = Boolean(options.includeWeak || options.minLevel === "weak" || options.minLevel === "unknown");
  const includeUnknown = Boolean(options.includeUnknown || options.minLevel === "unknown");
  const excludedIds = new Set((options.excludeJobIds || []).map((id) => String(id).trim()).filter(Boolean));
  if (options.excludeCurrentJob && (candidate.jobId || candidate.job_id)) {
    excludedIds.add(String(candidate.jobId || candidate.job_id).trim());
  }

  const matches = [];
  for (const job of list) {
    if (!job || typeof job !== "object") continue;
    if (openOnly && !isOpenJob(job)) continue;
    const jobId = text(job.id ?? job.job_id ?? job.jobId ?? job.loxoJobId);
    if (jobId && excludedIds.has(jobId)) continue;
    const jobLoc = cleanLocation(job.location);
    if (canadaOnly && jobLoc && !isInCanada(jobLoc)) continue;

    const match = matchCandidateToJob(candidate, job);
    if (match.level === "unknown" && !includeUnknown) continue;
    if (match.level === "weak" && !includeWeak) continue;
    matches.push(match);
  }

  matches.sort(compareJobMatches);
  if (Number.isInteger(options.limit) && options.limit > 0) {
    return matches.slice(0, options.limit);
  }
  return matches;
}

export function matchCandidatesToOpenJobs(candidates = [], jobs = [], options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  return list.map((candidate) => ({
    candidateId: text(candidate?.id ?? candidate?.candidate_id ?? candidate?.person_id ?? candidate?.candidateId ?? candidate?.candidate_key),
    candidateName: cleanField(candidate?.name || candidate?.candidate_name || candidate?.full_name),
    matches: matchCandidateToOpenJobs(candidate, jobs, options),
  }));
}

export function matchCandidatesForJob(job, candidates = [], options = {}) {
  if (!job || typeof job !== "object") return [];
  const openOnly = options.openOnly !== false;
  if (openOnly && !isOpenJob(job)) return [];
  const canadaOnly = options.canadaOnly !== false;
  const includeWeak = Boolean(options.includeWeak || options.minLevel === "weak" || options.minLevel === "unknown");
  const includeUnknown = Boolean(options.includeUnknown || options.minLevel === "unknown");
  const list = Array.isArray(candidates) ? candidates : [];

  const results = [];
  for (const candidate of list) {
    if (!candidate || typeof candidate !== "object") continue;
    const candLoc = cleanLocation(candidate.location);
    if (canadaOnly && candLoc && !isInCanada(candLoc)) continue;
    if (canadaOnly && !candLoc && !options.showUnknownLocation) continue;

    const match = matchCandidateToJob(candidate, job);
    if (match.level === "unknown" && !includeUnknown) continue;
    if (match.level === "weak" && !includeWeak) continue;
    results.push({
      candidateId: text(candidate.id ?? candidate.candidate_id ?? candidate.person_id ?? candidate.candidateId ?? candidate.candidate_key),
      candidateName: cleanField(candidate.name || candidate.candidate_name || candidate.full_name),
      candidateTitle: extractTitleFromRecord(candidate),
      candidateLocation: candLoc,
      level: match.level,
      fitLevel: match.fitLevel,
      candidateLevel: match.candidateLevel,
      jobLevel: match.jobLevel,
      reasons: match.reasons,
      strengths: match.strengths,
      gaps: match.gaps,
      roleMatches: match.roleMatches,
      basis: match.basis,
    });
  }

  results.sort(compareJobMatches);
  if (Number.isInteger(options.limit) && options.limit > 0) {
    return results.slice(0, options.limit);
  }
  return results;
}

export const findBestJobMatches = matchCandidateToOpenJobs;
export const matchOpenJobs = matchCandidateToOpenJobs;
