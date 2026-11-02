import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalRuntimeApp } from "../src/local-runtime.js";
import { isTrustedLocalAddress } from "../src/local-trust.js";

async function request(app, path, { accept } = {}) {
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try {
    return await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: "127.0.0.1",
        port: server.address().port,
        path,
        headers: accept ? { accept } : {},
      }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body, contentType: res.headers["content-type"] }));
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("trusted local addresses are explicit and do not include public clients", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.2.3", "172.20.1.2", "192.168.1.3", "100.100.20.30", "fd7a:115c:a1e0::1", "fe80::1%en0"]) {
    assert.equal(isTrustedLocalAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:4860:4860::8888", "not-an-ip", ""]) {
    assert.equal(isTrustedLocalAddress(address), false, address);
  }
});

test("local runtime serves built assets and uses index only for SPA routes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workbench-dist-"));
  try {
    await mkdir(join(directory, "assets"));
    await writeFile(join(directory, "index.html"), "<!doctype html><main>Workbench shell</main>");
    await writeFile(join(directory, "assets", "app.js"), "globalThis.workbench = true;");
    const app = await createLocalRuntimeApp({
      distDir: directory,
      env: {},
      recruitmentContextLoader: async () => { throw new Error("synthetic unavailable authority"); },
      authConfig: { enabled: false, reason: "Authentication unavailable" },
    });

    const asset = await request(app, "/assets/app.js");
    assert.equal(asset.status, 200);
    assert.equal(asset.body, "globalThis.workbench = true;");
    const spa = await request(app, "/meetings/today", { accept: "text/html" });
    assert.equal(spa.status, 200);
    assert.match(spa.body, /Workbench shell/);
    const api = await request(app, "/api/unknown", { accept: "text/html" });
    assert.equal(api.status, 404);
    assert.doesNotMatch(api.body, /Workbench shell/);
    const health = await request(app, "/healthz");
    assert.equal(health.status, 200);
    assert.match(health.body, /recruiting-workbench-gateway/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
