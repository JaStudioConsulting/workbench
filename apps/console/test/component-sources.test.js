import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const manifestPath = path.join(appRoot, "component-sources.json");

test("component provenance manifest resolves local primitives and official URLs", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.shadcn.style, "base-nova");
  assert.match(manifest.shadcn.cliCommand, /^pnpm dlx shadcn@latest add /);
  for (const component of manifest.shadcn.components) {
    assert.ok(fs.existsSync(path.join(appRoot, component.localFile)), component.localFile);
    assert.equal(new URL(component.registryUrl).hostname, "ui.shadcn.com");
    assert.match(component.registryUrl, /\/r\/styles\/base-nova\/[^/]+\.json$/);
    assert.match(manifest.shadcn.cliCommand, new RegExp(`\\b${component.name}\\b`));
  }
  assert.equal(new URL(manifest.shadcn.originInspection.registryUrl).hostname, "coss.com");
  assert.equal(manifest.shadcn.originInspection.decision, "not-installed");
  assert.deepEqual(manifest.dndKit.packages, ["@dnd-kit/react", "@dnd-kit/helpers"]);
  assert.equal(new URL(manifest.dndKit.docsUrl).hostname, "github.com");
});
