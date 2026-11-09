import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("App routes to active Workbench pages", async () => {
  const [app, home, mail] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/home/HomePage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/mail/MailPage.jsx", import.meta.url), "utf8"),
  ]);
  for (const route of ["home/HomePage", "leads/LeadsPage", "mail/MailPage", "settings/SettingsPage", "profile/ProfilePage"]) {
    assert.match(app, new RegExp(route));
  }
  assert.match(home, /loadHomeData/);
  assert.match(mail, /listOutreach/);
});

test("current empty-workspace wiring renders implemented Home and Leads pages", async () => {
  const source = await readFile(new URL("../src/EmptyWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /Home: HomePage/);
  assert.match(source, /Leads: LeadsPage/);
  assert.match(source, /workbench-table min-w-0 max-w-full/);
});
