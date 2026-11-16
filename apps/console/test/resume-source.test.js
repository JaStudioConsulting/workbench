import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getResumeSource } from "../src/features/candidate-review/brandResume.js";

const consoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resumeSectionSource = fs.readFileSync(
  path.join(consoleRoot, "src/features/candidate-review/ResumeSection.jsx"),
  "utf8",
);

test("resume source preserves the source resume verbatim", () => {
  const text = "Candidate Name\nRaised output by 18%\n  Kept source spacing.";
  const source = getResumeSource({ name: "Candidate Name", fullResumeText: text });

  assert.equal(source.kind, "resume");
  assert.equal(source.text, text);
  assert.deepEqual(source.usedSources, ["fullResumeText"]);
});

test("resume source builds a profile only from available source fields", () => {
  const source = getResumeSource({
    name: "Candidate Name",
    title: "Maintenance Manager",
    skills: ["Preventive maintenance", "Team leadership"],
    callNotes: "Prefers a day shift.",
  });

  assert.equal(source.kind, "profile");
  assert.match(source.text, /Candidate Name/);
  assert.match(source.text, /Maintenance Manager/);
  assert.match(source.text, /Preventive maintenance, Team leadership/);
  assert.match(source.text, /Prefers a day shift\./);
  assert.deepEqual(source.usedSources, ["name", "title", "skills", "callNotes"]);
  assert.doesNotMatch(source.text, /not provided|not in source/i);
});

test("resume source reports none when profile evidence is insufficient", () => {
  assert.deepEqual(getResumeSource({ name: "Candidate Name" }), {
    kind: "none",
    text: "",
    usedSources: [],
  });
});

test("profile resume source keeps supplied experience and transcript without invention", () => {
  const source = getResumeSource({
    name: "Candidate Name",
    workHistory: [{
      title: "Millwright",
      company: "Example Manufacturing",
      startDate: "2021",
      endDate: "2024",
      bullets: ["Maintained conveyors and presses."],
    }],
    transcriptText: "Worked rotating shifts.",
  });

  assert.equal(source.kind, "profile");
  assert.match(source.text, /Millwright at Example Manufacturing/);
  assert.match(source.text, /2021 to 2024/);
  assert.match(source.text, /- Maintained conveyors and presses\./);
  assert.match(source.text, /Worked rotating shifts\./);
  assert.doesNotMatch(source.text, /unknown|not provided|source profile/i);
});

test("profile provenance appears in the internal resume section", () => {
  assert.match(resumeSectionSource, /Built from profile, no resume on file/);
  assert.match(resumeSectionSource, /Sources used:/);
});
