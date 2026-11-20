import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("App mounts one Workbench view with every former destination reachable", async () => {
  const [app, oneView, home, mail] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/workbench/WorkbenchOneView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/home/HomePage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/mail/MailPage.jsx", import.meta.url), "utf8"),
  ]);
  for (const route of ["home/HomePage", "leads/LeadsPage", "mail/MailPage", "settings/SettingsPage", "profile/ProfilePage"]) {
    assert.match(oneView, new RegExp(route));
  }
  assert.match(app, /features\/workbench\/WorkbenchOneView/);
  assert.doesNotMatch(app, /workAreas|SidebarMenu|NavGroup/);
  assert.match(oneView, /data-testid="workbench-one-view"/);
  assert.match(oneView, />People<\/TabsTrigger>/);
  assert.match(oneView, />Swipe<\/TabsTrigger>/);
  assert.match(oneView, />Pipeline<\/TabsTrigger>/);
  assert.match(home, /loadHomeData/);
  assert.match(mail, /listOutreach/);
  assert.match(app, /clearLiveReviewCache\(\)/);
});
