import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_CLI = resolve(process.cwd(), "../../native/bin/workbench-transcribe");
const DEFAULT_SUPPORT_DIR = resolve(process.cwd(), "../../native/support");
const CONTENT_EXTENSIONS = new Map([
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/mp4", ".m4a"],
  ["audio/m4a", ".m4a"],
  ["audio/x-m4a", ".m4a"],
  ["audio/mpeg", ".mp3"],
]);

function transcriptFromJson(value) {
  if (typeof value?.text === "string") return value.text.trim();
  if (typeof value?.transcript === "string") return value.transcript.trim();
  if (typeof value?.data?.transcript === "string") return value.data.transcript.trim();
  if (Array.isArray(value?.segments)) {
    return value.segments.map((segment) => segment?.text).filter((text) => typeof text === "string").join(" ").trim();
  }
  return "";
}

async function defaultRunner(cliPath, inputPath, supportDir) {
  const { stdout } = await execFileAsync(cliPath, [
    "transcribe",
    inputPath,
    "--format",
    "json",
    "--support-dir",
    supportDir,
  ], {
    encoding: "utf8",
    timeout: 15 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export function createLocalTranscriptionAdapter({
  cliPath = process.env.WORKBENCH_TRANSCRIBE_PATH || DEFAULT_CLI,
  supportDir = DEFAULT_SUPPORT_DIR,
  runner = defaultRunner,
} = {}) {
  return {
    async available() {
      try {
        return (await stat(cliPath)).isFile();
      } catch {
        return false;
      }
    },

    async transcribe({ audio, contentType }) {
      const extension = CONTENT_EXTENSIONS.get(String(contentType || "").split(";")[0]);
      if (!extension) throw new Error("Unsupported meeting audio format");
      if (!Buffer.isBuffer(audio) || audio.length === 0) throw new Error("Meeting audio is empty");

      const directory = await mkdtemp(join(tmpdir(), "workbench-meeting-"));
      const inputPath = join(directory, `recording${extension}`);
      try {
        await writeFile(inputPath, audio, { flag: "wx", mode: 0o600 });
        const output = await runner(cliPath, inputPath, supportDir);
        let parsed;
        try {
          parsed = typeof output === "string" ? JSON.parse(output) : output;
        } catch {
          const sidecar = await readFile(`${inputPath}.json`, "utf8").catch(() => "");
          if (!sidecar) throw new Error("Workbench transcription returned invalid data");
          parsed = JSON.parse(sidecar);
        }
        const transcript = transcriptFromJson(parsed);
        if (!transcript) throw new Error("Workbench transcription returned an empty transcript");
        return { transcript, source: "workbench_native" };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

export const meetingAudioBody = {
  type: [...CONTENT_EXTENSIONS.keys()],
  limit: "250mb",
};
