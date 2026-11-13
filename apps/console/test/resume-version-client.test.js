import assert from "node:assert/strict";
import test from "node:test";
import { renderBrandedResumeVersion } from "../src/features/operator-cases/resumeVersionClient.js";

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test("resume version edits send the exact structured sections with caller bearer token", async () => {
  const sections = { name: { value: "Example", evidence: [{ source: "resume", quote: "Example" }] } };
  let request;
  const artifact = { id: "new-version", artifact_type: "branded_resume", content: { sections, pdf: { mimeType: "application/pdf" } } };
  const result = await renderBrandedResumeVersion("case/one", { artifactId: "old", expectedUpdatedAt: "2026-11-13T12:00:00Z", sections }, {
    baseURL: "https://gateway.example",
    getAccessToken: async () => "user-token",
    fetchImpl: async (url, options) => { request = { url: String(url), options }; return response({ artifact }); },
  });
  assert.equal(result.id, "new-version");
  assert.equal(request.url, "https://gateway.example/api/operator-cases/case%2Fone/branded-resume/versions");
  assert.equal(request.options.headers.Authorization, "Bearer user-token");
  assert.deepEqual(JSON.parse(request.options.body), { artifactId: "old", expectedUpdatedAt: "2026-11-13T12:00:00Z", sections });
});

test("resume version edit keeps saved version intact when rendering fails", async () => {
  await assert.rejects(renderBrandedResumeVersion("case-1", { artifactId: "old", expectedUpdatedAt: "2026-11-13T12:00:00Z", sections: {} }, {
    getAccessToken: async () => "user-token",
    fetchImpl: async () => response({ error: { code: "RESUME_RENDER_FAILED" } }, 502),
  }), /saved version is unchanged/i);
});
