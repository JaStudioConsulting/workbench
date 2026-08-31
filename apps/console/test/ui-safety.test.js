import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import test from "node:test";

test("console has no local persistence or send authority", async () => {
  const files = await Promise.all([
    "../src/App.jsx",
    "../src/components/HomeWidgets.jsx",
    "../src/components/MailInbox.jsx",
    "../src/components/PageStubs.jsx",
    "../src/components/GoogleWorkspacePanel.jsx",
    "../src/components/UpcomingCalendar.jsx",
    "../src/google-workspace-client.js",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  const source = files.join("\n");
  assert.doesNotMatch(source, /localStorage|sessionStorage|sendEmail|candidateSubmit/i);
  assert.doesNotMatch(source, /Marcus|Meridian|BrightPath|Marketing Director/i);
  assert.match(source, /No workbench data/);
  assert.match(source, /No mail connected/);
  assert.match(source, /selectedNode !== null/);
});

test("console entrypoint and all local static references resolve", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const src = html.match(/src="([^"]+)"/)?.[1];
  assert.equal(src, "/src/main.jsx");
  await access(new URL(`..${src}`, import.meta.url));
});

test("Better Auth and Workspace clients use gateway or same-origin without local persistence", async () => {
  const [client, workspace, vite] = await Promise.all([
    readFile(new URL("../src/auth-client.js", import.meta.url), "utf8"),
    readFile(new URL("../src/google-workspace-client.js", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
  ]);
  assert.match(client, /createAuthClient/);
  assert.match(client, /VITE_GATEWAY_URL/);
  assert.match(client, /window\.location\.origin/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
  assert.match(workspace, /credentials: "include"/);
  assert.match(workspace, /GoogleWorkspaceStatusSchema/);
  assert.match(workspace, /GoogleCalendarUpcomingSchema/);
  assert.doesNotMatch(workspace, /accessToken|refreshToken/);
  assert.match(vite, /"\/api"/);
  assert.match(vite, /"\/mcp"/);
});

test("Calendar-first Settings UI is status-gated and contains no fake event data or service grid", async () => {
  const [panel, calendar, stubs] = await Promise.all([
    readFile(new URL("../src/components/GoogleWorkspacePanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/UpcomingCalendar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/PageStubs.jsx", import.meta.url), "utf8"),
  ]);
  const source = `${panel}\n${calendar}\n${stubs}`;

  assert.match(panel, /canConnect = connection\.phase === "disconnected"/);
  assert.match(panel, /connection\.phase === "connected" \? <UpcomingCalendar/);
  assert.match(panel, /Sign-in required/);
  assert.match(panel, /Account not approved/);
  assert.match(panel, /Unavailable/);
  assert.match(calendar, /result\.events\.slice\(0, 10\)/);
  assert.doesNotMatch(source, /service-grid|google-workspace-services|dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /Team sync|Candidate interview|Client meeting/i);
});
