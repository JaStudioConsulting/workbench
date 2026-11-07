import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("legacy page exports point to finished Workbench pages", async () => {
  const [stubs, home, mail] = await Promise.all([
    readFile(new URL("../src/components/PageStubs.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/HomeWidgets.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/MailInbox.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(stubs, /features\/home\/HomePage/);
  assert.match(stubs, /features\/leads\/LeadsPage/);
  assert.match(stubs, /features\/mail\/MailPage/);
  assert.match(stubs, /features\/recruiting\/ProcessPage/);
  assert.match(stubs, /features\/settings\/SettingsPage/);
  assert.match(stubs, /features\/profile\/ProfilePage/);
  assert.match(home, /<HomePage/);
  assert.match(mail, /<MailPage/);
});

test("current empty-workspace wiring renders implemented Home and Leads pages", async () => {
  const source = await readFile(new URL("../src/EmptyWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /Home: HomePage/);
  assert.match(source, /Leads: LeadsPage/);
  assert.match(source, /workbench-table min-w-0 max-w-full/);
});
