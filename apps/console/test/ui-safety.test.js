import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import test from "node:test";

test("console has no local persistence or send authority", async () => {
  const files = await Promise.all([
    "../src/App.jsx",
    "../src/features/home/HomePage.jsx",
    "../src/features/mail/MailPage.jsx",
    "../src/EmptyWorkspace.jsx",
    "../src/components/GoogleWorkspacePanel.jsx",
    "../src/components/UpcomingCalendar.jsx",
    "../src/google-workspace-client.js",
    "../src/styles.css",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  const source = files.join("\n");
  assert.doesNotMatch(source, /localStorage|sessionStorage|sendEmail|candidateSubmit/i);
  assert.doesNotMatch(source, /Marcus|Meridian|BrightPath|Marketing Director/i);
  assert.match(source, /No Loxo changes are waiting/);
  assert.match(source, /No outreach logged/);
  assert.doesNotMatch(source, /graph-node|graph-lines|selectedNode|CandidateWorkspace/);
  await assert.rejects(access(new URL("../src/components/CandidateWorkspace.jsx", import.meta.url)));
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

test("Settings uses one Better Auth Google connection for Workspace services", async () => {
  const [panel, calendar, settings] = await Promise.all([
    readFile(new URL("../src/components/GoogleWorkspacePanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/UpcomingCalendar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/settings/SettingsPage.jsx", import.meta.url), "utf8"),
  ]);
  const source = `${panel}\n${calendar}\n${settings}`;

  assert.match(panel, /authClient\.useSession\(\)/);
  assert.match(panel, /getGoogleWorkspaceStatus/);
  assert.match(panel, /calendarStatus === "connected" \? <UpcomingCalendar/);
  assert.match(panel, /<LoginButton \/>/);
  assert.match(panel, /Calendar, Gmail, Drive, and Sheets/);
  assert.doesNotMatch(panel, /startGoogleWorkspaceConnection|disconnectGoogleWorkspace|validateGoogleAuthorizationUrl/);
  assert.doesNotMatch(source, /service-grid|dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /Team sync|Candidate interview|Client meeting/i);
});

test("Settings navigation can reach the Google Workspace panel", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/features/settings/SettingsPage.jsx", import.meta.url), "utf8");
  assert.match(app, /case "Settings": return <SettingsPage meetingsStatusLoader=\{getMeetingStatus\} \/>/);
  assert.match(settings, /<GoogleWorkspacePanel/);
});
