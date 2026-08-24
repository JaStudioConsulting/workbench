import assert from "node:assert/strict";
import test from "node:test";
import { CandidateInputSchema, ErrorEnvelopeSchema, McpDiscoverySchema } from "../src/index.js";

test("shared contracts reject unsupported workflow input and standalone skills", () => {
  assert.throws(() => CandidateInputSchema.parse({ name: "A", title: "B", resumeText: "", jobDescription: "C" }));
  assert.throws(() => McpDiscoverySchema.parse({ frontDoor: "resume", tools: [] }));
  assert.deepEqual(ErrorEnvelopeSchema.parse({ error: { code: "UNAVAILABLE", message: "Not configured" } }).error.code, "UNAVAILABLE");
});
