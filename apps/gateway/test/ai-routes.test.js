import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerAiRoutes } from "../src/ai-routes.js";

async function request(app, method, path, { body, authenticated = true } = {}) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        ...(authenticated ? { authorization: "Bearer test" } : {}),
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
  if (req.headers.authorization !== "Bearer test") return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Sign in required" } });
  next();
}

function appFor(options = {}) {
  const app = express();
  app.use(express.json());
  registerAiRoutes(app, { authenticated, ...options });
  return app;
}

function textResponse(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

test("AI status and routes require authentication and report missing setup honestly", async () => {
  const app = appFor({ env: {} });
  assert.equal((await request(app, "GET", "/api/ai/status", { authenticated: false })).status, 401);
  assert.deepEqual(await request(app, "GET", "/api/ai/status"), { status: 200, body: { available: false } });
  assert.deepEqual(await request(app, "POST", "/api/fit/evaluate", { body: { job: {}, candidate: {} } }), {
    status: 503,
    body: { error: { code: "AI_NOT_CONFIGURED", message: "AI check not set up" } },
  });
});

test("fit evaluation runs four specialists before a validated summary", async () => {
  const calls = [];
  let activeSpecialists = 0;
  let maxActiveSpecialists = 0;
  const messages = {
    async create(params, requestOptions) {
      calls.push({ params, requestOptions });
      if (params.system.includes("senior recruiter")) {
        assert.equal(activeSpecialists, 0);
        return textResponse({
          level: "strong",
          strengths: ["Matched automation work [candidate.workHistory]"],
          gaps: ["Certification detail is not in source"],
        });
      }
      activeSpecialists += 1;
      maxActiveSpecialists = Math.max(maxActiveSpecialists, activeSpecialists);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeSpecialists -= 1;
      return textResponse({ level: "possible", reasons: ["Evidence found in [candidate.profileSummary]"] });
    },
  };
  const app = appFor({
    env: { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL: "test-model" },
    clientFactory: (key) => {
      assert.equal(key, "test-key");
      return { messages };
    },
  });
  const response = await request(app, "POST", "/api/fit/evaluate", {
    body: {
      job: { id: "job-1", title: "Automation Technician", requirements: "PLC experience" },
      candidate: { id: "candidate-1", title: "Automation Technician", profileSummary: "PLC maintenance" },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.level, "strong");
  assert.deepEqual(Object.keys(response.body.specialists), ["skills", "culture", "risk", "market"]);
  assert.equal(calls.length, 5);
  assert.equal(maxActiveSpecialists, 4);
  assert.equal(calls.every(({ params }) => params.model === "test-model"), true);
  assert.equal(calls.every(({ requestOptions }) => requestOptions.timeout === 60_000), true);
  assert.equal(calls.some(({ params }) => params.messages[0].content.includes("test-key")), false);
});

test("AI routes reject invalid input and malformed provider output", async () => {
  const app = appFor({
    env: { ANTHROPIC_API_KEY: "test-key" },
    clientFactory: () => ({ messages: { create: async () => ({ content: [{ type: "text", text: "not json" }] }) } }),
  });
  const invalid = await request(app, "POST", "/api/fit/evaluate", { body: { job: {} } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "INVALID_REQUEST");
  const malformed = await request(app, "POST", "/api/fit/evaluate", { body: { job: {}, candidate: {} } });
  assert.equal(malformed.status, 502);
  assert.equal(malformed.body.error.code, "AI_INVALID_OUTPUT");
});

test("outreach personalization returns a draft and never performs a send", async () => {
  let requestParams;
  const app = appFor({
    env: { ANTHROPIC_API_KEY: "test-key" },
    clientFactory: () => ({ messages: { create: async (params) => {
      requestParams = params;
      return textResponse({ subject: "Maintenance opportunity", body: "Your PLC maintenance background matches this role." });
    } } }),
  });
  const response = await request(app, "POST", "/api/outreach/personalize", {
    body: {
      job: { title: "Maintenance Supervisor" },
      candidate: { profileSummary: "PLC maintenance" },
      template: "Initial outreach",
      body: "Hello, I have a role to discuss.",
    },
  });
  assert.deepEqual(response, {
    status: 200,
    body: { subject: "Maintenance opportunity", body: "Your PLC maintenance background matches this role." },
  });
  assert.match(requestParams.system, /draft only/i);
  assert.doesNotMatch(requestParams.system, /auto.?send/i);
});
