import test from "node:test";
import assert from "node:assert/strict";
import { mapTrackerHeaders, parseCsvText, previewTrackerRows } from "../src/tracker-import-domain.js";

test("CSV parsing preserves quoted delimiters and rejects malformed or oversized input", () => {
  assert.deepEqual(parseCsvText('Candidate Name,Notes\r\nAda Lovelace,"text, with comma"\r\n').rows, [["Ada Lovelace", "text, with comma"]]);
  assert.throws(() => parseCsvText('name\n"unfinished'), /unclosed quoted field/);
  assert.throws(() => parseCsvText("a\n1\n2", { maxRows: 1 }), /row limit/);
});

test("same-name candidates remain separate and repeated source IDs are flagged", () => {
  const preview = previewTrackerRows({
    type: "candidates", headers: ["Candidate Name", "Email"], rows: [["Alex Lee", "alex1@example.invalid"], ["Alex Lee", "alex2@example.invalid"]],
    sourceKey: "sheet:abc:Candidates", explicitIdentityField: "email",
  });
  assert.equal(preview.rows[0].sourceRowKey, "sheet:abc:Candidates:email:alex1@example.invalid");
  assert.notEqual(preview.rows[0].sourceRowKey, preview.rows[1].sourceRowKey);
  const duplicates = previewTrackerRows({ type: "candidates", headers: ["Candidate Name", "Email"], rows: [["Alex Lee", "x"], ["Jordan Kim", "x"]], sourceKey: "upload:uuid", explicitIdentityField: "email" });
  assert.equal(duplicates.blockedCount, 2);
});

test("job and fit previews require explicit canonical IDs and reject malformed rows", () => {
  const jobs = previewTrackerRows({ type: "jobs", headers: ["Job Title", "Job ID"], rows: [["Controller", ""], ["Accountant", "abc"]], sourceKey: "sheet:x:Jobs" });
  assert.ok(jobs.rows.every((row) => row.blocked));
  const fits = previewTrackerRows({ type: "fits", headers: ["Person ID", "Fit Label", "Tracker Sheet"], rows: [["nope", "Strong", "Fits"]], sourceKey: "upload:fits" });
  assert.match(fits.rows[0].problems.join(" "), /numeric Loxo ID/);
});

test("ambiguous headers do not silently map a required value", () => {
  const mapping = mapTrackerHeaders(["Name", "Candidate Name"], "candidates");
  assert.equal(mapping.candidate_name, undefined);
  const preview = previewTrackerRows({ type: "candidates", headers: ["Name", "Candidate Name"], rows: [["A", "B"]], sourceKey: "sheet:x" });
  assert.equal(preview.rows[0].blocked, true);
});

test("row-position identity needs reconciliation and job IDs are unique within a preview", () => {
  const candidates = previewTrackerRows({ type: "candidates", headers: ["Candidate Name"], rows: [["Taylor Reed"]], sourceKey: "upload:stable-id" });
  assert.equal(candidates.rows[0].blocked, true);
  assert.throws(() => previewTrackerRows({ type: "candidates", headers: ["Candidate Name"], rows: [["Taylor Reed"]], sourceKey: "upload:stable-id", explicitIdentityField: "email" }), /identity field is not mapped/);
  const jobs = previewTrackerRows({ type: "jobs", headers: ["Job ID", "Job Title"], rows: [["71", "Controller"], ["71", "Accountant"]], sourceKey: "sheet:jobs" });
  assert.ok(jobs.rows.every((row) => row.problems.includes("Duplicate job_id in import")));
});
