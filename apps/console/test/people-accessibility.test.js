import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, "../src/features/candidate-review/PeopleView.jsx"), "utf8");

test("People candidate selection uses a keyboard-native button", () => {
  assert.match(source, /<button type="button" onClick=\{\(\) => onSelectCandidateToSwipe\(candidate\.id\)\}[^>]*data-testid="people-candidate-open"/);
  assert.doesNotMatch(source, /<div key=\{recordKey\} onClick=/);
  assert.match(source, /aria-label=\{`Open \$\{candidate\.name\} profile`\}/);
});

test("People filters have accessible names", () => {
  assert.match(source, /aria-label="Search candidates"/);
  assert.match(source, /aria-label="Filter submissions by location"/);
  assert.match(source, /aria-label="Filter submissions by client"/);
});
