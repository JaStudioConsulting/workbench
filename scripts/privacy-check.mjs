import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ignored = new Set([".git", "node_modules", "dist", "coverage", ".vercel", ".build", ".swiftpm"]);
const forbiddenAssets = /\.(avif|gif|heic|jpe?g|pdf|png|svg|webp|docx|xlsx|csv)$/i;
const approvedAssets = new Map([
  ["apps/console/public/assets/tttg_logo.png", "ecad1061bb94c2a11d901b6a6b900d2411a3ce0874806307d3bc4dca7421f055"],
  ["apps/console/public/icons/workbench-icon.svg", "9e6284903fbab5db6072500f7cb7233fee19fc1cbe059971c7cb77dce61fe6eb"],
  ["apps/console/public/icons/apple-touch-icon.png", "3f571628fb1a18741e127b1b5d7301cd7f5431bf80de79e9f0a06fd8bb234cee"],
  ["apps/console/public/icons/workbench-icon-192.png", "4d5dd153461403837660609671a1c8e7c089fc5359946a6ca96f5e587d77e99a"],
  ["apps/console/public/icons/workbench-icon-512.png", "3a0ecbce34e1cfecfb194bb59fbf407bd21dc5343cecd9bd6d487ce8162d8a29"],
]);
const credentialFiles = new Set([".npmrc", ".netrc", ".pypirc", ".env"]);
const unsafe = /(?:["']\/api\/(?:gmail\/send|loxo)|["'](?:gmail_send|candidate_submit|loxo_write|approval_decide|neo4j_write|external_delete)["'])/i;
const selfPath = fileURLToPath(import.meta.url);

async function filesAt(root, directory, findings) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    const relative = path.relative(root, target);
    if (entry.isSymbolicLink()) {
      findings.push(`${relative}: symlinks are forbidden`);
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name === "skills") findings.push(`${relative}: copied skills tree is forbidden`);
      else files.push(...await filesAt(root, target, findings));
    } else files.push(target);
  }
  return files;
}

export async function validateRepository(root) {
  const findings = [];
  for (const file of await filesAt(root, root, findings)) {
    const relative = path.relative(root, file);
    const basename = path.basename(file);
    if (basename === "package-lock.json") findings.push(`${relative}: package-lock files are forbidden`);
    if (credentialFiles.has(basename)) findings.push(`${relative}: credential configuration files are forbidden`);
    if (forbiddenAssets.test(file)) {
      const expectedHash = approvedAssets.get(relative.split(path.sep).join("/"));
      if (expectedHash && createHash("sha256").update(await readFile(file)).digest("hex") === expectedHash) continue;
      findings.push(`${relative}: binary or data assets are forbidden in this clean repository`);
      continue;
    }
    if (file === selfPath) continue;
    const buffer = await readFile(file);
    if (buffer.includes(0)) {
      findings.push(`${relative}: unexpected binary content`);
      continue;
    }
    const text = buffer.toString("utf8");
    if (/\/Users\/|[A-Z]:\\Users\\/i.test(text)) findings.push(`${relative}: machine path`);
    if (/(BEGIN( [A-Z]+)? PRIVATE KEY|AIza|ghp_|github_pat_|xox[baprs]-|sk-[A-Za-z0-9]{16,})/.test(text)) findings.push(`${relative}: credential-like value`);
    if (relative !== "pnpm-lock.yaml" && /[A-Z0-9._%+-]+@(?!example\.invalid\b)[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) findings.push(`${relative}: possible live email`);
    if (/(?:loxo|gmail|account)[_-]?id\b\s*[:=]\s*["'][A-Za-z0-9_-]{6,}/i.test(text)) findings.push(`${relative}: possible live account id`);
    if (!/(^|\/)test\//.test(relative) && !relative.startsWith("scripts/privacy-check")) {
      if (unsafe.test(text)) findings.push(`${relative}: unsafe route or tool name`);
    }
  }
  return findings;
}

if (process.argv[1] === selfPath) {
  const findings = await validateRepository(process.cwd());
  if (findings.length) {
    console.error(findings.join("\n"));
    process.exitCode = 1;
  } else console.log("Privacy check passed");
}
