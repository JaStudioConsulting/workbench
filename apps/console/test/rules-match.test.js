import test from "node:test";
import assert from "node:assert/strict";
import {
  FIT_LEVELS,
  ROLE_LEVELS,
  canadianCity,
  compareRoleLevels,
  findBestJobMatches,
  inferRoleLevel,
  isInCanada,
  isOpenJob,
  matchCandidatesForJob,
  matchCandidatesToOpenJobs,
  matchCandidateToJob,
  matchCandidateToOpenJobs,
  province,
  scoreFit,
} from "../src/features/search/index.js";

const SYNTHETIC_OPEN_JOBS = Object.freeze([
  Object.freeze({
    id: "DEMO-JOB-PM-ON",
    title: "Program Manager",
    company: "Synthetic Manufacturing Systems",
    location: "Toronto, ON",
    status: "Active",
  }),
  Object.freeze({
    id: "DEMO-JOB-PM-BC",
    title: "Program Manager",
    company: "Pacific Demo Assembly",
    location: "Vancouver, BC",
    status: "Active",
  }),
  Object.freeze({
    id: "DEMO-JOB-PROJ-ON",
    title: "Project Manager",
    company: "Ontario Synthetic Tooling",
    location: "Mississauga, ON",
    status: "Open",
  }),
  Object.freeze({
    id: "DEMO-JOB-MILLWRIGHT-ON",
    title: "Millwright",
    company: "Grand River Demo Steel",
    location: "Cambridge, ON",
    status: "Active",
  }),
  Object.freeze({
    id: "DEMO-JOB-CLOSED-ON",
    title: "Program Manager",
    company: "Closed Synthetic Plant",
    location: "Toronto, ON",
    status: "Closed",
  }),
  Object.freeze({
    id: "DEMO-JOB-US",
    title: "Program Manager",
    company: "US Demo Plant",
    location: "Austin, TX",
    status: "Active",
  }),
]);

const FORBIDDEN_NUMERIC_KEYS = [
  "score",
  "fitScore",
  "matchScore",
  "points",
  "evidence",
  "rank",
  "rankScore",
  "percentage",
  "confidence",
];

function assertNoNumericScoreFields(record) {
  for (const key of FORBIDDEN_NUMERIC_KEYS) {
    assert.equal(key in record, false, `Unexpected numeric score field: ${key}`);
  }
  for (const [key, value] of Object.entries(record)) {
    assert.notEqual(typeof value, "number", `Field ${key} must not be a number in match output`);
  }
}

test("FIT_LEVELS and ROLE_LEVELS expose the canonical non-numeric levels", () => {
  assert.deepEqual(FIT_LEVELS, ["strong", "possible", "weak", "unknown"]);
  assert.deepEqual(ROLE_LEVELS, [
    "entry",
    "individual",
    "senior",
    "lead",
    "supervisor",
    "manager",
    "director",
    "executive",
  ]);
});

test("inferRoleLevel and compareRoleLevels classify titles without inventing facts", () => {
  assert.equal(inferRoleLevel("Junior Project Coordinator"), "entry");
  assert.equal(inferRoleLevel("Millwright"), "individual");
  assert.equal(inferRoleLevel("Account Executive"), "individual");
  assert.equal(inferRoleLevel("Executive Assistant"), "individual");
  assert.equal(inferRoleLevel("Senior Accountant"), "senior");
  assert.equal(inferRoleLevel("Production Team Lead"), "lead");
  assert.equal(inferRoleLevel("Staff Engineer"), "lead");
  assert.equal(inferRoleLevel("Staff Accountant"), "individual");
  assert.equal(inferRoleLevel("Maintenance Supervisor"), "supervisor");
  assert.equal(inferRoleLevel("Program Manager"), "manager");
  assert.equal(inferRoleLevel("Plant Controller"), "manager");
  assert.equal(inferRoleLevel("Director of Operations"), "director");
  assert.equal(inferRoleLevel("VP of Manufacturing"), "executive");
  assert.equal(inferRoleLevel("Title not recorded"), null);
  assert.equal(inferRoleLevel(""), null);

  const exact = compareRoleLevels({ title: "Program Manager" }, { title: "Senior Program Manager" });
  assert.equal(exact.status, "match");
  assert.equal(exact.jobLevel, "manager");
  assert.equal(exact.candidateLevel, "manager");
  assert.equal(exact.reason, "Level match: manager");

  const mismatch = compareRoleLevels({ title: "Program Manager" }, { title: "Junior Program Coordinator" });
  assert.equal(mismatch.status, "mismatch");
  assert.equal(mismatch.gap, "Level mismatch: candidate is entry, job is manager");

  const fromHistory = compareRoleLevels(
    { title: "Program Manager" },
    {
      title: "Operations Specialist",
      workHistory: [{ title: "Program Manager", company: "Synthetic Corp" }],
    },
  );
  assert.equal(fromHistory.status, "history_match");
  assert.equal(fromHistory.reason, "Work history includes manager level role");
});

test("isOpenJob accepts active and open jobs and rejects closed, filled, held, or untitled jobs", () => {
  assert.equal(isOpenJob({ id: "DEMO-JOB-1", title: "Program Manager", status: "Active" }), true);
  assert.equal(isOpenJob({ id: "DEMO-JOB-2", job_title: "Program Manager", status: "Open" }), true);
  assert.equal(isOpenJob({ id: "DEMO-JOB-3", title: "Program Manager" }), false);
  assert.equal(isOpenJob({ id: "DEMO-JOB-3", title: "Program Manager", isOpen: true }), true);

  for (const status of ["Closed", "Filled", "On Hold", "Cancelled", "Canceled", "Inactive", "Paused", "Archived"]) {
    assert.equal(isOpenJob({ id: "DEMO-JOB-X", title: "Program Manager", status }), false, `Status ${status} should not be open`);
  }
  assert.equal(isOpenJob({ id: "DEMO-JOB-4", title: "Program Manager", status: "Active", isOpen: false }), false);
  assert.equal(isOpenJob({ id: "DEMO-JOB-5", title: "Job title not on file", status: "Active" }), false);
  assert.equal(isOpenJob(null), false);
});

test("matchCandidateToOpenJobs ranks open Canadian jobs by title, Canadian location, and level without numeric scores", () => {
  const candidate = {
    id: "DEMO-PERSON-PM-01",
    name: "Taylor Synthetic",
    title: "Program Manager",
    location: "Toronto, ON",
  };

  const matches = matchCandidateToOpenJobs(candidate, SYNTHETIC_OPEN_JOBS);
  assert.deepEqual(
    matches.map((m) => m.jobId),
    ["DEMO-JOB-PM-ON", "DEMO-JOB-PROJ-ON", "DEMO-JOB-PM-BC"],
  );

  const topMatch = matches[0];
  assert.equal(topMatch.level, "strong");
  assert.equal(topMatch.fitLevel, "strong");
  assert.equal(topMatch.jobLevel, "manager");
  assert.equal(topMatch.candidateLevel, "manager");
  assert.match(topMatch.reasons.join(" | "), /Title matches: program/);
  assert.match(topMatch.reasons.join(" | "), /Level match: manager/);
  assert.match(topMatch.reasons.join(" | "), /Same city: Toronto/);
  assert.match(topMatch.reasons.join(" | "), /Same province: Ontario/);

  const relatedMatch = matches[1];
  assert.equal(relatedMatch.jobId, "DEMO-JOB-PROJ-ON");
  assert.equal(relatedMatch.level, "possible");
  assert.match(relatedMatch.reasons.join(" | "), /Related title terms: project, program/);
  assert.match(relatedMatch.reasons.join(" | "), /Level match: manager/);
  assert.match(relatedMatch.reasons.join(" | "), /Same province: Ontario/);

  const crossProvinceMatch = matches[2];
  assert.equal(crossProvinceMatch.jobId, "DEMO-JOB-PM-BC");
  assert.equal(crossProvinceMatch.level, "possible");
  assert.match(crossProvinceMatch.reasons.join(" | "), /Job and candidate are in Canada/);
  assert.match(crossProvinceMatch.reasons.join(" | "), /Different province: candidate in Ontario, job in British Columbia/);

  for (const match of matches) {
    assertNoNumericScoreFields(match);
  }
});

test("level mismatch downgrades fit and prevents Junior or IC candidates from matching Manager roles as strong or possible", () => {
  const juniorCandidate = {
    id: "DEMO-PERSON-JR-01",
    name: "Jordan Example",
    title: "Junior Program Coordinator",
    location: "Toronto, ON",
  };

  const defaultMatches = matchCandidateToOpenJobs(juniorCandidate, SYNTHETIC_OPEN_JOBS);
  assert.deepEqual(defaultMatches, []);

  const singleMatch = matchCandidateToJob(juniorCandidate, SYNTHETIC_OPEN_JOBS[0]);
  assert.equal(singleMatch.level, "weak");
  assert.equal(singleMatch.candidateLevel, "entry");
  assert.equal(singleMatch.jobLevel, "manager");
  assert.match(singleMatch.gaps.join(" | "), /Level mismatch: candidate is entry, job is manager/);
  assert.match(singleMatch.reasons.join(" | "), /Level mismatch: candidate is entry, job is manager/);
  assertNoNumericScoreFields(singleMatch);
});

test("Canadian location rules reject non-Canadian candidates for Canadian jobs and flag missing locations without inventing facts", () => {
  assert.equal(canadianCity("Toronto, ON"), "Toronto");
  assert.equal(canadianCity("London, UK"), "");
  assert.equal(province("Kitchener, ON"), "Ontario");
  assert.equal(isInCanada("Austin, TX"), false);

  const usCandidate = {
    id: "DEMO-PERSON-US-01",
    name: "Casey Example",
    title: "Program Manager",
    location: "Austin, TX",
  };

  assert.deepEqual(matchCandidateToOpenJobs(usCandidate, SYNTHETIC_OPEN_JOBS), []);

  const evaluated = matchCandidateToJob(usCandidate, SYNTHETIC_OPEN_JOBS[0]);
  assert.equal(evaluated.level, "weak");
  assert.match(evaluated.gaps.join(" | "), /Candidate location is not identified as Canada/);
  assertNoNumericScoreFields(evaluated);

  const unknownLocCandidate = {
    id: "DEMO-PERSON-NOLOC-01",
    name: "Morgan Example",
    title: "Program Manager",
    location: "",
  };
  const unknownLocMatches = matchCandidateToOpenJobs(unknownLocCandidate, SYNTHETIC_OPEN_JOBS);
  assert.equal(unknownLocMatches[0].jobId, "DEMO-JOB-PM-ON");
  assert.equal(unknownLocMatches[0].level, "possible");
  assert.match(unknownLocMatches[0].gaps.join(" | "), /Candidate location is not in source/);
});

test("matcher handles Supabase view and Tracker row field names and strips placeholder values", () => {
  const dbCandidate = {
    candidate_id: "DEMO-CAND-DB-01",
    candidate_name: "Riley Synthetic",
    current_title: "Maintenance Manager",
    location: "Cambridge, ON",
    profile_summary: "8 years in manufacturing maintenance and lean reliability.",
    work_history: [
      { title: "Millwright", bullets: ["Maintained fabrication and welding equipment."] },
    ],
  };

  const dbJobs = [
    {
      job_id: "DEMO-JOB-DB-MAINT",
      job_title: "Maintenance Manager",
      company: "Company not recorded",
      location: "Cambridge, ON",
      status: "Active",
      job_description: "Manufacturing plant requiring 5 years of maintenance leadership.",
    },
    {
      job_id: "DEMO-JOB-DB-MILL",
      job_title: "Millwright",
      company: "Synthetic Metal Works",
      location: "Kitchener, ON",
      status: "Active",
    },
  ];

  const matches = findBestJobMatches(dbCandidate, dbJobs);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].jobId, "DEMO-JOB-DB-MAINT");
  assert.equal(matches[0].level, "strong");
  assert.equal(matches[0].company, "");
  assert.equal(matches[1].jobId, "DEMO-JOB-DB-MILL");
  assert.match(matches[1].reasons.join(" | "), /Work history includes individual level role/);

  const emptyCandidate = {
    id: "DEMO-PERSON-EMPTY",
    name: "Unnamed candidate",
    title: "Title not recorded",
    location: "Unknown",
  };
  const unknownFit = scoreFit(dbJobs[0], emptyCandidate);
  assert.deepEqual(unknownFit, {
    level: "unknown",
    strengths: [],
    gaps: ["No title or work history in source"],
    roleMatches: [],
    basis: "rules",
  });
});

test("matchCandidatesToOpenJobs and matchCandidatesForJob support batch matching with Canada-only default", () => {
  const candidates = [
    {
      id: "DEMO-PERSON-1",
      name: "Alex Synthetic",
      title: "Program Manager",
      location: "Toronto, ON",
    },
    {
      id: "DEMO-PERSON-2",
      name: "Sam Synthetic",
      title: "Project Manager",
      location: "Brampton, ON",
    },
    {
      id: "DEMO-PERSON-3",
      name: "Pat US",
      title: "Program Manager",
      location: "Austin, TX",
    },
  ];

  const byCandidate = matchCandidatesToOpenJobs(candidates, SYNTHETIC_OPEN_JOBS, { limit: 2 });
  assert.equal(byCandidate.length, 3);
  assert.equal(byCandidate[0].matches.length, 2);
  assert.equal(byCandidate[0].matches[0].jobId, "DEMO-JOB-PM-ON");
  assert.equal(byCandidate[2].matches.length, 0);

  const forJob = matchCandidatesForJob(SYNTHETIC_OPEN_JOBS[0], candidates);
  assert.deepEqual(forJob.map((item) => item.candidateId), ["DEMO-PERSON-1", "DEMO-PERSON-2"]);
  assert.equal(forJob[0].level, "strong");
  assert.equal(forJob[1].level, "possible");
  for (const item of forJob) {
    assertNoNumericScoreFields(item);
  }
});
