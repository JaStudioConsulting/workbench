import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname);

test("job selectors keep Base UI SelectItems and Labels inside SelectGroup", () => {
  const source = fs.readFileSync(path.join(root, "src/features/recruiting/RecruitingWorkspace.jsx"), "utf8");
  assert.match(source, /SelectContent><SelectGroup><SelectLabel>Companies<\/SelectLabel><SelectItem/);
  assert.match(source, /SelectContent><SelectGroup><SelectLabel>\{parent\.company\}<\/SelectLabel>\{parent\.jobs\.map/);
});

test("mobile shell and empty table use min-width-safe responsive wrappers", () => {
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const empty = fs.readFileSync(path.join(root, "src/EmptyWorkspace.jsx"), "utf8");
  const picker = fs.readFileSync(path.join(root, "src/ContextPicker.jsx"), "utf8");
  assert.match(app, /SidebarInset className="min-w-0"/);
  assert.match(app, /header className="flex min-h-16 flex-wrap/);
  assert.match(empty, /workbench-table min-w-0 max-w-full/);
  assert.match(picker, /w-full min-w-0 justify-between sm:w-auto sm:min-w-56/);
});
