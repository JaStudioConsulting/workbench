import assert from "node:assert/strict";
import test from "node:test";

const worker = (await import("../dist/server/index.js")).default;

function request(path, init) {
  return worker.fetch(new Request(`https://workbench.test${path}`, init), {
    ASSETS: { fetch: async () => new Response("site-shell", { status: 200 }) },
  });
}

async function mcp(method, params, id = 1) {
  const response = await request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("Site worker serves the current shell and honest API boundary", async () => {
  assert.equal(await (await request("/settings")).text(), "site-shell");
  const unavailable = await request("/api/google-workspace/status");
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error, "gateway_unavailable");
});

test("Site MCP exposes only the Recruiter front door and read-only status", async () => {
  const listed = await mcp("tools/list", {});
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["recruiter", "workspace_status"]);
});

test("Recruiter call returns rules, router, and only the selected guide", async () => {
  const called = await mcp("tools/call", { name: "recruiter", arguments: { capability: "vet" } });
  const output = called.result.content[0].text;
  const rulesIndex = output.indexOf("JA OPERATING RULES");
  const routerIndex = output.indexOf("Recruiter");
  const guideIndex = output.indexOf("# vet", routerIndex + 1);

  assert.ok(rulesIndex >= 0, "mandatory Ja rules must be present");
  assert.ok(routerIndex > rulesIndex, "Recruiter router must follow the rules");
  assert.ok(guideIndex > routerIndex, "selected guide must follow the router");
  assert.equal(output.includes("TOOL MAP"), false);
});

test("Recruiter routes candidate-facing interview prep material", async () => {
  const called = await mcp("tools/call", { name: "recruiter", arguments: { capability: "interview-prep-material" } });
  const output = called.result.content[0].text;
  assert.match(output, /# Interview Prep Material/);
  assert.match(output, /candidate-facing interview prep PDF/i);
});
