import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";

test("JobRail loads real process data and exposes job selection plus recruiting tools", async () => {
  const source = await readFile(new URL("../src/features/workbench/JobRail.jsx", import.meta.url), "utf8");
  assert.match(source, /loadProcessData\(/);
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

test("Jobs tools retain complete labels and candidate empty state follows its displayed count", async () => {
  const source = await readFile(new URL("../src/features/workbench/JobRail.jsx", import.meta.url), "utf8");
  for (const label of ["Map", "Process", "Leads"]) assert.match(source, new RegExp(`<span>${label}<\\/span>`));
  assert.doesNotMatch(source, /<span className="truncate">(?:Map|Process|Leads)<\/span>/);
  assert.match(source, /job\.candidateCount === 0 \? <span[^>]*>No candidates/);
});

test("workspace selection survives view and width changes without a page keyed boundary", async () => {
  const [app, view] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workbench/WorkbenchOneView.jsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(app, /<PageErrorBoundary key=\{`\$\{sessionUserId\}:\$\{page\}`\}/);
  assert.match(app, /selectedJob=\{recruiting\?\.job \|\| null\}/);
  assert.match(view, /const jobsPanel =/);
  assert.match(view, /const todayPanel =/);
  assert.match(view, /const meetingsPanel =/);
  assert.match(view, /mobileTab === "work" \? "min-h-0 min-w-0" : "hidden"/);
  assert.match(view, /\{jobsPanel\}/);
  assert.match(view, /selectedJob=\{selectedJob\} focusCandidateId=\{focusCandidateId\}/);
  assert.match(view, /<PipelinePage selectedJob=\{selectedJob\}/);
});

test("desktop workbench omits narrow tabs and keeps Today and Meetings in separate scroll boxes", async () => {
  const source = await readFile(new URL("../src/features/workbench/WorkbenchOneView.jsx", import.meta.url), "utf8");
  assert.match(source, /!desktop \? <Tabs[\s\S]*?aria-label="Workbench panels"[\s\S]*?<\/Tabs> : null/);
  assert.match(source, /aria-label="Today"[\s\S]*?className="min-h-0 flex-1 overflow-y-auto"/);
  assert.match(source, /aria-label="Meetings and notes"[\s\S]*?className="min-h-0 flex-1 overflow-y-auto"/);
  assert.match(source, /gridTemplateRows: "minmax\(0, 1fr\) minmax\(0, 1fr\)"/);
});

test("Meetings follows the Candidates job unless unsaved meeting content is present", async () => {
  const [view, meetings] = await Promise.all([
    readFile(new URL("../src/features/workbench/WorkbenchOneView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/meetings/MeetingsWorkspace.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(view, /<MeetingsWorkspace launchContext=\{meetingLaunch\} selectedJob=\{selectedJob\}/);
  assert.match(meetings, /workspaceSelectedJob\?\.loxoJobId \|\| workspaceSelectedJob\?\.id/);
  assert.match(meetings, /meetingDraftDirty \|\| transcript\.trim\(\) \|\| notes\.trim\(\) \|\| recording\?\.active \|\| pendingAudio/);
});
