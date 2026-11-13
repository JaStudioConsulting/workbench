import assert from "node:assert/strict";
import test from "node:test";
import { prepareAfterCallWorkflow } from "../src/after-call.js";

const candidate = {
  candidateId: "sourcing:7",
  name: "Avery Sampleton",
  title: "Maintenance Supervisor",
  resumeText: "Avery Sampleton. Maintenance Supervisor at Acme Plant, 2020 - Present. Led 12 maintenance technicians. Preventive maintenance. CMMS. Diploma, Example College.",
  transcriptText: "Available with two weeks notice. Current compensation is $120,000.",
  jobDescription: "Maintenance Manager at Acme Manufacturing.",
};
const resolvedCandidate = { id: candidate.candidateId, candidate_name: candidate.name, current_title: candidate.title };
const evidence = (source, quote) => ({ source, quote });
const claim = (text, source, quote) => ({ text, evidence: [evidence(source, quote)] });
const field = (value = null, source = null, quote = null) => ({ value, evidence: value ? [evidence(source, quote)] : [] });

function modelDraft({ invalidEvidence = false, conflictingCompensation = false } = {}) {
  const titleQuote = invalidEvidence ? "Maintenance Supervisor" : "Maintenance Supervisor";
  return {
    resume: {
      name: field("Avery Sampleton", "resume", "Avery Sampleton"),
      title: field("Maintenance Supervisor", "resume", titleQuote),
      summary: [claim("Led 12 maintenance technicians.", "resume", "Led 12 maintenance technicians.")],
      skills: [claim("Preventive maintenance", "resume", "Preventive maintenance"), claim("CMMS", "resume", "CMMS")],
      experience: [{
        title: field("Maintenance Supervisor", "resume", "Maintenance Supervisor"),
        dates: field("2020 - Present", "resume", "2020 - Present"),
        company: field("Acme Plant", "resume", "Acme Plant"),
        location: field(),
        bullets: [claim("Led 12 maintenance technicians.", "resume", "Led 12 maintenance technicians.")],
      }],
      education: [claim("Diploma, Example College.", "resume", "Diploma, Example College.")],
      certifications: [],
      additionalInformation: [],
    },
    submission: {
      fields: {
        name: field("Avery Sampleton", "candidate_record", "Avery Sampleton"),
        title: field("Maintenance Manager", "job_description", "Maintenance Manager"),
        compensationTarget: field(),
        currentCompensation: field(),
        vacation: field(),
        location: field(),
        workStatus: field(),
        interviewAvailability: field("Two weeks notice", "transcript", "two weeks notice"),
        startDate: field(),
        reasonForLeaving: field(),
        profileSummary: [claim("Led 12 maintenance technicians.", "resume", "Led 12 maintenance technicians.")],
      },
      client: field("Acme Manufacturing", "job_description", "Acme Manufacturing"),
    },
    loxoBullets: [claim("Available with two weeks notice.", "transcript", "Available with two weeks notice.")],
    conflicts: conflictingCompensation ? [{
      field: "current_compensation",
      evidence: [evidence("resume", "Current compensation is $100,000."), evidence("transcript", "Current compensation is $120,000.")],
    }] : [],
  };
}

function clientFor(draft) {
  return { messages: { create: async () => ({ content: [{ type: "text", text: JSON.stringify(draft) }] }) } };
}

test("AI after-call output contains the required resume structure and a branded review PDF", async () => {
  const output = await prepareAfterCallWorkflow(candidate, { id: "recruiter" }, { env: { ANTHROPIC_API_KEY: "synthetic-test-key" }, client: clientFor(modelDraft()), resolvedCandidate });
  assert.equal(output.authority, "recruiter");
  assert.equal(output.audit.finalizationBlocked, false);
  assert.equal(output.audit.identityReviewRequired, false);
  assert.equal(output.audit.missingSources.includes("transcript"), false);
  assert.deepEqual(output.brandedResume.sections.skills.map((item) => item.text), ["Preventive maintenance", "CMMS"]);
  assert.match(output.brandedResume.content, /Professional Summary/);
  assert.match(output.brandedResume.content, /Core Competencies & Skills/);
  assert.match(output.brandedResume.content, /Professional Experience/);
  assert.match(output.brandedResume.content, /Education/);
  assert.match(output.brandedResume.content, /Certifications/);
  assert.equal(output.brandedResume.exportStatus, "draft_rendered");
  assert.equal(output.brandedResume.pdf.mimeType, "application/pdf");
  assert.match(Buffer.from(output.brandedResume.pdf.base64, "base64").toString("ascii", 0, 5), /^%PDF-/);
  assert.equal(output.brandedResume.pdf.reviewLabel, "Draft for recruiter review");
  assert.equal(output.presentationEmail.attachmentStatus, "not_generated");
  assert.doesNotMatch(output.presentationEmail.body, /CV attached\./);
  assert.equal(output.reviewRequired, true);
});

test("unresolved compensation conflicts block finalization while drafts remain available", async () => {
  const input = { ...candidate, resumeText: `${candidate.resumeText} Current compensation is $100,000.` };
  const output = await prepareAfterCallWorkflow(input, { id: "recruiter" }, { env: { ANTHROPIC_API_KEY: "synthetic-test-key" }, client: clientFor(modelDraft({ conflictingCompensation: true })), resolvedCandidate });
  assert.equal(output.audit.finalizationBlocked, true);
  assert.equal(output.audit.conflicts[0].field, "current_compensation");
  assert.match(output.audit.conflicts[0].description, /\$100,000/);
  assert.equal(output.submission.status, "draft");
});

test("missing model configuration and invalid source citations never produce a fallback draft", async () => {
  await assert.rejects(prepareAfterCallWorkflow(candidate, { id: "recruiter" }, { env: {}, resolvedCandidate }), { code: "AI_NOT_CONFIGURED", status: 503 });
  const bad = modelDraft();
  bad.resume.summary[0].evidence[0].quote = "Built an unsupported new plant";
  await assert.rejects(
    prepareAfterCallWorkflow(candidate, { id: "recruiter" }, { env: { ANTHROPIC_API_KEY: "synthetic-test-key" }, client: clientFor(bad), resolvedCandidate }),
    { code: "AI_INVALID_OUTPUT", status: 502 },
  );
});

test("non-recruiter authority cannot request an after-call draft", async () => {
  await assert.rejects(prepareAfterCallWorkflow(candidate, { id: "other" }, { env: { ANTHROPIC_API_KEY: "synthetic-test-key" }, client: clientFor(modelDraft()), resolvedCandidate }), /Recruiter authority is required/);
});

test("resume identity mismatch is blocked even when the model omits an identity conflict", async () => {
  const input = { ...candidate, resumeText: candidate.resumeText.replace("Avery Sampleton", "Other Sample") };
  const draft = modelDraft();
  draft.resume.name = field("Other Sample", "resume", "Other Sample");
  draft.submission.fields.name = field("Other Sample", "resume", "Other Sample");
  const output = await prepareAfterCallWorkflow(input, { id: "recruiter" }, {
    env: { ANTHROPIC_API_KEY: "synthetic-test-key" }, client: clientFor(draft), resolvedCandidate,
  });
  assert.equal(output.audit.identityReviewRequired, true);
  assert.equal(output.audit.finalizationBlocked, true);
  assert.equal(output.audit.conflicts.some((item) => item.field === "identity"), true);
  assert.equal(output.submission.status, "draft");
});

test("resume name copied only from the selected record requires identity review", async () => {
  const draft = modelDraft();
  draft.resume.name = field("Avery Sampleton", "candidate_record", "Avery Sampleton");
  const output = await prepareAfterCallWorkflow(candidate, { id: "recruiter" }, {
    env: { ANTHROPIC_API_KEY: "synthetic-test-key" }, client: clientFor(draft), resolvedCandidate,
  });
  assert.equal(output.audit.identityReviewRequired, true);
  assert.equal(output.audit.finalizationBlocked, true);
});

test("selected candidate must resolve to the request's canonical ID", async () => {
  await assert.rejects(prepareAfterCallWorkflow(candidate, { id: "recruiter" }, {
    env: { ANTHROPIC_API_KEY: "synthetic-test-key" }, client: clientFor(modelDraft()),
    resolvedCandidate: { ...resolvedCandidate, id: "submission:7" },
  }), /live selected candidate record/);
});
