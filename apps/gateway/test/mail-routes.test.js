import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import express from "express";

import { registerMailRoutes } from "../src/mail-routes.js";

const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

async function routeRequest(app, method, path, body) {
  const server = await new Promise((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  try {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: "127.0.0.1",
        port: server.address().port,
        path,
        method,
        headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {},
      }, (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
      });
      req.on("error", reject);
      req.end(payload);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function fixture({ scopes = [], gmail } = {}) {
  const app = express();
  app.use(express.json({ limit: "128kb" }));
  const observed = { tokens: [] };
  registerMailRoutes(app, {
    authenticated(req, _res, next) {
      req.workbenchSession = { user: { id: "user-1", email: "review@example.invalid" } };
      next();
    },
    async getGoogleProviderAccessToken() {
      return { accessToken: "provider-access", scopes };
    },
    async gmailClientFactory(token) {
      observed.tokens.push(token);
      return gmail || { users: {} };
    },
  });
  return { app, observed };
}

test("mail status returns only plain connection capability booleans", async () => {
  const fx = fixture({ scopes: [READ_SCOPE] });
  const response = await routeRequest(fx.app, "GET", "/api/mail/status");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { connected: true, canDraft: false, canRead: true });
  assert.doesNotMatch(JSON.stringify(response.body), /provider-access/);
});

test("draft creation fails closed when compose authority is absent", async () => {
  const fx = fixture({ scopes: [READ_SCOPE] });
  const response = await routeRequest(fx.app, "POST", "/api/mail/draft", {
    to: "candidate@example.invalid",
    subject: "Following up",
    body: "Checking in about the role.",
  });
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { ok: false, reason: "no_scope" });
  assert.deepEqual(fx.observed.tokens, []);
});

test("draft creation uses the draft-only service with an encoded message", async () => {
  let createOptions;
  const fx = fixture({
    scopes: [COMPOSE_SCOPE],
    gmail: {
      users: {
        drafts: {
          async create(options) {
            createOptions = options;
            return { data: { id: "draft-1" } };
          },
        },
      },
    },
  });
  const response = await routeRequest(fx.app, "POST", "/api/mail/draft", {
    to: "candidate@example.invalid",
    subject: "Following up",
    body: "Checking in about the role.",
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { ok: true, id: "draft-1" });
  assert.equal(createOptions.userId, "me");
  const decoded = Buffer.from(createOptions.requestBody.message.raw, "base64url").toString("utf8");
  assert.match(decoded, /^To: candidate@example\.invalid\r\nSubject: Following up/);
  assert.match(decoded, /Checking in about the role\.$/);
});

test("replies return the latest inbound date per normalized candidate email", async () => {
  const listQueries = [];
  const fx = fixture({
    scopes: [READ_SCOPE],
    gmail: {
      users: {
        messages: {
          async list(options) {
            listQueries.push(options.q);
            return options.q.includes("first@") ? { data: { messages: [{ id: "message-1" }] } } : { data: { messages: [] } };
          },
          async get() {
            return { data: { internalDate: String(Date.parse("2026-11-03T15:30:00.000Z")) } };
          },
        },
      },
    },
  });
  const response = await routeRequest(
    fx.app,
    "GET",
    "/api/mail/replies?emails=First%40example.invalid%2Csecond%40example.invalid",
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    available: true,
    latestByEmail: {
      "first@example.invalid": "2026-11-03T15:30:00.000Z",
      "second@example.invalid": null,
    },
  });
  assert.deepEqual(listQueries, [
    "from:first@example.invalid -from:me",
    "from:second@example.invalid -from:me",
  ]);
});

test("replies stay unavailable without read authority and reject invalid input", async () => {
  const fx = fixture({ scopes: [COMPOSE_SCOPE] });
  const unavailable = await routeRequest(fx.app, "GET", "/api/mail/replies?emails=candidate%40example.invalid");
  assert.deepEqual(unavailable.body, { available: false, latestByEmail: {} });

  const invalid = await routeRequest(fx.app, "GET", "/api/mail/replies?emails=not-an-email");
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, { available: false, latestByEmail: {}, reason: "invalid_input" });
});
