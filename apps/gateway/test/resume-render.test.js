import assert from "node:assert/strict";
import test from "node:test";
import { renderResume } from "../src/resume-render.js";

const claim = (text) => ({ text });
const field = (value) => ({ value });

test("renderResume preserves the branded resume text layout", () => {
  const resume = {
    name: field("Avery Sampleton"),
    title: field("Maintenance Supervisor"),
    summary: [claim("Led 12 maintenance technicians.")],
    skills: [claim("Preventive maintenance"), claim("CMMS")],
    experience: [{
      title: field("Maintenance Supervisor"),
      dates: field("2020 - Present"),
      company: field("Acme Plant"),
      location: field("Toronto, ON"),
      bullets: [claim("Led 12 maintenance technicians.")],
    }],
    education: [claim("Diploma, Example College.")],
    certifications: [],
    additionalInformation: [],
  };

  assert.equal(renderResume(resume), [
    "Name\nAvery Sampleton",
    "Title\nMaintenance Supervisor",
    "Professional Summary\nLed 12 maintenance technicians.",
    "Core Competencies & Skills\n• Preventive maintenance\n• CMMS",
    "Professional Experience\nMaintenance Supervisor | 2020 - Present\nAcme Plant | Toronto, ON\n• Led 12 maintenance technicians.",
    "Education\nDiploma, Example College.",
    "Certifications",
    "Additional Information",
  ].join("\n\n"));
});
