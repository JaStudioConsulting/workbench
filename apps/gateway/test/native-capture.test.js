import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeCaptureManager, parseByteRange } from "../src/native-capture.js";

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
