import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Meetings declares the Candidates job prop and preserves linked saved-meeting context", async () => {
  const meetings = await source("../src/features/meetings/MeetingsWorkspace.jsx");
  assert.match(meetings, /selectedJob:\s*workspaceSelectedJob\s*=\s*null/);
  assert.match(meetings, /workspaceSelectedJob\?\.loxoJobId\s*\|\|\s*workspaceSelectedJob\?\.id/);
  assert.match(meetings, /if\s*\(savedLaunchId\s*&&\s*!savedMeetingReady\)\s*return/);
  assert.match(meetings, /loadedMeetingId\s*===\s*savedLaunchId[\s\S]*!selectedJobId\s*&&\s*!selectedCandidateId/);
});

test("Today imports every component and icon used by its reminder and calendar cards", async () => {
  const home = await source("../src/features/home/HomePage.jsx");
  assert.match(home, /import\s*\{[^}]*\bTimerReset\b[^}]*\}\s*from\s*["']lucide-react["']/s);
  assert.match(home, /import\s*\{\s*UpcomingCalendar\s*\}\s*from\s*["']\.\.\/\.\.\/components\/UpcomingCalendar\.jsx["']/);
  assert.match(home, /icon=\{TimerReset\}/);
  assert.match(home, /<UpcomingCalendar\s*\/>/);
});
