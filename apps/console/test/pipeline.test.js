import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";
import { evaluateFit, personalizeOutreach } from "../src/features/pipeline/aiClient.js";
import { scoreFit } from "../src/features/pipeline/fitScore.js";
import { isInCanada, province } from "../src/features/pipeline/location.js";
import { resolvePendingStage } from "../src/features/pipeline/pendingStage.js";

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

test("AI browser clients use authenticated gateway calls and preserve unavailable state", async () => {
  const calls = [];
  const options = {
    baseURL: "https://gateway.example.invalid",
    fetchImpl: async (url, request) => {
      calls.push({ url: url.toString(), request });
      if (url.pathname === "/api/fit/evaluate") {
        return { ok: false, status: 503, json: async () => ({ error: { code: "AI_NOT_CONFIGURED", message: "AI check not set up" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ subject: "Source subject", body: "Source body" }) };
    },
  };
  const fit = await evaluateFit({ id: "job-1" }, { id: "candidate-1" }, options);
  const outreach = await personalizeOutreach({ job: {}, candidate: {}, template: "Initial", body: "Hello" }, options);
  assert.deepEqual(fit, { ok: false, available: false, result: null, error: "AI check not set up" });
  assert.equal(outreach.ok, true);
  assert.equal(calls.every(({ request }) => request.credentials === "include"), true);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), ["/api/fit/evaluate", "/api/outreach/personalize"]);
});

test("FitBadge contract exposes rules evidence and deep AI check", async () => {
  const source = await readFile(new URL("../src/features/pipeline/FitBadge.jsx", import.meta.url), "utf8");
  assert.match(source, /scoreFit/);
  assert.match(source, /Deep check with AI/);
  assert.match(source, /AI check/);
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
});

test("Pipeline page loads live data, queues exact stage notes, and compiles", async () => {
  const source = await readFile(new URL("../src/features/pipeline/PipelinePage.jsx", import.meta.url), "utf8");
  assert.match(source, /loadLiveReviewJobs/);
  assert.match(source, /loadLiveCandidatesForJob/);
  assert.doesNotMatch(source, /getReviewJobs|getCandidatesForJob|SAMPLE_/);
  assert.match(source, /type: "\*Note"/);
  assert.match(source, /Stage move: \$\{from\} to \$\{to\}/);
  assert.match(source, /Waiting for Loxo/);
  assert.match(source, /resolvePendingStage/);
  assert.match(source, /DragDropProvider/);
  assert.match(source, /onOpenCandidate\?\.\(job\.id, candidate\.id\)/);
  assert.match(source, /Move \$\{candidate\.name\} to stage/);
  assert.match(source, /<CandidatePresentationBadges/);
  assert.match(source, /<CandidatePresentationSummary/);
  assert.match(source, /prefix="pipeline"/);
  assert.doesNotMatch(source, /purple|violet|indigo|fuchsia|#6b4ea8/i);
  const result = await transformWithEsbuild(source, "PipelinePage.jsx", { loader: "jsx", jsx: "automatic" });
  assert.match(result.code, /function PipelinePage/);
});
