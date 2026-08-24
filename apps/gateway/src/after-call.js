import { CandidateInputSchema, WorkflowOutputSchema } from "@ja/shared-types";

const SOURCES = ["resume", "transcript", "call_notes"];

function auditFor(input) {
  const providedSources = SOURCES.filter((source) => (
    source === "resume" ? Boolean(input.resumeText) : source === "transcript" ? Boolean(input.transcriptText) : Boolean(input.callNotes)
  ));
  return { providedSources, missingSources: SOURCES.filter((source) => !providedSources.includes(source)), supportedClaims: input.verifiedFacts };
}

function claimLines(facts) { return facts.map((fact) => `${fact.label}: ${fact.value}`); }

function normalized(text) { return String(text).replace(/\s+/g, " ").trim().toLowerCase(); }

function sourceText(input, source) {
  return source === "resume" ? input.resumeText : source === "transcript" ? input.transcriptText : input.callNotes;
}

function acceptedFacts(input) {
  return input.verifiedFacts.map((fact) => {
    const text = sourceText(input, fact.source);
    if (!text) throw new Error(`Verified fact source is missing: ${fact.source}`);
    const evidence = normalized(fact.evidence);
    const value = normalized(fact.value);
    if (!value || !normalized(text).includes(value)) {
      throw new Error(`Verified fact value is not present in ${fact.source}`);
    }
    if (!evidence || !normalized(text).includes(evidence)) {
      throw new Error(`Verified fact evidence is not present in ${fact.source}`);
    }
    return fact;
  });
}

export function prepareAfterCallWorkflow(rawInput, authority) {
  if (authority?.id !== "recruiter") throw new Error("Recruiter authority is required");
  const input = CandidateInputSchema.parse(rawInput);
  const audit = auditFor({ ...input, verifiedFacts: acceptedFacts(input) });
  const claims = claimLines(audit.supportedClaims);
  return WorkflowOutputSchema.parse({
    authority: "recruiter",
    audit,
    brandedResume: { status: "draft", content: ["Professional Summary", ...claims, "Recruiter review required."].join("\n") },
    submission: { status: "draft", fields: { profileSummary: claims } },
    presentationEmail: { status: "draft", subject: "Candidate profile for review", body: ["Hi,", "", ...claims, "", "This is an unsent draft and requires recruiter approval."].join("\n") },
    loxoDraft: { status: "draft", bullets: claims },
    reviewRequired: true,
  });
}
