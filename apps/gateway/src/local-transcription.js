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

async function parsedTranscript(output, inputPath) {
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
  const details = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const segments = Array.isArray(details?.segments) ? details.segments : null;
  const speakers = Array.isArray(details?.speakers) ? details.speakers : null;
  const warning = typeof details?.warning === "string" && details.warning.trim() ? details.warning.trim() : null;
  return {
    transcript,
    source: "workbench_native",
    ...(typeof details?.model === "string" ? { model: details.model } : {}),
    ...(segments?.length ? { segments } : {}),
    ...(speakers?.length ? { speakers } : {}),
    ...(warning ? { warning } : {}),
  };
}

async function defaultRunner(cliPath, inputPath, supportDir, options = {}) {
  const args = [
    "transcribe",
    inputPath,
    "--format",
    "json",
    "--support-dir",
    supportDir,
  ];
  if (options.speakerLabels) args.push("--speaker-labels");
  if (options.vocabularyPath) args.push("--vocabulary", options.vocabularyPath);
  const { stdout } = await execFileAsync(cliPath, args, {
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
  speakerLabels = process.env.WORKBENCH_NATIVE_MEETING_ENHANCEMENTS === "1",
  vocabularyPath = process.env.WORKBENCH_MEETING_VOCABULARY_PATH || "",
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
        const output = await runner(cliPath, inputPath, supportDir, { speakerLabels, vocabularyPath });
        return await parsedTranscript(output, inputPath);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },

    async transcribeFile({ path }) {
      const extension = String(path || "").toLowerCase().match(/\.(wav|m4a|mp4|mp3)$/)?.[0];
      if (!extension || !await stat(path).then((value) => value.isFile() && value.size > 44).catch(() => false)) {
        throw new Error("Meeting audio is empty or unsupported");
      }
      const output = await runner(cliPath, path, supportDir, { speakerLabels, vocabularyPath });
      return parsedTranscript(output, path);
    },
  };
}

export const meetingAudioBody = {
  type: [...CONTENT_EXTENSIONS.keys()],
  limit: "250mb",
};
