import assert from "node:assert/strict";
import test from "node:test";
import { CandidateInputSchema, ErrorEnvelopeSchema, GoogleWorkspaceStartSchema, GoogleWorkspaceStatusSchema, McpDiscoverySchema } from "../src/index.js";

test("shared contracts reject unsupported workflow input and standalone skills", () => {
  assert.throws(() => CandidateInputSchema.parse({ name: "A", title: "B", resumeText: "", jobDescription: "C" }));
  assert.throws(() => McpDiscoverySchema.parse({ frontDoor: "resume", tools: [] }));
  assert.deepEqual(ErrorEnvelopeSchema.parse({ error: { code: "UNAVAILABLE", message: "Not configured" } }).error.code, "UNAVAILABLE");
});

test("Google Workspace contracts expose connection state but reject credentials", () => {
  assert.equal(GoogleWorkspaceStartSchema.parse({ authorizationUrl: "https://accounts.example/authorize", expiresAt: "2026-08-31T12:00:00.000Z" }).authorizationUrl, "https://accounts.example/authorize");
  assert.deepEqual(GoogleWorkspaceStatusSchema.parse({ connected: false }), { connected: false });
  assert.deepEqual(GoogleWorkspaceStatusSchema.parse({ connected: true, account: { email: "review@example.invalid" }, scopes: ["https://www.googleapis.com/auth/calendar.readonly"] }).connected, true);
  assert.throws(() => GoogleWorkspaceStatusSchema.parse({ connected: true, account: { email: "review@example.invalid" }, scopes: [], refreshToken: "forbidden" }));
});
