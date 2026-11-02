import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateRepository } from "./privacy-check.mjs";

test("privacy validator rejects symlinks, credential config, and data assets", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "workbench-privacy-"));
  try {
    await writeFile(path.join(fixture, ".npmrc"), "registry=example");
    await writeFile(path.join(fixture, "fixture.csv"), "name,value\nsynthetic,1\n");
    await writeFile(path.join(fixture, "target.txt"), "synthetic");
    await symlink(path.join(fixture, "target.txt"), path.join(fixture, "linked.txt"));
    await mkdir(path.join(fixture, "nested"));
    const findings = await validateRepository(fixture);
    assert.match(findings.join("\n"), /credential configuration files are forbidden/);
    assert.match(findings.join("\n"), /binary or data assets are forbidden/);
    assert.match(findings.join("\n"), /symlinks are forbidden/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("privacy validator ignores generated Swift build trees", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "workbench-privacy-"));
  try {
    const swiftBuild = path.join(fixture, "native", ".build");
    await mkdir(swiftBuild, { recursive: true });
    await writeFile(path.join(swiftBuild, "machine.bin"), Buffer.from([0, 1, 2, 3]));
    assert.deepEqual(await validateRepository(fixture), []);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});
