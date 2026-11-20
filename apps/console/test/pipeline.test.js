import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";
import { scoreFit } from "../src/features/pipeline/fitScore.js";
import { isInCanada, province } from "../src/features/pipeline/location.js";
import { groupPipelineCandidates, resolvePendingStage } from "../src/features/pipeline/pendingStage.js";

test("Canada location matching uses province, territory, city, and country tokens", () => {
  assert.equal(isInCanada("Toronto, ON"), true);
  assert.equal(isInCanada("Yellowknife"), true);
  assert.equal(isInCanada("Remote, Canada"), true);
  assert.equal(province("Burnaby, B.C."), "British Columbia");
  assert.equal(province("Iqaluit, NU"), "Nunavut");
  assert.equal(isInCanada("London, UK"), false);
  assert.equal(isInCanada("Unknown"), false);
  assert.equal(isInCanada("Only remote"), false);
});

test("rules fit returns levels, source evidence, role matches, and no numeric score", () => {
  const result = scoreFit({
    title: "Automation Technician",
    location: "Cambridge, Ontario",
    description: "Automotive manufacturing role requiring 5 years of PLC and robotics maintenance.",
  }, {
    id: "candidate-1",
    title: "Robotics Technician",
    location: "Kitchener, ON",
    profileSummary: "6 years in automotive manufacturing, PLC maintenance, and robotics automation.",
    workHistory: [{ title: "Automation Technician", bullets: ["Maintained PLC and robotics cells."] }],
    activityTrail: [{ type: "AI Marked Yes", note: "Good Fit based on source review" }],
  });
  assert.equal(result.level, "strong");
  assert.equal(result.basis, "rules");
  assert.equal(result.roleMatches[0].index, 0);
  assert.match(result.strengths.join(" "), /Same province: Ontario/);
  assert.equal("score" in result, false);
});

test("rules fit is unknown without a title or work history", () => {
  assert.deepEqual(scoreFit({ title: "Controller" }, { location: "Toronto" }), {
    level: "unknown",
    strengths: [],
    gaps: ["No title or work history in source"],
    roleMatches: [],
    basis: "rules",
  });
});

test("FitBadge exposes deterministic evidence without AI controls or requests", async () => {
  const source = await readFile(new URL("../src/features/pipeline/FitBadge.jsx", import.meta.url), "utf8");
  assert.match(source, /scoreFit/);
  assert.match(source, /Rules check/);
  assert.match(source, /title="Strengths" items=\{result.strengths\}/);
  assert.match(source, /title="Gaps" items=\{result.gaps\}/);
  assert.doesNotMatch(source, /aiClient|evaluateFit|runAiCheck|fitCache|aiResult|Deep check with AI/);
  const result = await transformWithEsbuild(source, "FitBadge.jsx", { loader: "jsx", jsx: "automatic" });
  assert.match(result.code, /function FitBadge/);
});

test("pending stage moves are rebuilt from the persisted activity trail", () => {
  const candidate = {
    id: "sourcing:42",
    activityTrail: [
      { status: "Saved", targetStage: "Interview" },
      { status: "Waiting for Loxo", targetStage: "Screening" },
    ],
  };
  assert.equal(resolvePendingStage(candidate), "Screening");
  assert.equal(resolvePendingStage({ id: "a", activityTrail: [] }, { a: "Interview" }), "Interview");
  assert.equal(resolvePendingStage({ id: "b", activityTrail: [{ status: "Waiting for Loxo", targetStage: "Unsupported" }] }), null);
  assert.equal(resolvePendingStage({ id: "c" }), null);

  const original = { id: "d", name: "Unsupported candidate", stage: "Needs checking", activityTrail: [] };
  const grouped = groupPipelineCandidates([original], { d: "Applied" });
  assert.deepEqual(grouped.boardCandidates, []);
  assert.equal(grouped.unsupported[0].stage, "Needs checking");
});

test("Pipeline page loads live data, queues exact stage notes, and compiles", async () => {
  const source = await readFile(new URL("../src/features/pipeline/PipelinePage.jsx", import.meta.url), "utf8");
  assert.match(source, /loadLiveReviewJobs/);
  assert.match(source, /loadLiveCandidatesForJob/);
  assert.match(source, /getCachedLiveReviewJobs/);
  assert.match(source, /getCachedLiveCandidatesForJob/);
  assert.doesNotMatch(source, /SAMPLE_/);
  assert.match(source, /type: "\*Note"/);
  assert.match(source, /Stage move: \$\{from\} to \$\{to\}/);
  assert.match(source, /Waiting for Loxo/);
  assert.match(source, /groupPipelineCandidates/);
  assert.match(source, /DragDropProvider/);
  assert.match(source, /onOpenCandidate\?\.\(job\.id, candidate\.id\)/);
  assert.match(source, /items=\{jobSelectItems\}/);
  assert.match(source, /selectedJob: controlledJob = null/);
  assert.match(source, /controlledJob\?\.loxoJobId \|\| controlledJob\?\.originalJobId \|\| controlledJob\?\.id/);
  assert.match(source, /jobsState\.jobs\.some\(\(job\) => String\(job\.id\) === controlledJobId\)/);
  assert.match(source, /onValueChange=\{handleJobChange\}/);
  assert.match(source, /onSelectJob\?\.\(nextJob\)/);
  assert.match(source, /Current stage:/);
  assert.match(source, />Open<\/Button>/);
  assert.match(source, /onOpenCandidate\?\.\(candidate\.jobId \|\| selectedJobId, candidate\.id\)/);
  assert.match(source, /Move \$\{candidate\.name\} to stage/);
  assert.match(source, /<CandidatePresentationBadges/);
  assert.match(source, /<CandidatePresentationSummary/);
  assert.match(source, /prefix="pipeline"/);
  assert.doesNotMatch(source, /purple|violet|indigo|fuchsia|#6b4ea8/i);
  const result = await transformWithEsbuild(source, "PipelinePage.jsx", { loader: "jsx", jsx: "automatic" });
  assert.match(result.code, /function PipelinePage/);
});

test("Pipeline uses the saved Settings Canada preference, with Canada on by default", async () => {
  const source = await readFile(new URL("../src/features/pipeline/PipelinePage.jsx", import.meta.url), "utf8");
  assert.match(source, /useState\(\(\) => readCanadaFilter\(\)\)/);
  assert.match(source, /onCheckedChange=\{\(value\) => setCanadaOnly\(saveCanadaFilter\(Boolean\(value\)\)\)\}/);
});
