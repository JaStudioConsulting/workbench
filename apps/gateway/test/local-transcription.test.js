import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { createLocalTranscriptionAdapter } from "../src/local-transcription.js";

test("local adapter invokes the CLI contract and removes temporary audio", async () => {
  let received;
  const adapter = createLocalTranscriptionAdapter({
    cliPath: "/Applications/Muesli.app/Contents/MacOS/muesli-cli",
    runner: async (cliPath, inputPath) => {
      received = { cliPath, inputPath };
      await access(inputPath);
      return JSON.stringify({ text: "Verified words only." });
    },
  });

  const result = await adapter.transcribe({ audio: Buffer.from("audio"), contentType: "audio/webm;codecs=opus" });
  assert.deepEqual(result, { transcript: "Verified words only.", source: "muesli_cli" });
  assert.equal(received.cliPath, "/Applications/Muesli.app/Contents/MacOS/muesli-cli");
  await assert.rejects(access(received.inputPath));
});

test("local adapter rejects unsupported or empty audio", async () => {
  const adapter = createLocalTranscriptionAdapter({ runner: async () => "{}" });
  await assert.rejects(adapter.transcribe({ audio: Buffer.from("audio"), contentType: "text/plain" }), /unsupported/i);
  await assert.rejects(adapter.transcribe({ audio: Buffer.alloc(0), contentType: "audio/webm" }), /empty/i);
});

test("local adapter reads the nested transcript returned by the real Muesli CLI", async () => {
  const adapter = createLocalTranscriptionAdapter({
    runner: async () => JSON.stringify({
      data: {
        transcript: "Exact words returned by the M1 CLI.",
      },
    }),
  });
  const result = await adapter.transcribe({ audio: Buffer.from("audio"), contentType: "audio/webm" });
  assert.deepEqual(result, {
    transcript: "Exact words returned by the M1 CLI.",
    source: "muesli_cli",
  });
});
