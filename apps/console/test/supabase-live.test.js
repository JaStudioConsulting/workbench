import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Supabase auth gates the console without exposing privileged credentials", () => {
  const main = read("src/main.jsx");
  const client = read("src/supabase-client.js");
  const gate = read("src/components/SupabaseSessionGate.jsx");

  assert.match(main, /SupabaseSessionGate/);
  assert.match(gate, /signInWithOtp/);
  assert.match(gate, /window\.location\.origin/);
  assert.doesNotMatch(client, /service[_-]?role/i);
  assert.doesNotMatch(client, /secret[_-]?key/i);
});

test("Jobs and candidates use authenticated live data instead of browser fixtures", () => {
  const jobsMap = read("src/features/jobs-map/JobsMapView.jsx");
  const review = read("src/features/candidate-review/CandidateReview.jsx");
  const service = read("src/features/candidate-review/candidateReviewService.js");
  const app = read("src/App.jsx");

  assert.match(jobsMap, /from\("tracker_jobs"\)/);
  assert.doesNotMatch(jobsMap, /INITIAL_JOBS_DATA/);
  assert.match(review, /loadLiveReviewJobs/);
  assert.match(review, /loadLiveCandidatesForJob/);
  assert.match(review, /dataError\s*\?\s*"Supabase unavailable"/);
  assert.match(review, /"Connected to Supabase"/);
  assert.doesNotMatch(review, /dataLoading\s*\?\s*"Loading Supabase"\s*:\s*"Saved to Supabase"/);
  assert.match(service, /from\("candidate_review_feed"\)/);
  assert.match(app, /initialView=\{page === "Candidates" \? "people" : "swipe"\}/);
});

test("review actions and candidate artifacts persist in Supabase", () => {
  const service = read("src/features/candidate-review/candidateReviewService.js");
  const writeUp = read("src/features/candidate-review/CandidateWriteUpDialog.jsx");
  const card = read("src/features/candidate-review/CandidateCard.jsx");

  assert.match(service, /from\("candidate_review_actions"\)/);
  assert.match(service, /from\("review_drafts"\)/);
  assert.match(writeUp, /createCandidateDraft/);
  assert.match(card, /createCandidateDraft/);
});
