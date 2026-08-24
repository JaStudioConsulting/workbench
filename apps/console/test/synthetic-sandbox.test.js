import assert from "node:assert/strict";
import test from "node:test";
import { runSyntheticRecruiter, syntheticCase } from "../src/synthetic-case.js";

test("synthetic sandbox grounds every claim and stops at review", () => {
  const result = runSyntheticRecruiter();
  assert.equal(result.authority, "recruiter");
  assert.equal(result.reviewRequired, true);
  assert.equal(result.audit.supportedClaims.length, syntheticCase.facts.length);
  assert.equal(result.brandedResume.status, "draft");
  assert.equal(result.submission.status, "draft");
  assert.equal(result.presentationEmail.status, "draft");
  assert.equal(result.loxoDraft.status, "draft");
  assert.doesNotMatch(JSON.stringify(result), /sendEmail|candidateSubmit|loxoWrite|neo4jWrite/i);
});

test("synthetic sandbox rejects a claim not found in its source", () => {
  const tampered = { ...syntheticCase, facts: [{ ...syntheticCase.facts[0], value: "Invented plant result" }] };
  assert.throws(() => runSyntheticRecruiter(tampered), /value is not present/);
});
