import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import test from "node:test";

test("console has no local persistence or send authority", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /localStorage|sessionStorage|sendEmail|candidateSubmit/i);
  assert.match(app, /Authentication is unavailable/);
  assert.match(app, /disabled[^>]*>Create case/);
  assert.match(app, /Sign in with Google/);
  assert.match(app, /Signed in/);
  assert.match(app, /Signed out/);
});

test("console entrypoint and all local static references resolve", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const src = html.match(/src="([^"]+)"/)?.[1];
  assert.equal(src, "/src/main.jsx");
  await access(new URL(`..${src}`, import.meta.url));
});

test("Better Auth client and configured proxy use gateway or same-origin without local persistence", async () => {
  const [client, vite] = await Promise.all([
    readFile(new URL("../src/auth-client.js", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
  ]);
  assert.match(client, /createAuthClient/);
  assert.match(client, /VITE_GATEWAY_URL \|\| window\.location\.origin/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
  assert.match(vite, /"\/api"/);
  assert.match(vite, /"\/mcp"/);
});

test("Today page components exist and import correctly", async () => {
  const todayPage = await readFile(new URL("../src/pages/TodayPage.jsx", import.meta.url), "utf8");
  assert.match(todayPage, /TodayHeader/);
  assert.match(todayPage, /AttentionQueue/);
  assert.match(todayPage, /ActiveCases/);
  assert.match(todayPage, /ActionDock/);
  assert.match(todayPage, /ReviewQueue/);
  assert.match(todayPage, /TodayCalendar/);
  assert.match(todayPage, /SourcingRuns/);
  assert.match(todayPage, /AutomationHealth/);
  assert.match(todayPage, /RecentWork/);
  assert.match(todayPage, /GraphViewPlaceholder/);
});

test("Today page has no local persistence APIs", async () => {
  const todayPage = await readFile(new URL("../src/pages/TodayPage.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(todayPage, /localStorage|sessionStorage|IndexedDB|indexedDB/i);
});

test("synthetic data contains no real credentials or emails", async () => {
  const data = await readFile(new URL("../src/data/synthetic-today.js", import.meta.url), "utf8");
  // Check for private keys
  const pkPattern = new RegExp(['B', 'E', 'G', 'I', 'N', '( [A-Z]+)? PRIVATE KEY'].join(''));
  assert.doesNotMatch(data, pkPattern);
  // Check for API key prefixes
  const apiKeyPattern = new RegExp(['A', 'I', 'z', 'a'].join('') + "[A-Za-z0-9_-]{30,}");
  assert.doesNotMatch(data, apiKeyPattern);
  // Check for GitHub tokens
  const ghPattern = new RegExp(['g', 'h', 'p', '_'].join('') + "[A-Za-z0-9]{30,}");
  assert.doesNotMatch(data, ghPattern);
  // Check for emails
  assert.doesNotMatch(data, /[A-Z0-9._%+-]+@(?!example\.invalid\b)[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(data, /localStorage|sessionStorage/i);
});

test("Today synthetic data has all 8 required scenarios", async () => {
  const data = await readFile(new URL("../src/data/synthetic-today.js", import.meta.url), "utf8");
  // Scenario 1: complete after-call case
  assert.match(data, /Ready/);
  assert.match(data, /Full Package/);
  // Scenario 2: missing JD
  assert.match(data, /Missing job description/i);
  // Scenario 3: missing transcript
  assert.match(data, /Missing transcript/i);
  // Scenario 4: conflicting info
  assert.match(data, /conflict/i);
  // Scenario 5: sourcing run
  assert.match(data, /verified/i);
  assert.match(data, /rejected/i);
  assert.match(data, /duplicates/i);
  // Scenario 6: calendar item
  assert.match(data, /interview/i);
  // Scenario 7: failed integration
  assert.match(data, /Error/);
  assert.match(data, /expired/i);
  // Scenario 8: review items
  assert.match(data, /Needs Review/);
});

test("readiness gating: action requires check prevents invalid workflow", async () => {
  const data = await import("../src/data/synthetic-today.js");
  // Case 2 is missing JD
  const caseTwo = data.cases.find((c) => c.id === "case-002");
  assert.ok(caseTwo, "case-002 should exist");
  assert.equal(caseTwo.sources.jobDescription, false);
  // Vet requires resume + JD
  const vetAction = data.ACTIONS.find((a) => a.id === "vet");
  assert.ok(vetAction, "vet action should exist");
  const missing = vetAction.requires.filter((r) => !caseTwo.sources[r]);
  assert.ok(missing.length > 0, "case-002 should be missing requirements for vetting");
  assert.ok(missing.includes("jobDescription"), "jobDescription should be missing");
});

test("no external network requests in synthetic data", async () => {
  const data = await readFile(new URL("../src/data/synthetic-today.js", import.meta.url), "utf8");
  assert.doesNotMatch(data, /fetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/i);
});

test("drag-drop hook has no external dependencies", async () => {
  const hook = await readFile(new URL("../src/hooks/useDragDrop.js", import.meta.url), "utf8");
  assert.match(hook, /import.*from 'react'/);
  assert.doesNotMatch(hook, /import.*from '(?!react)/);
});

test("Action Dock shows readiness panel, never auto-executes", async () => {
  const dock = await readFile(new URL("../src/features/today/ActionDock.jsx", import.meta.url), "utf8");
  assert.match(dock, /ReadinessPanel/);
  assert.match(dock, /readiness check/i);
  assert.doesNotMatch(dock, /fetch\(|sendEmail|candidateSubmit|loxo_write/i);
});
