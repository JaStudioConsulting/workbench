import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalRuntimeApp } from "../src/local-runtime.js";

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
    assert.match(api.contentType, /application\/json/);
    assert.doesNotMatch(api.body, /Workbench shell/);
    assert.match(api.body, /API route not found/);
    const health = await request(app, "/healthz");
    assert.equal(health.status, 200);
    assert.match(health.body, /recruiting-workbench-gateway/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
