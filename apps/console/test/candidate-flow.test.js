import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { invalidateReadCache, readThroughCache } from "../src/lib/readCache.js";
import {
  _resetStoreForTesting,
  _setSupabaseClientForTesting,
  logCandidateActivity,
  recordCandidateDecision,
  recordCandidateSubmission,
  undoCandidateDecision,
  undoQueuedActivity,
} from "../src/features/candidate-review/candidateReviewService.js";
import { rejectCandidate } from "../src/features/candidate-review/rejectReasons.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const featureDir = path.resolve(here, "../src/features/candidate-review");
const read = (...parts) => fs.readFileSync(path.resolve(here, "..", ...parts), "utf8");

// A small in-memory stand-in for the Supabase client. It supports only the calls these tests use.
function createFakeClient(tables) {
  const calls = [];
  let nextId = 900;
  function from(table) {
    const state = { op: "select", filters: [], payload: null, maybe: false, single: false, returning: false };
    const rows = () => tables[table] || (tables[table] = []);
    const matches = (row) => state.filters.every(([column, value]) => String(row[column]) === String(value));
    const run = () => {
      calls.push({ table, op: state.op });
      if (state.op === "insert") {
        const row = { id: nextId++, status: "saved", created_at: "2026-11-21T00:00:00.000Z", ...state.payload };
        rows().unshift(row);
        return { data: state.single ? { ...row } : null, error: null };
      }
      if (state.op === "update") {
        const hit = rows().filter(matches);
        hit.forEach((row) => Object.assign(row, state.payload));
        return { data: state.returning ? hit.map((row) => ({ ...row })) : null, error: null };
      }
      if (state.op === "delete") {
        const hit = rows().filter(matches);
        tables[table] = rows().filter((row) => !hit.includes(row));
        return { data: state.returning ? hit.map((row) => ({ ...row })) : null, error: null };
      }
      const found = rows().filter(matches).map((row) => ({ ...row }));
      if (state.maybe) return { data: found[0] || null, error: null };
      return { data: found, error: null };
    };
    const builder = {
      select() { state.returning = true; return builder; },
      eq(column, value) { state.filters.push([column, value]); return builder; },
      order() { return builder; },
      limit() { return builder; },
      range() { return builder; },
      insert(payload) { state.op = "insert"; state.payload = payload; return builder; },
      update(payload) { state.op = "update"; state.payload = payload; return builder; },
      delete() { state.op = "delete"; return builder; },
      maybeSingle() { state.maybe = true; return builder; },
      single() { state.single = true; return builder; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    return builder;
  }
  return { client: { from }, calls };
}

const JOB = "101";
const PERSON = "sourcing:7";
const OTHER = "sourcing:8";

test.beforeEach(() => {
  _resetStoreForTesting({
    jobs: [{ id: JOB, title: "Robotics Technician", company: "Acme" }],
    candidates: [{ id: PERSON, jobId: JOB, name: "Person Seven", stage: "Applied", activityTrail: [] }],
  });
});

test("Undo deletes only the decision row this session created, and refreshes the read cache", async () => {
  const unrelated = [
    { id: 1, job_id: 101, candidate_source: "sourcing", candidate_source_id: 8, action_type: "decision", decision: "pass", status: "saved" },
    { id: 2, job_id: 101, candidate_source: "sourcing", candidate_source_id: 7, action_type: "activity", activity_type: "Submitted", status: "waiting_for_loxo", idempotency_key: "older" },
  ];
  const tables = { candidate_review_actions: unrelated.map((row) => ({ ...row })) };
  const { client } = createFakeClient(tables);
  _setSupabaseClientForTesting(client);

  const wanted = await recordCandidateDecision(JOB, PERSON, "want");
  assert.equal(wanted.ok, true);
  assert.equal(wanted.undo.kind, "created");
  assert.equal(tables.candidate_review_actions.length, 3);

  let reads = 0;
  const probe = () => readThroughCache("candidate-review:probe", async () => ++reads);
  await probe();
  assert.equal(await probe(), 1, "cached before Undo");

  const undone = await undoCandidateDecision(JOB, PERSON, wanted.undo);
  assert.equal(undone.decision, null);
  assert.deepEqual(tables.candidate_review_actions.map((row) => row.id).sort(), [1, 2], "only the new row is gone");
  assert.equal(await probe(), 2, "the review cache was invalidated by Undo");
  invalidateReadCache("candidate-review:");
});

test("Undo puts back the earlier decision when the write only changed an existing row", async () => {
  const tables = { candidate_review_actions: [{ id: 5, job_id: 101, candidate_source: "sourcing", candidate_source_id: 7, action_type: "decision", decision: "pass", status: "saved" }] };
  _setSupabaseClientForTesting(createFakeClient(tables).client);
  const wanted = await recordCandidateDecision(JOB, PERSON, "want");
  assert.equal(wanted.undo.kind, "updated");
  assert.equal(tables.candidate_review_actions[0].decision, "want");
  await undoCandidateDecision(JOB, PERSON, wanted.undo);
  assert.equal(tables.candidate_review_actions.length, 1, "the row it did not create stays");
  assert.equal(tables.candidate_review_actions[0].decision, "pass");
});

test("Undo refuses when the decision row has changed since it was saved", async () => {
  const tables = { candidate_review_actions: [] };
  _setSupabaseClientForTesting(createFakeClient(tables).client);
  const wanted = await recordCandidateDecision(JOB, PERSON, "want");
  tables.candidate_review_actions[0].decision = "pass";
  await assert.rejects(undoCandidateDecision(JOB, PERSON, wanted.undo), /changed since it was saved/);
  assert.equal(tables.candidate_review_actions.length, 1);
});

test("Undo of a queued activity removes only that waiting row, never one Loxo has already taken", async () => {
  const tables = { candidate_review_actions: [] };
  _setSupabaseClientForTesting(createFakeClient(tables).client);
  const first = await logCandidateActivity(JOB, PERSON, { type: "*Note", note: "first", idempotencyKey: "key-one" });
  await logCandidateActivity(JOB, PERSON, { type: "*Note", note: "second", idempotencyKey: "key-two" });
  assert.equal(tables.candidate_review_actions.length, 2);

  await undoQueuedActivity(JOB, PERSON, first.activity.idempotencyKey);
  assert.deepEqual(tables.candidate_review_actions.map((row) => row.idempotency_key), ["key-two"]);

  tables.candidate_review_actions[0].status = "user_reported";
  await assert.rejects(undoQueuedActivity(JOB, PERSON, "key-two"), /already recorded in Loxo/);
  assert.equal(tables.candidate_review_actions.length, 1, "a row that is no longer pending stays");
});

test("Undo of a pass takes back the queued note and the decision, and nothing else", async () => {
  const tables = { candidate_review_actions: [{ id: 3, job_id: 101, candidate_source: "sourcing", candidate_source_id: 8, action_type: "decision", decision: "want", status: "saved" }] };
  _setSupabaseClientForTesting(createFakeClient(tables).client);
  const result = await rejectCandidate({
    jobId: JOB,
    personId: PERSON,
    reason: "Not interested",
    recordDecision: recordCandidateDecision,
    logActivity: logCandidateActivity,
  });
  assert.equal(result.ok, true);
  assert.equal(tables.candidate_review_actions.length, 3);
  assert.ok(result.undo.idempotencyKey);
  assert.equal(result.undo.decision.kind, "created");

  await undoQueuedActivity(JOB, PERSON, result.undo.idempotencyKey);
  await undoCandidateDecision(JOB, PERSON, result.undo.decision);
  assert.deepEqual(tables.candidate_review_actions.map((row) => row.id), [3]);
  assert.equal(tables.candidate_review_actions[0].candidate_source_id, 8, "the other person's row is untouched");
});

test("Undo of Mark submitted removes the waiting Submitted row by its own key", async () => {
  const tables = { candidate_review_actions: [], candidate_review_feed: [], presentations: [] };
  _setSupabaseClientForTesting(createFakeClient(tables).client);
  const marked = await recordCandidateSubmission(JOB, PERSON, { submittedAt: "2026-11-21T10:00:00.000Z" });
  assert.equal(marked.ok, true);
  assert.ok(marked.idempotencyKey);
  assert.equal(tables.candidate_review_actions.length, 1);
  assert.equal(tables.candidate_review_actions[0].status, "waiting_for_loxo");

  tables.candidate_review_actions.push({ id: 77, job_id: 101, candidate_source: "sourcing", candidate_source_id: 8, action_type: "activity", activity_type: "Submitted", status: "waiting_for_loxo", idempotency_key: "someone-else" });
  await undoQueuedActivity(JOB, PERSON, marked.idempotencyKey);
  assert.deepEqual(tables.candidate_review_actions.map((row) => row.id), [77]);
  void OTHER;
});

test("the card shows only Pass and Want before a decision, and the next steps once wanted", () => {
  const card = read("src/features/candidate-review/CandidateCard.jsx");
  const bar = card.slice(card.indexOf('data-testid="decision-bar"'), card.indexOf("Dialog showing WHY"));
  const split = bar.indexOf("<RejectMenu");
  const nextSteps = bar.slice(0, split);
  const beforeDecision = bar.slice(split);
  for (const label of ["call-button", "write-up-button", "outreach-button", "BrandedResumeControl", "mark-submitted-button"]) assert.match(nextSteps, new RegExp(label));
  assert.match(card, /const showNextSteps = isWanted \|\| isWaitingForLoxo \|\| Boolean\(candidate\.isSubmitted\)/);
  assert.match(beforeDecision, /<RejectMenu/);
  assert.match(beforeDecision, /data-testid="want-button"/);
  for (const label of ["call-button", "write-up-button", "outreach-button", "mark-submitted-button"]) assert.doesNotMatch(beforeDecision, new RegExp(label));
  // People rows show the same steps for any wanted person, in any tab.
  const people = read("src/features/candidate-review/PeopleView.jsx");
  assert.match(people, /\{isWanted \? \(\s*<div[^]*?data-testid="wanted-actions"/);
  assert.doesNotMatch(people, /viewFilter === "wanted" \? \(\s*<div/);
});

test("Want, Pass and Mark submitted each report what was saved and offer Undo", () => {
  const review = read("src/features/candidate-review/CandidateReview.jsx");
  assert.match(review, /wanted\. Saved here\./);
  assert.match(review, /passed: \$\{reason\}\. Waiting for Loxo\./);
  assert.match(review, /marked submitted\. Waiting for Loxo\./);
  assert.match(review, /data-testid="undo-action"/);
  assert.match(review, /undoCandidateDecision\(currentJob\.id, candidateId, result\.undo\)/);
  assert.match(review, /undoQueuedActivity\(currentJob\.id, candidateId, result\.idempotencyKey\)/);
  assert.match(review, /showSaved\(`\$\{nameOf\(candidateId\)\} wanted/);
});

test("the Work area and candidate card have no viewport-height caps and keep the decision bar in view", () => {
  for (const file of ["CandidateCard.jsx", "CandidateReview.jsx", "SwipeView.jsx", "PeopleView.jsx"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(featureDir, file), "utf8"), /calc\(100vh/, file);
  }
  assert.doesNotMatch(read("src/features/workbench/WorkbenchOneView.jsx"), /calc\(100vh/);
  const review = read("src/features/candidate-review/CandidateReview.jsx");
  assert.match(review, /className="flex h-full min-h-0 w-full flex-col gap-3"/);
  const card = read("src/features/candidate-review/CandidateCard.jsx");
  assert.doesNotMatch(card, /fontFamily|Arial/);
  assert.match(card, /data-testid="card-scroll-body"/);
  assert.match(card, /className="flex min-h-0 flex-1 flex-col xl:overflow-y-auto"/);
  assert.match(card, /min-h-48/);
  // One flex-wrap row: Pass, Branded resume and Want, with Want taking the remaining width.
  assert.match(card, /data-testid="decision-bar"/);
  assert.match(card, /className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center gap-2[^"]*" data-testid="decision-bar"/);
  assert.doesNotMatch(card, /<BrandedResumeControl[^>]*className="w-full"/);
  assert.match(card, /className="h-10 min-w-32 flex-1[^"]*sm:min-w-40[^"]*"\s+data-testid="want-button"/);
  assert.doesNotMatch(card, /card-add-candidate-button|setEditorMode\("create"\)/);
});

test("a person outside the job's list never switches Swipe to someone else", () => {
  const review = read("src/features/candidate-review/CandidateReview.jsx");
  const open = review.slice(review.indexOf("const handleOpenCandidate"), review.indexOf("return (\n    <div className=\"flex h-full"));
  assert.match(open, /if \(!shownCandidates\.some\(\(item\) => item\.id === candidateId\)\) return false;/);
  assert.ok(open.indexOf("return false") < open.indexOf('setActiveView("swipe")'), "the not-found exit comes before any view switch");
  const people = read("src/features/candidate-review/PeopleView.jsx");
  assert.match(people, /if \(onSelectCandidateToSwipe\?\.\(candidate\.id\)\) return;\s+editorTriggerRef\.current = event\.currentTarget;/);
  assert.match(people, /is not in this job's candidate list, so their record opened to edit\./);
});

test("with a job selected People lists that job's candidates, and All people opens the directory", async () => {
  const vite = await createServer({ root: path.resolve(here, ".."), server: { middlewareMode: true }, appType: "custom" });
  try {
    const { default: PeopleView } = await vite.ssrLoadModule("/src/features/candidate-review/PeopleView.jsx");
    const person = (id, name) => ({ id, name, title: "Technician", employer: "Acme", location: "Toronto, ON", initials: "XX", stage: "Applied", resumeStatus: "resume_on_file", activityTrail: [] });
    const candidates = [person("sourcing:1", "Alex One"), person("sourcing:2", "Bea Two")];
    const scoped = renderToStaticMarkup(React.createElement(PeopleView, { candidates, currentJob: { id: "101", title: "Robotics Technician" } }));
    assert.match(scoped, /2 in this job/);
    assert.match(scoped, /data-testid="people-all-chip"[^>]*>/);
    assert.match(scoped, /aria-pressed="false"[^>]*data-testid="people-all-chip"/);
    const directory = renderToStaticMarkup(React.createElement(PeopleView, { candidates, currentJob: null }));
    assert.match(directory, /2 in all people/);
    assert.doesNotMatch(directory, /people-all-chip/);
    // Every row has one Review button and named Notes and Board buttons.
    assert.equal((scoped.match(/data-testid="people-candidate-open"/g) || []).length, 2);
    assert.match(scoped, /aria-label="Notes for Alex One"/);
    assert.match(scoped, /aria-label="Board for Bea Two"/);
  } finally {
    await vite.close();
  }
});

test("loading and empty states say what is true: loading, none for this job, or 0 in Canada with Show all", async () => {
  const vite = await createServer({ root: path.resolve(here, ".."), server: { middlewareMode: true }, appType: "custom" });
  try {
    const { default: SwipeView } = await vite.ssrLoadModule("/src/features/candidate-review/SwipeView.jsx");
    const render = (emptyState) => renderToStaticMarkup(React.createElement(SwipeView, { candidates: [], currentJob: { id: "101" }, jobs: [], currentIndex: 0, emptyState }));
    assert.match(render({ kind: "loading", title: "Loading Robotics Technician candidates…" }), /Loading Robotics Technician candidates…/);
    assert.match(render({ kind: "none", title: "No candidates for this job yet." }), /No candidates for this job yet\./);
    const canada = render({ kind: "canada", title: "0 in Canada.", action: React.createElement("button", { type: "button" }, "Show all 12") });
    assert.match(canada, /0 in Canada\./);
    assert.match(canada, /<button type="button">Show all 12<\/button>/);
    assert.match(render(null), /Unreviewed queue is clear/);

    const review = read("src/features/candidate-review/CandidateReview.jsx");
    assert.match(review, /title: jobTitle \? `Loading \$\{jobTitle\} candidates…` : "Loading candidates…"/);
    assert.match(review, /Show all \{candidates\.length\}/);
    assert.match(review, /onClick=\{\(\) => updateCanadaPrefs\(\{ canadaOnly: false \}\)\}/);
    assert.match(review, /const candidatesLoading = Boolean\(activeJobId\) && loadedJobId !== String\(activeJobId\)/);
    // A selected job that is still loading never reads "No matching job selected".
    assert.match(review, /\{loading \? \(\s*<h3[^>]*>\{jobTitle \? `Loading/);
  } finally {
    await vite.close();
  }
});

test("People and Swipe share one CandidateReview that keeps its loaded data, and Pipeline remount reads the cache", () => {
  const view = read("src/features/workbench/WorkbenchOneView.jsx");
  assert.doesNotMatch(view, /<CandidateReview key=/);
  assert.equal((view.match(/<CandidateReview /g) || []).length, 1);
  assert.match(view, /<CandidateReview view=\{workView\} onViewChange=\{chooseWorkView\}/);
  const review = read("src/features/candidate-review/CandidateReview.jsx");
  assert.match(review, /getCachedLiveReviewJobs\(\)/);
  assert.match(review, /getCachedLiveCandidatesForJob\(activeJobId\)/);
});

test("Log activity labels are bound to their controls and make no claim about Loxo", async () => {
  const vite = await createServer({ root: path.resolve(here, ".."), server: { middlewareMode: true }, appType: "custom" });
  try {
    const { default: LogActivityForm } = await vite.ssrLoadModule("/src/features/candidate-review/LogActivityForm.jsx");
    const html = renderToStaticMarkup(React.createElement(LogActivityForm, { candidateId: "sourcing:1", onLogActivity: async () => ({ ok: true }) }));
    assert.match(html, />Log activity<\/h4>/);
    assert.match(html, />Saved here\. Waiting for Loxo\.<\/p>/);
    assert.match(html, />Log activity<\/button>/);
    const labels = [...html.matchAll(/<label for="([^"]+)"[^>]*>([^<]+)<\/label>/g)];
    assert.deepEqual(labels.map((match) => match[2].trim()), ["Activity type", "Note"]);
    for (const [, id] of labels) assert.match(html, new RegExp(`id="${id.replace(/[$]/g, "\\$")}"`));
    assert.doesNotMatch(html, /in Loxo|local outbox|Exact Loxo Names/);
  } finally {
    await vite.close();
  }
});

test("Today keeps its lists while refreshing and shows the loader only before the first load", () => {
  const home = read("src/features/home/HomePage.jsx");
  assert.doesNotMatch(home, /setState\(\(current\) => \(\{ \.\.\.current, phase: "loading" \}\)\)/);
  const reload = home.slice(home.indexOf("useEffect(() => {\n    let active = true;"), home.indexOf("}, [requestId, recentMeetingsLoader]);"));
  assert.ok(reload.length > 100);
  assert.doesNotMatch(reload, /phase: "loading"/, "a reload never swaps the lists for the loader");
  assert.match(home, /if \(state\.phase === "loading"\) return <section/);
});

test("the header sits on a white surface so the search border reaches 3:1", () => {
  const luminance = (hex) => {
    const channel = (offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const styles = read("src/styles.css");
  const input = styles.match(/--color-input:\s*(#[0-9a-f]{6})/i)[1];
  const popover = styles.match(/--color-popover:\s*(#[0-9a-f]{6})/i)[1];
  assert.equal(popover.toLowerCase(), "#ffffff");
  assert.ok(ratio(input, "#ffffff") >= 3, `input border on white is ${ratio(input, "#ffffff").toFixed(2)}`);
  assert.match(read("src/App.jsx"), /<header data-print-hide className="z-40 flex min-h-16 flex-wrap[^"]*bg-white/);
  assert.match(read("src/components/ui/command.tsx"), /border-input bg-popover shadow-none!/);
});
