import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_CLI = resolve(process.cwd(), "../../native/bin/workbench-transcribe");
const DEFAULT_CAPTURE_ROOT = resolve(process.cwd(), "../../native/recordings");
const CAPTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeText(value, label) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || /[\u0000-\u001f]/.test(text)) throw new Error(`${label} is required`);
  return text;
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

async function processIdentity(pid) {
  if (!processAlive(pid)) return null;
  try {
    const { stdout } = await execFileAsync("/bin/ps", ["-p", String(pid), "-o", "lstart=", "-o", "command="], { encoding: "utf8", timeout: 2_000 });
    const value = stdout.trim();
    return value || null;
  } catch { return null; }
}

function sessionEvents(child) {
  const listeners = new Set();
  const history = [];
  let buffered = "";
  let lastError = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { lastError = `${lastError}${chunk}`.slice(-8_192); });
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() || "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        history.push(event);
        if (history.length > 20) history.shift();
        for (const listener of listeners) listener(event);
      } catch { /* Progress stays on stderr; malformed stdout never becomes a control event. */ }
    }
  });
  return {
    waitFor(name, timeout = 20_000) {
      const existing = history.find((event) => event?.event === name);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolveWait, rejectWait) => {
        const timer = setTimeout(() => {
          listeners.delete(onEvent);
          rejectWait(new Error(lastError.trim() || `Native capture did not report ${name}.`));
        }, timeout);
        const onEvent = (event) => {
          if (event?.event !== name) return;
          clearTimeout(timer);
          listeners.delete(onEvent);
          resolveWait(event);
        };
        listeners.add(onEvent);
        child.once("error", (error) => { clearTimeout(timer); listeners.delete(onEvent); rejectWait(error); });
        child.once("exit", (code) => {
          if (listeners.delete(onEvent)) {
            clearTimeout(timer);
            rejectWait(new Error(lastError.trim() || `Native capture exited with status ${code}.`));
          }
        });
      });
    },
  };
}

export function createNativeCaptureManager({
  cliPath = process.env.WORKBENCH_TRANSCRIBE_PATH || DEFAULT_CLI,
  captureRoot = process.env.WORKBENCH_CAPTURE_ROOT || DEFAULT_CAPTURE_ROOT,
  spawnImpl = spawn,
  leaseSeconds = 8,
} = {}) {
  const root = resolve(captureRoot);
  const active = new Map();
  const stopping = new Map();
  const completedStops = new Map();

  function directoryFor(id) {
    if (!CAPTURE_ID.test(id)) throw new Error("Capture ID is invalid");
    const directory = resolve(root, id);
    if (dirname(directory) !== root) throw new Error("Capture ID is invalid");
    return directory;
  }

  async function writeLease(record) {
    const expiresAt = new Date(Date.now() + leaseSeconds * 1_000).toISOString();
    await atomicJson(join(record.directory, "lease.json"), { controlID: record.controlID, expiresAt });
  }

  function startHeartbeat(record) {
    clearInterval(record.heartbeat);
    record.heartbeat = setInterval(() => {
      writeLease(record).catch(() => { clearInterval(record.heartbeat); });
    }, Math.max(1_000, Math.floor((leaseSeconds * 1_000) / 3)));
    record.heartbeat.unref?.();
  }

  async function updateLedger(record, patch) {
    record.ledger = { ...record.ledger, ...patch, updatedAt: new Date().toISOString() };
    await atomicJson(join(record.directory, "gateway-session.json"), record.ledger);
  }

  async function recoverRecord(record) {
    const recoveryDirectory = join(record.directory, "recovery");
    const { stdout } = await execFileAsync(cliPath, ["recover-capture", recoveryDirectory, "--control-id", record.controlID], {
      encoding: "utf8", timeout: 60_000, maxBuffer: 1_048_576,
    });
    const event = JSON.parse(stdout.trim().split("\n").at(-1));
    await updateLedger(record, { state: "recovered", helperPID: event.helperPID, warning: event.warning || "Capture recovered after interruption." });
    return event;
  }

  async function initialize() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !CAPTURE_ID.test(entry.name)) continue;
      const directory = directoryFor(entry.name);
      const ledger = await readJson(join(directory, "gateway-session.json")).catch(() => null);
      if (!ledger || !["preparing", "recording", "finalizing"].includes(ledger.state)) continue;
      const record = { id: entry.name, directory, controlID: ledger.controlID, ledger, child: null, events: null, heartbeat: null };
      active.set(entry.name, record);
      if (ledger.processIdentity && await processIdentity(ledger.helperPID) === ledger.processIdentity) {
        await writeLease(record);
        startHeartbeat(record);
      } else {
        await recoverRecord(record).catch(async (error) => updateLedger(record, { state: "recoverable", warning: error.message }));
        active.delete(entry.name);
      }
    }
  }

  async function start({ jobId, candidateId, ownerId }) {
    const jobID = safeText(jobId, "Job ID");
    const candidateID = safeText(candidateId, "Candidate ID");
    const ownerID = safeText(ownerId, "Owner ID");
    if (!await manager.available()) throw new Error("Native meeting capture is unavailable");
    const id = randomUUID();
    const controlID = randomBytes(32).toString("hex");
    const directory = directoryFor(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const record = {
      id, directory, controlID, child: null, events: null, heartbeat: null,
      ledger: { id, ownerId: ownerID, jobId: jobID, candidateId: candidateID, controlID, state: "preparing", helperPID: null, processIdentity: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    };
    active.set(id, record);
    await atomicJson(join(directory, "gateway-session.json"), record.ledger);
    await writeLease(record);
    const child = spawnImpl(cliPath, [
      "capture-session", directory,
      "--session-id", id,
      "--job-id", jobID,
      "--candidate-id", candidateID,
      "--control-id", controlID,
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    record.child = child;
    record.events = sessionEvents(child);
    startHeartbeat(record);
    try {
      const ready = await record.events.waitFor("ready");
      if (ready.sessionID !== id || ready.usedSystemAudio !== true) {
        throw new Error("Native capture readiness could not be verified");
      }
      const identity = await processIdentity(ready.helperPID);
      if (!identity || !identity.includes(cliPath)) throw new Error("Native capture process identity could not be verified");
      await updateLedger(record, { state: "recording", helperPID: ready.helperPID, processIdentity: identity, usedSystemAudio: true });
      return { id, state: "recording", jobId: jobID, candidateId: candidateID, usedSystemAudio: true };
    } catch (error) {
      clearInterval(record.heartbeat);
      child.kill("SIGTERM");
      await updateLedger(record, { state: "failed", warning: error.message });
      active.delete(id);
      throw error;
    }
  }

  async function waitForJournal(record, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const snapshot = await readJson(join(record.directory, "recovery/session.json")).catch(() => null);
      if (snapshot && ["complete", "partial"].includes(snapshot.state)) return snapshot;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error("Native capture did not finalize before the timeout");
  }

  async function stopOnce(id, ownerId) {
    const directory = directoryFor(id);
    const record = active.get(id) || {
      id, directory, child: null, events: null, heartbeat: null,
      ledger: await readJson(join(directory, "gateway-session.json")),
    };
    record.controlID = record.controlID || record.ledger.controlID;
    if (record.ledger.ownerId !== ownerId) throw new Error("Capture does not belong to this account");
    clearInterval(record.heartbeat);
    await updateLedger(record, { state: "finalizing" });
    const stoppedPromise = record.events?.waitFor("stopped", 35_000) || null;
    await atomicJson(join(directory, "control.json"), { controlID: record.controlID, command: "stop" });
    let event = null;
    if (stoppedPromise) event = await stoppedPromise.catch(() => null);
    let snapshot = await waitForJournal(record).catch(() => null);
    const sameHelper = record.ledger.processIdentity && await processIdentity(record.ledger.helperPID) === record.ledger.processIdentity;
    if (!snapshot && !sameHelper) {
      event = await recoverRecord(record);
      snapshot = await readJson(join(directory, "recovery/session.json"));
    }
    if (!snapshot) throw new Error("Native capture remains active or could not be recovered");
    const state = event?.state === "partial" || snapshot.state === "partial" ? "partial" : event?.event === "recovered" ? "recovered" : "captured";
    await updateLedger(record, { state, warning: event?.warning || snapshot.error || null });
    active.delete(id);
    return { id, state, jobId: record.ledger.jobId, candidateId: record.ledger.candidateId, warning: record.ledger.warning || null };
  }

  async function stop(id, ownerId) {
    const key = `${id}:${ownerId}`;
    const now = Date.now();
    for (const [completedKey, entry] of completedStops) {
      if (entry.expiresAt <= now) completedStops.delete(completedKey);
    }
    const completed = completedStops.get(key);
    if (completed) return completed.result;
    if (stopping.has(key)) return stopping.get(key);
    const pending = stopOnce(id, ownerId).then((result) => {
      completedStops.set(key, { result, expiresAt: now + 15 * 60_000 });
      while (completedStops.size > 100) completedStops.delete(completedStops.keys().next().value);
      stopping.delete(key);
      return result;
    }, (error) => {
      stopping.delete(key);
      throw error;
    });
    stopping.set(key, pending);
    return pending;
  }

  async function audioInfo(id, source = "mixed", ownerId = null) {
    const directory = directoryFor(id);
    if (ownerId) {
      const ledger = await readJson(join(directory, "gateway-session.json"));
      if (ledger.ownerId !== ownerId) throw new Error("Capture does not belong to this account");
    }
    const names = source === "microphone" ? ["microphone.wav"] : source === "system" ? ["system.wav"] : ["mixed.wav", "system.wav", "microphone.wav"];
    for (const name of names) {
      const path = join(directory, "recovery", name);
      const info = await stat(path).catch(() => null);
      if (info?.isFile() && info.size > 44) return { path, size: info.size, contentType: "audio/wav", stream: (options) => createReadStream(path, options) };
    }
    throw new Error("Capture audio is unavailable");
  }

  async function assertOwner(id, ownerId) {
    const directory = directoryFor(id);
    const ledger = await readJson(join(directory, "gateway-session.json"));
    if (ledger.ownerId !== ownerId) throw new Error("Capture does not belong to this account");
    return directory;
  }

  async function loadFinalizedResponse(id, ownerId) {
    const directory = await assertOwner(id, ownerId);
    return readJson(join(directory, "final-response.json")).catch(() => null);
  }

  async function saveFinalizedResponse(id, ownerId, response) {
    const directory = await assertOwner(id, ownerId);
    await atomicJson(join(directory, "final-response.json"), response);
    return response;
  }

  const manager = {
    initialize,
    start,
    stop,
    audioInfo,
    loadFinalizedResponse,
    saveFinalizedResponse,
    async available() { try { return (await stat(cliPath)).isFile(); } catch { return false; } },
    async status(id, ownerId) {
      const directory = directoryFor(id);
      const ledger = await readJson(join(directory, "gateway-session.json"));
      if (ledger.ownerId !== ownerId) throw new Error("Capture does not belong to this account");
      return { id, state: ledger.state, jobId: ledger.jobId, candidateId: ledger.candidateId, warning: ledger.warning || null };
    },
  };
  return manager;
}

export function parseByteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) throw new Error("Invalid audio range");
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start == null && end != null) { start = Math.max(0, size - end); end = size - 1; }
  else { start ??= 0; end ??= size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end >= size) throw new Error("Invalid audio range");
  return { start, end };
}
