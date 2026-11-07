import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createLocalTranscriptionAdapter } from "../src/local-transcription.js";

test("local adapter invokes the CLI contract and removes temporary audio", async () => {
  let received;
  const adapter = createLocalTranscriptionAdapter({
    cliPath: "/opt/workbench/bin/workbench-transcribe",
    supportDir: "/opt/workbench/support",
    runner: async (cliPath, inputPath, supportDir) => {
      received = { cliPath, inputPath, supportDir };
      await access(inputPath);
      return JSON.stringify({ text: "Verified words only." });
    },
  });

  const result = await adapter.transcribe({ audio: Buffer.from("audio"), contentType: "audio/mp4;codecs=mp4a.40.2" });
  assert.deepEqual(result, { transcript: "Verified words only.", source: "workbench_native" });
  assert.equal(received.cliPath, "/opt/workbench/bin/workbench-transcribe");
  assert.equal(received.supportDir, "/opt/workbench/support");
  await assert.rejects(access(received.inputPath));
});

test("local adapter defaults to the Workbench-owned runtime paths", async () => {
  let received;
  const adapter = createLocalTranscriptionAdapter({
    runner: async (cliPath, inputPath, supportDir) => {
      received = { cliPath, inputPath, supportDir };
      return JSON.stringify({ text: "Internal runtime." });
    },
  });

  await adapter.transcribe({ audio: Buffer.from("audio"), contentType: "audio/wav" });
  assert.equal(received.cliPath, resolve(process.cwd(), "../../native/bin/workbench-transcribe"));
  assert.equal(received.supportDir, resolve(process.cwd(), "../../native/support"));
});

test("local adapter rejects unsupported or empty audio", async () => {
  const adapter = createLocalTranscriptionAdapter({ runner: async () => "{}" });
  await assert.rejects(adapter.transcribe({ audio: Buffer.from("audio"), contentType: "text/plain" }), /unsupported/i);
  await assert.rejects(adapter.transcribe({ audio: Buffer.alloc(0), contentType: "audio/wav" }), /empty/i);
  await assert.rejects(adapter.transcribe({ audio: Buffer.from("audio"), contentType: "audio/webm" }), /unsupported/i);
});

test("local adapter reads a nested transcript returned by the native Workbench runtime", async () => {
  const adapter = createLocalTranscriptionAdapter({
    runner: async () => JSON.stringify({
      data: {
        transcript: "Exact words returned by the M1 CLI.",
      },
    }),
  });
  const result = await adapter.transcribe({ audio: Buffer.from("audio"), contentType: "audio/wav" });
  assert.deepEqual(result, {
    transcript: "Exact words returned by the M1 CLI.",
    source: "workbench_native",
  });
});

test("enhanced native transcription requests speaker labels and preserves speaker metadata", async () => {
  let options;
  const adapter = createLocalTranscriptionAdapter({
    speakerLabels: true,
    vocabularyPath: "/opt/workbench/support/vocabulary.json",
    runner: async (_cliPath, _inputPath, _supportDir, receivedOptions) => {
      options = receivedOptions;
      return JSON.stringify({
        data: {
          transcript: "Speaker 1: Source words.",
          segments: [{ start: 0, end: 1, text: "Source words.", speaker: "Speaker 1", source: "mixed" }],
          speakers: ["Speaker 1"],
          warning: null,
        },
      });
    },
  });
  const result = await adapter.transcribe({ audio: Buffer.from("audio"), contentType: "audio/wav" });
  assert.deepEqual(options, { speakerLabels: true, vocabularyPath: "/opt/workbench/support/vocabulary.json" });
  assert.equal(result.transcript, "Speaker 1: Source words.");
  assert.deepEqual(result.speakers, ["Speaker 1"]);
  assert.equal(result.segments[0].speaker, "Speaker 1");
});
