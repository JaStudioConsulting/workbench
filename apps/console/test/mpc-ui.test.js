import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { transformWithEsbuild } from "vite";

test("MPC intake uses the case service, sourced fields, duplicate review, and blind export", async () => {
  const [form, home] = await Promise.all([
    fs.readFile(new URL("../src/features/operator-cases/MpcIntakeForm.jsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/features/home/HomePage.jsx", import.meta.url), "utf8"),
  ]);
  await transformWithEsbuild(form, "MpcIntakeForm.jsx", { loader: "jsx", jsx: "automatic" });
  assert.match(form, /assessMpcEvidence, buildMpcBlindExport, buildMpcReview/);
  assert.match(form, /I reviewed the matching rows/);
  assert.match(form, /Unsent outreach draft/);
  assert.match(form, /does not send outreach/);
  assert.match(form, /initialData\?\.targets/);
  assert.match(form, /!initialData/);
  assert.match(home, /operatorCasesEnabled \? <Card>/);
  assert.match(home, /openMpcCase\(payload\)/);
  assert.match(home, /loadMpcCaseForCandidate/);
  assert.match(home, /casePhase === "ready"/);
  assert.match(home, /no target-search connection/i);
});
