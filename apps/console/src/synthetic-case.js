import { prepareAfterCallWorkflow } from "../../gateway/src/after-call.js";

export const syntheticCase = Object.freeze({
  candidate: Object.freeze({
    name: "Avery Sampleton",
    title: "Maintenance Supervisor",
    role: "Maintenance Supervisor - Example Manufacturing",
  }),
  sources: Object.freeze({
    resume: "Maintenance Supervisor with 10 years of manufacturing experience. Led 12 maintenance technicians. Holds a 433A Industrial Mechanic Millwright certificate.",
    transcript: "Current compensation is $105,000. Target compensation is $115,000. Two weeks notice. Available for interviews Tuesday or Thursday afternoon.",
    jobDescription: "Lead plant maintenance, coach skilled trades, improve preventive maintenance, and support safe production uptime.",
    callNotes: "Open to Exampleton. Interested in a hands-on leadership role. Reason for leaving: limited advancement in current organization.",
  }),
  facts: Object.freeze([
    Object.freeze({ label: "Team leadership", value: "Led 12 maintenance technicians", source: "resume", evidence: "Led 12 maintenance technicians" }),
    Object.freeze({ label: "Certification", value: "433A Industrial Mechanic Millwright", source: "resume", evidence: "433A Industrial Mechanic Millwright" }),
    Object.freeze({ label: "Compensation target", value: "$115,000", source: "transcript", evidence: "Target compensation is $115,000" }),
    Object.freeze({ label: "Interview availability", value: "Tuesday or Thursday afternoon", source: "transcript", evidence: "Available for interviews Tuesday or Thursday afternoon" }),
    Object.freeze({ label: "Location preference", value: "Open to Exampleton", source: "call_notes", evidence: "Open to Exampleton" }),
    Object.freeze({ label: "Reason for leaving", value: "Limited advancement in current organization", source: "call_notes", evidence: "limited advancement in current organization" }),
  ]),
});

export function runSyntheticRecruiter(sample = syntheticCase) {
  return prepareAfterCallWorkflow({
    name: sample.candidate.name,
    title: sample.candidate.title,
    resumeText: sample.sources.resume,
    transcriptText: sample.sources.transcript,
    jobDescription: sample.sources.jobDescription,
    callNotes: sample.sources.callNotes,
    verifiedFacts: sample.facts,
  }, { id: "recruiter" });
}
