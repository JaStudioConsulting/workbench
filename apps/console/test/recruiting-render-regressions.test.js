import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname);

test("job selectors keep Base UI SelectItems and Labels inside SelectGroup", () => {
  const source = fs.readFileSync(path.join(root, "src/features/jobs-map/JobsMapView.jsx"), "utf8");
  assert.match(source, /<SelectContent>\s*<SelectGroup>\s*<SelectItem value="ALL">All Owners/);
  assert.match(source, /<SelectContent>\s*<SelectGroup>\s*<SelectItem value="ALL">Any Distance/);
});

test("mobile shell and empty table use min-width-safe responsive wrappers", () => {
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const oneView = fs.readFileSync(path.join(root, "src/features/workbench/WorkbenchOneView.jsx"), "utf8");
  const empty = fs.readFileSync(path.join(root, "src/EmptyWorkspace.jsx"), "utf8");
  const picker = fs.readFileSync(path.join(root, "src/ContextPicker.jsx"), "utf8");
  assert.match(app, /min-w-0 overflow-x-clip/);
  assert.match(app, /header data-print-hide className="sticky top-0[^\n]+flex min-h-16 flex-wrap/);
  assert.match(oneView, /gridTemplateColumns: "minmax\(200px, 240px\) minmax\(0, 1fr\) minmax\(240px, 320px\)"/);
  assert.match(oneView, /aria-label="Workbench panels"/);
  assert.match(oneView, /value="today" disabled=\{recordingLocked\}>Today<\/TabsTrigger>/);
  assert.match(oneView, /value="work" disabled=\{recordingLocked\}>Work<\/TabsTrigger>/);
  assert.match(oneView, /if \(recordingLocked\) \{\s*setMobileTab\("meetings"\)/);
  assert.match(oneView, /destination === "Notes"\) setMobileTab\("work"\)/);
  assert.match(oneView, /<MailPage \/>/);
  assert.match(oneView, /const navigateFromToday = \(next, item\) => onHomeNavigate\(next, item\)/);
  assert.match(empty, /workbench-table min-w-0 max-w-full/);
  assert.match(picker, /w-full min-w-0 justify-between sm:w-auto sm:min-w-56/);
});

test("shared print uses the current page and removes app navigation with scroll clipping", () => {
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
  assert.match(app, /Print current Workbench view/);
  assert.match(app, /window\.print\(\)/);
  assert.match(app, /Current view: Workbench/);
  assert.match(styles, /@media print/);
  assert.match(styles, /\[data-print-hide\]/);
  assert.match(styles, /\.workbench-main \*,/);
  assert.match(styles, /overflow: visible !important/);
});
