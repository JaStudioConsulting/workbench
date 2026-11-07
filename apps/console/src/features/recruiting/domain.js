import { CandidateInputSchema, WorkflowOutputSchema } from "@ja/shared-types";

// Provenance: JaStudioConsulting/recruitment-skills @ 0d74d99883bc4b0d31362bf2dc6aac74ac78bb61
// skills/tracker-manager/references/sf-jobs-contract.md (SF Jobs read surface)
// skills/recruiter/references/candidate-prep-workspace.md (draft-only case contract)
// skills/recruiter/modules/loxo/GUIDE.md (Loxo read/draft boundary)
// skills/recruiter/assets/job-template-kit/{rejection,campaign-step}.md (approved copy)
export const NEEDS_VERIFICATION = "NEEDS VERIFICATION";

const demoJob = (company, title, loxoJobId) => Object.freeze({
  company,
  title,
  loxoJobId,
  demoOnly: true,
});

// Intentionally synthetic and unusable as a live Tracker/SF Jobs record.
export const DEMO_SF_JOBS_HIERARCHY = Object.freeze([
  Object.freeze({
    company: "DEMO COMPANY: NOT A LIVE RECORD",
    demoOnly: true,
    jobs: Object.freeze([
      demoJob("DEMO COMPANY: NOT A LIVE RECORD", "DEMO STAFF ACCOUNTANT", "DEMO-LOXO-JOB-001"),
      demoJob("DEMO COMPANY: NOT A LIVE RECORD", "DEMO SENIOR ACCOUNTANT", "DEMO-LOXO-JOB-002"),
    ]),
  }),
]);

export function createBlankCandidateIntake() {
  return {
    name: "",
    title: "",
    resumeText: "",
    transcriptText: "",
    jobDescription: "",
    callNotes: "",
    verifiedFacts: [],
  };
}

const actionNames = ["tracker", "gmail", "loxo"];
const stages = ["intake", "source_review", "drafting", "draft_ready", "verified", "blocked_authorization"];
const transitions = Object.freeze({
  intake: ["source_review"],
  source_review: ["drafting"],
  drafting: ["draft_ready"],
  draft_ready: ["verified", "blocked_authorization"],
  verified: ["blocked_authorization"],
  blocked_authorization: [],
});

export const INITIAL_RECRUITING_STATE = Object.freeze({
  stage: "intake",
  approvals: Object.freeze({ tracker: "not_requested", gmail: "not_requested", loxo: "not_requested" }),
});

export function advanceRecruitingStage(state, nextStage) {
  if (!stages.includes(nextStage) || !transitions[state.stage]?.includes(nextStage)) {
    throw new Error(`Invalid recruiting stage transition: ${state.stage} -> ${nextStage}`);
  }
  return { ...state, stage: nextStage };
}

export function requestApproval(state, action) {
  if (!actionNames.includes(action)) throw new Error(`Unknown approval action: ${action}`);
  if (state.stage !== "verified") throw new Error("External approvals require a verified draft");
  return { ...state, approvals: { ...state.approvals, [action]: "pending" } };
}

export function approveAction(state, action) {
  if (!actionNames.includes(action)) throw new Error(`Unknown approval action: ${action}`);
  if (state.stage !== "verified") throw new Error("External approvals require a verified draft");
  if (state.approvals[action] !== "pending") throw new Error("Only pending actions can be approved");
  return { ...state, approvals: { ...state.approvals, [action]: "approved" } };
}

function normalized(text) {
  return String(text).replace(/\s+/g, " ").trim().toLowerCase();
}

function sourceText(input, source) {
  return source === "resume" ? input.resumeText : source === "transcript" ? input.transcriptText : input.callNotes;
}

// Adapted from recruitment-skills/skills/recruiter/modules/after-call.js acceptedFacts:
// value and evidence must both be contained in the declared supplied source.
function acceptedFacts(input) {
  return (input.verifiedFacts ?? []).filter((candidateFact) => {
    const text = sourceText(input, candidateFact.source);
    if (!text) return false;
    return normalized(text).includes(normalized(candidateFact.value)) && normalized(text).includes(normalized(candidateFact.evidence));
  });
}

function factMap(input) {
  return new Map(acceptedFacts(input).map((candidateFact) => [candidateFact.label.toLowerCase(), candidateFact.value]));
}

function fact(input, label) {
  return factMap(input).get(label.toLowerCase()) ?? NEEDS_VERIFICATION;
}

function sourceList(input) {
  return ["resume", "transcript", "call_notes"].filter((source) => {
    const key = source === "resume" ? "resumeText" : source === "transcript" ? "transcriptText" : "callNotes";
    return Boolean(input[key]?.trim());
  });
}

export function generateRecruitingDrafts(rawInput, job) {
  const input = CandidateInputSchema.parse(rawInput);
  if (!job?.company || !job?.title || !job?.loxoJobId || job.demoOnly !== true) {
    throw new Error("A demo-only SF Jobs child job with company, title, and Loxo Job ID is required");
  }
  const providedSources = sourceList(input);
  const supportedClaims = acceptedFacts(input);
  const summary = [
    `${input.name}: ${input.title}`,
    `Target role: ${job.title} at ${job.company}`,
    `Compensation target: ${fact(input, "compensation target")}`,
    `Location: ${fact(input, "location")}`,
    `Availability: ${fact(input, "availability")}`,
  ];
  const submissionFields = {
    name: input.name,
    title: job.title,
    compensationTarget: fact(input, "compensation target"),
    currentCompensation: fact(input, "current compensation"),
    vacation: fact(input, "vacation"),
    location: fact(input, "location"),
    workStatus: fact(input, "work status"),
    interviewAvailability: fact(input, "interview availability"),
    startDate: fact(input, "start date"),
    reasonForLeaving: fact(input, "reason for leaving"),
    profileSummary: summary,
  };
  const result = {
    authority: "recruiter",
    audit: { providedSources, missingSources: ["resume", "transcript", "call_notes"].filter((source) => !providedSources.includes(source)), supportedClaims },
    brandedResume: {
      status: "draft",
      content: [`Name: ${input.name}`, `Title: ${input.title}`, "Professional Summary", `${input.name} brings source-backed experience relevant to ${job.title} at ${job.company}.`, "Core Competencies & Skills", fact(input, "core competencies"), "Professional Experience", input.resumeText, "Education", fact(input, "education"), "Certifications", fact(input, "certifications"), "Additional Information", `Target role: ${job.title}`].join("\n"),
    },
    submission: { status: "draft", fields: submissionFields },
    presentationEmail: {
      status: "draft",
      subject: `${input.name}: ${job.title}`,
      body: `Please review ${input.name} for the ${job.title} opportunity at ${job.company}.\n\n${summary.join("\n")}\n\nLoxo Job ID: ${job.loxoJobId}`,
    },
    loxoDraft: {
      status: "draft",
      bullets: [`Job: ${job.title} (${job.loxoJobId})`, `Compensation expectation: ${fact(input, "compensation target")}`, `Call notes: ${fact(input, "call notes")}`],
    },
    reviewRequired: true,
  };
  const validated = WorkflowOutputSchema.parse(result);
  return { ...validated, submission: { ...validated.submission, fields: submissionFields } };
}

export function generateJobSpecificMessages(rawInput, job) {
  const input = CandidateInputSchema.parse(rawInput);
  if (!job?.demoOnly) throw new Error("Only demo-only jobs are supported");
  const firstName = input.name.split(/\s+/)[0] || NEEDS_VERIFICATION;
  return {
    rejection: `Subject: Update on ${job.title} at ${job.company}\n\nHi ${firstName},\n\nThank you for your time and interest in the ${job.title} opportunity with ${job.company}. We are moving forward with other candidates whose experience is closer to the current requirements.\n\nWe appreciate your interest and will keep your information in mind for a role that is a stronger match.`,
    campaignStep: `Subject: ${job.title} at ${job.company}\n\nHi ${firstName},\n\n${NEEDS_VERIFICATION}\n\nRole details: ${NEEDS_VERIFICATION}\n\nIf this is relevant, reply here and I will share the next step.`,
  };
}
