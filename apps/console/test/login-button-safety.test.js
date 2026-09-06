import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
  ]) assert.match(sharedTypes, new RegExp(scope.replaceAll(".", "\\.")));
  assert.match(source, /result\?\.error/);
  assert.match(source, /authClient\.signOut\(\)/);
  assert.match(source, /role="alert"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|accessToken|refreshToken|gmail|drive|spreadsheets/);
});

test("App mounts LoginButton in the existing header", async () => {
  const source = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /import LoginButton from "\.\/components\/LoginButton\.tsx"/);
  assert.match(source, /<LoginButton\/>/);
});
