import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { registerResumeFormatRoutes } from "../src/resume-format-routes.js";
import { docxBodyWords, pdfExtract } from "./helpers/resume-extract.js";

async function withServer(options, run) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const access = options.access || ((req, _res, next) => { req.supabaseRecruiter = { ownerId: "x" }; next(); });
  registerResumeFormatRoutes(app, { access, ...(options.formatter ? { formatter: options.formatter } : {}) });
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  try { return await run(`http://127.0.0.1:${server.address().port}/api/resume-format`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("route returns a PDF and a Word file with safe names and no caching", async () => {
  await withServer({}, async (url) => {
    const text = "Alex Rivera\n\nSUMMARY\n- Built things";
    const pdf = await post(url, { text, format: "pdf", candidateName: "Alex \"Rivera\"/x" });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("content-disposition"), /^attachment; filename="Alex Rivera x - Top Tier Talent Group\.pdf"/u);
    assert.equal(pdf.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await pdfExtract(Buffer.from(await pdf.arrayBuffer()))).words, ["Alex", "Rivera", "SUMMARY", "Built", "things"]);
    const docx = await post(url, { text, format: "docx", candidateName: "Alex Rivera" });
    assert.equal(docx.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.deepEqual((await docxBodyWords(Buffer.from(await docx.arrayBuffer()))).words, ["Alex", "Rivera", "SUMMARY", "Built", "things"]);
  });
});

test("route says plainly when there is no text, a bad format or an undrawable character", async () => {
  await withServer({}, async (url) => {
    for (const body of [{ format: "pdf" }, { text: "  \n", format: "docx" }, { text: 5, format: "pdf" }]) {
      const response = await post(url, body);
      assert.equal(response.status, 422);
      const payload = await response.json();
      assert.equal(payload.error.code, "NO_RESUME_TEXT");
      assert.equal(payload.error.message, "There is no resume text to format. Add or paste the resume text first, then try again.");
    }
    assert.equal((await post(url, { text: "Name", format: "rtf" })).status, 400);
    const emoji = await post(url, { text: "Name Here\n\nrocket 🚀", format: "pdf" });
    assert.equal(emoji.status, 422);
    assert.equal((await emoji.json()).error.code, "UNSUPPORTED_CHARACTER");
  });
});

test("route is behind the access guard and never logs resume text", async () => {
  let reached = false;
  await withServer({ access: (_req, res) => res.status(401).json({ error: { code: "UNAUTHORIZED" } }), formatter: async () => { reached = true; } }, async (url) => {
    assert.equal((await post(url, { text: "Secret Name", format: "pdf" })).status, 401);
  });
  assert.equal(reached, false);
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(JSON.stringify(args));
  try {
    await withServer({ formatter: async () => { throw new Error("boom SECRET-RESUME-WORDS"); } }, async (url) => {
      const response = await post(url, { text: "SECRET-RESUME-WORDS here", format: "pdf" });
      assert.equal(response.status, 500);
      assert.equal((await response.json()).error.code, "RESUME_FORMAT_FAILED");
    });
  } finally { console.error = original; }
  assert.ok(logged.every((line) => !line.includes("SECRET-RESUME-WORDS")));
});
