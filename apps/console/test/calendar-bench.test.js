import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calendarEnabled } from "../src/featureFlags.js";

test("Calendar is off by default, renders no calendar surfaces, and gates its request", async () => {
  const [home, meetings, settings] = await Promise.all([
    readFile(new URL("../src/features/home/HomePage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/meetings/MeetingsWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/GoogleWorkspacePanel.jsx", import.meta.url), "utf8"),
  ]);
  assert.equal(calendarEnabled, false);
  assert.match(home, /calendarEnabled \? <Card>/);
  assert.match(meetings, /calendarEnabled \? <Card>/);
  assert.match(meetings, /calendarEnabled \? <Badge/);
  assert.match(meetings, /if \(!calendarEnabled\) return undefined/);
  assert.match(meetings, /calendarEnabled \? loadCalendar\(\) : undefined/);
  assert.match(settings, /if \(!calendarEnabled\) return undefined/);
  assert.match(settings, /calendarEnabled && calendarStatus === "connected" \? <UpcomingCalendar/);
});
