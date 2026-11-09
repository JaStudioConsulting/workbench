import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeCaptureManager, parseByteRange, pruneExpiredNativeCaptures } from "../src/native-capture.js";

test("native capture cleanup removes only expired inactive capture directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-retention-test-"));
  const now = Date.parse("2026-11-09T12:00:00Z");
  const oldId = randomUUID();
  const recentId = randomUUID();
  const activeId = randomUUID();
  for (const [id, ageDays] of [[oldId, 8], [recentId, 6], [activeId, 8]]) {
    const directory = join(root, id);
    await mkdir(directory);
    await writeFile(join(directory, "gateway-session.json"), JSON.stringify({ id, createdAt: new Date(now - ageDays * 24 * 60 * 60 * 1_000).toISOString(), state: "captured" }));
    await writeFile(join(directory, "recording.wav"), "synthetic audio");
  }
  await mkdir(join(root, "other-data"));
  try {
    const result = await pruneExpiredNativeCaptures({ captureRoot: root, activeIds: new Set([activeId]), now });
    assert.deepEqual(result, { removed: 1, failed: 0 });
    await assert.rejects(() => stat(join(root, oldId)), { code: "ENOENT" });
    assert.ok((await stat(join(root, recentId))).isDirectory());
    assert.ok((await stat(join(root, activeId))).isDirectory());
    assert.ok((await stat(join(root, "other-data"))).isDirectory());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture audio is owner-bound and supports bounded byte ranges", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-capture-test-"));
  const id = randomUUID();
  const directory = join(root, id);
  await mkdir(join(directory, "recovery"), { recursive: true });
  await writeFile(join(directory, "gateway-session.json"), JSON.stringify({
    id, ownerId: "owner-a", jobId: "job-1", candidateId: "sourcing:1", controlID: "control", state: "captured",
  }));
  await writeFile(join(directory, "recovery/mixed.wav"), Buffer.alloc(100));
  const manager = createNativeCaptureManager({ captureRoot: root, cliPath: "/bin/false" });
  const audio = await manager.audioInfo(id, "mixed", "owner-a");
  assert.equal(audio.size, 100);
  await assert.rejects(() => manager.audioInfo(id, "mixed", "owner-b"), /does not belong/);
  await assert.rejects(() => manager.stop(id, "owner-b"), /does not belong/);
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.throws(() => parseByteRange("bytes=200-300", 100), /Invalid/);
  await rm(root, { recursive: true, force: true });
});
