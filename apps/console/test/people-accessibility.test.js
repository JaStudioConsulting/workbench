import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, "../src/features/candidate-review/PeopleView.jsx"), "utf8");

test("People rows have one named Review button and named Notes and Board buttons", () => {
  assert.match(source, /<Button type="button" size="sm"[^]*?aria-label=\{`Review \$\{candidate\.name\}`\}[^]*?data-testid="people-candidate-open"/);
  assert.match(source, /aria-label=\{`Notes for \$\{candidate\.name\}`\}/);
  assert.match(source, /aria-label=\{`Board for \$\{candidate\.name\}`\}/);
  assert.doesNotMatch(source, /<div key=\{recordKey\} onClick=/);
});

test("People filters have accessible names", () => {
  assert.match(source, /aria-label="Search candidates"/);
  assert.match(source, /aria-label="Filter submissions by location"/);
  assert.match(source, /aria-label="Filter submissions by client"/);
});
