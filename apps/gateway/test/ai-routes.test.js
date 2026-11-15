import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerAiRoutes } from "../src/ai-routes.js";

async function request(app, method, path, { body, authenticated = true, cookie, authorization } = {}) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        ...(authorization ? { authorization } : authenticated ? { authorization: "Bearer test" } : {}),
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authenticated(req, res, next) {
  if (req.headers.authorization !== "Bearer test") return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid session is required" } });
  next();
}

function appFor(options = {}) {
  const app = express();
  app.use(express.json());
  registerAiRoutes(app, { authenticated, ...options });
  return app;
}

test("AI routes remain authenticated while the release reports AI disabled", async () => {
  const app = appFor({ env: { ANTHROPIC_API_KEY: "test-key" } });
  assert.equal((await request(app, "GET", "/api/ai/status", { authenticated: false })).status, 401);
  for (const path of ["/api/fit/evaluate", "/api/outreach/personalize"]) {
    assert.equal((await request(app, "POST", path, { authenticated: false, body: {} })).status, 401);
  }
  assert.deepEqual(await request(app, "GET", "/api/ai/status"), {
    status: 200, body: { available: false, disabled: true },
  });
});

test("AI routes reject valid and incomplete requests before constructing any model client", async () => {
  let clientsCreated = 0;
  const app = appFor({
    env: { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL: "test-model", WORKBENCH_AI_ENABLED: "1" },
    clientFactory: () => { clientsCreated += 1; throw new Error("No model client may be constructed"); },
  });
  const requests = [
    ["/api/fit/evaluate", { job: { title: "Technician" }, candidate: { title: "Technician" } }],
    ["/api/fit/evaluate", {}],
    ["/api/outreach/personalize", { job: {}, candidate: {}, template: "Initial", body: "Hello" }],
    ["/api/outreach/personalize", {}],
  ];
  for (const [path, body] of requests) {
    assert.deepEqual(await request(app, "POST", path, { body }), {
      status: 409,
      body: { error: { code: "AI_DISABLED", message: "AI and transcription are disabled in this release" } },
    });
  }
  assert.equal(clientsCreated, 0);
});

test("missing AI credentials do not turn the disabled release into a setup prompt", async () => {
  const app = appFor({ env: {} });
  for (const path of ["/api/fit/evaluate", "/api/outreach/personalize"]) {
    const response = await request(app, "POST", path, { body: {} });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "AI_DISABLED");
  }
});
