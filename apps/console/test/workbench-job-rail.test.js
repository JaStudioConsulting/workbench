import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";

test("JobRail loads real process data and exposes job selection plus recruiting tools", async () => {
  const source = await readFile(new URL("../src/features/workbench/JobRail.jsx", import.meta.url), "utf8");
  assert.match(source, /loadJobRailData\(\)/);
  assert.doesNotMatch(source, /loadProcessData\(\)/);
  assert.match(source, /onSelectJob\?\.\(\{ id: job\.id, loxoJobId: job\.id, title: job\.title, company: job\.company \}\)/);
  assert.match(source, /Object\.entries\(job\.stageCounts \|\| \{\}\)\.filter/);
  assert.match(source, /Number\(count\) > 0/);
  assert.match(source, /onClick=\{onOpenMap\}/);
  assert.match(source, /onClick=\{onOpenProcess\}/);
  assert.match(source, /onClick=\{onOpenLeads\}/);
  assert.match(source, /Loading active jobs…/);
  assert.match(source, /No active Tracker jobs\./);
  assert.match(source, /role="alert"/);
  const compiled = await transformWithEsbuild(source, "JobRail.jsx", { loader: "jsx", jsx: "automatic" });
  assert.match(compiled.code, /function JobRail/);
});
