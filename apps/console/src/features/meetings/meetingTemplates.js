export const MEETING_TEMPLATES = Object.freeze([
  {
    id: "candidate_screen",
    label: "Candidate screen",
    sections: [
      ["Current situation", ["current", "role", "company", "leaving", "search"]],
      ["Experience", ["experience", "worked", "responsible", "skill", "project"]],
      ["Motivation", ["motivat", "interest", "looking", "reason"]],
      ["Compensation and vacation", ["salary", "compensation", "pay", "vacation", "bonus"]],
      ["Location and work status", ["location", "live", "commute", "remote", "hybrid", "citizen", "permit", "status"]],
      ["Availability and next steps", ["available", "interview", "start", "notice", "next step"]],
    ],
  },
  {
    id: "client_intake",
    label: "Client intake",
    sections: [
      ["Role and business need", ["role", "position", "need", "opening", "replace", "growth"]],
      ["Responsibilities", ["responsib", "manage", "lead", "report", "day to day"]],
      ["Required experience", ["experience", "required", "must", "skill", "industry"]],
      ["Compensation and terms", ["salary", "compensation", "pay", "bonus", "vacation", "contract"]],
      ["Interview process", ["interview", "stage", "meet", "assessment"]],
      ["Timeline and next steps", ["timeline", "start", "urgent", "next step", "follow up"]],
    ],
  },
  {
    id: "reference_check",
    label: "Reference check",
    sections: [
      ["Relationship and context", ["relationship", "worked", "report", "manager", "colleague"]],
      ["Responsibilities", ["responsib", "role", "duties", "managed"]],
      ["Performance and strengths", ["performance", "strength", "success", "result", "excel"]],
      ["Development areas", ["develop", "improve", "weak", "feedback", "challenge"]],
      ["Reliability", ["reliable", "attendance", "deadline", "dependable"]],
      ["Rehire and final comments", ["rehire", "recommend", "again", "final", "anything else"]],
    ],
  },
]);

function transcriptSentences(transcript) {
  return String(transcript || "").split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
}

export function renderMeetingTemplate(templateId, transcript) {
  const template = MEETING_TEMPLATES.find((item) => item.id === templateId) || MEETING_TEMPLATES[0];
  const sentences = transcriptSentences(transcript);
  const sections = template.sections.map(([heading, keywords]) => {
    const matches = sentences.filter((sentence) => keywords.some((keyword) => sentence.toLowerCase().includes(keyword)));
    return { heading, content: matches.length ? matches.join(" ") : "Not discussed" };
  });
  return {
    id: template.id,
    label: template.label,
    sections,
    markdown: [`# ${template.label}`, "", ...sections.flatMap((section) => [`## ${section.heading}`, "", section.content, ""])].join("\n").trim(),
  };
}

