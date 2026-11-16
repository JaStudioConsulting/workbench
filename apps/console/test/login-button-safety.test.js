import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { googleWorkspaceEnabled } from "../src/featureFlags.js";

test("LoginButton reuses the shared Google Workspace scope container", async () => {
  const source = await readFile(new URL("../src/components/LoginButton.tsx", import.meta.url), "utf8");
  const sharedTypes = await readFile(new URL("../../../packages/shared-types/src/index.js", import.meta.url), "utf8");
  assert.match(source, /authClient\.useSession\(\)/);
  assert.match(source, /import \{ GOOGLE_WORKSPACE_CONTAINER_SCOPES \} from "@ja\/shared-types"/);
  assert.match(source, /authClient\.signIn\.social/);
  assert.match(source, /provider: "google"/);
  assert.match(source, /scopes: GOOGLE_WORKSPACE_CONTAINER_SCOPES/);
  for (const scope of [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
  ]) assert.match(sharedTypes, new RegExp(scope.replaceAll(".", "\\.")));
  assert.match(source, /result\?\.error/);
  assert.match(source, /authClient\.signOut\(\)/);
  assert.match(source, /role="alert"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|accessToken|refreshToken|gmail|drive|spreadsheets/);
});

test("silent session is the only App access path and Google sign-in is benched by default", async () => {
  const [source, settings, flags] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/settings/SettingsPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/featureFlags.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /ExistingAccountAccess|signInWithOtp|emailRedirectTo|magic.?link/i);
  assert.doesNotMatch(source, /Sign out|signOutWorkbench|signingOut/);
  assert.match(source, /getWorkbenchSession/);
  assert.match(source, /Try again/);
  assert.match(source, /local session build flag is missing/);
  assert.match(source, /local session owner ID is missing/);
  assert.match(settings, /googleWorkspaceEnabled \? <GoogleWorkspacePanel \/> : null/);
  assert.match(flags, /VITE_GOOGLE_WORKSPACE_ENABLED === "1"/);
  assert.equal(googleWorkspaceEnabled, false);
});
