import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAutomationRoutes } from '../src/automation-routes.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222';
const CANDIDATE = 'manual:33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';

function access(req, res, next) {
  const token = req.get('authorization');
  const ownerId = token === 'Bearer owner-token' ? OWNER : token === 'Bearer other-token' ? OTHER_OWNER : null;
  if (!ownerId) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Private session required' } });
  req.supabaseRecruiter = { ownerId, accessToken: token.slice(7) };
  return next();
}

async function fixture(t, fetchImpl) {
  const directory = await mkdtemp(join(tmpdir(), 'workbench-automation-routes-'));
  const app = express();
  app.use(express.json({ limit: '29mb' }));
  registerAutomationRoutes(app, {
    access,
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', WORKBENCH_DATA_DIR: directory },
    fetchImpl,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, { method = 'GET', body, token = 'owner-token', binary = false } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, body: binary ? Buffer.from(await response.arrayBuffer()) : await response.json() };
  }
  return { directory, request };
}

function pdfBytes() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(text);
}

test('automation status forwards the authenticated owner token and filters the candidate', async t => {
  const calls = [];
  const { request } = await fixture(t, async (rawUrl, options) => {
    const url = new URL(rawUrl);
    calls.push({ url, options });
    return Response.json([{ id: TASK, record_key: `automation:${CANDIDATE}:job:none`, state: 'ready', candidate_name: 'Saved candidate' }]);
  });
  const response = await request(`/api/automation/jobs?candidateId=${encodeURIComponent(CANDIDATE)}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.jobs[0].id, TASK);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer owner-token');
  assert.equal(calls[0].options.headers.apikey, 'sb_publishable_test');
  assert.equal(calls[0].url.pathname, '/rest/v1/automation_job_status');
  assert.equal(calls[0].url.searchParams.get('record_key'), `like.automation:${CANDIDATE}:job:*`);
});

test('input saves validate fields, bind ownership, and then reconcile automatically', async t => {
  const calls = [];
  const { request } = await fixture(t, async (rawUrl, options) => {
    const url = new URL(rawUrl);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    if (url.pathname.endsWith('/candidates_all')) return Response.json([{ id: CANDIDATE, candidate_name: 'Saved candidate' }]);
    if (url.pathname.endsWith('/automation_inputs')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/rpc/reconcile_workbench_automation')) return Response.json(1);
    throw new Error('Unexpected storage request');
  });
  const path = `/api/automation/candidates/${encodeURIComponent(CANDIDATE)}/inputs`;
  const response = await request(path, { method: 'PUT', body: { owner_id: OTHER_OWNER, fields: { vacation: ' Two weeks ', workStatus: 'Recorded status' }, resume: null } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { saved: true });
  assert.deepEqual(calls.map(call => call.url.pathname), ['/rest/v1/candidates_all', '/rest/v1/automation_inputs', '/rest/v1/rpc/reconcile_workbench_automation']);
  assert.equal(calls.every(call => call.options.headers.Authorization === 'Bearer owner-token'), true);
  assert.equal(calls[1].body.owner_id, OWNER);
  assert.equal(calls[1].body.candidate_id, CANDIDATE);
  assert.equal(calls[1].body.fields.vacation, 'Two weeks');
  const before = calls.length;
  const invalid = await request(path, { method: 'PUT', body: { fields: { inventedField: 'Wrong input' }, resume: null } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error.message, /invalid/);
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1).url.pathname, '/rest/v1/candidates_all');
});

test('original PDF upload downloads byte-for-byte and remains owner-scoped', async t => {
  const docs = new Map();
  const { request, directory } = await fixture(t, async (rawUrl, options) => {
    const url = new URL(rawUrl);
    assert.equal(url.pathname, '/rest/v1/workbench_documents');
    if (options.method === 'POST') {
      const document = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, 'Bearer owner-token');
      docs.set(document.id, document);
      return new Response(null, { status: 201 });
    }
    const doc = docs.get(url.searchParams.get('id')?.slice(3));
    return Response.json(doc && options.headers.Authorization === 'Bearer owner-token' ? [doc] : []);
  });
  const bytes = pdfBytes();
  const uploaded = await request('/api/documents', { method: 'POST', body: { candidateId: CANDIDATE, name: 'Original résumé.pdf', base64: bytes.toString('base64') } });
  assert.equal(uploaded.status, 201);
  const id = uploaded.body.id;
  assert.equal(docs.get(id).owner_id, OWNER);
  assert.equal(docs.get(id).candidate_id, CANDIDATE);
  assert.equal(docs.get(id).size_bytes, bytes.length);
  assert.deepEqual(await readFile(join(directory, 'documents', OWNER, id)), bytes);
  const downloaded = await request(`/api/documents/${id}/download`, { binary: true });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'application/pdf');
  assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.match(downloaded.headers.get('content-disposition'), /^attachment;/);
  assert.deepEqual(downloaded.body, bytes);
  const other = await request(`/api/documents/${id}/download`, { token: 'other-token' });
  assert.equal(other.status, 404);
  assert.equal(other.body.error.code, 'NOT_FOUND');
});

test('lost metadata response preserves bytes after the database insert committed', async t => {
  let storedDocument;
  const { request, directory } = await fixture(t, async (rawUrl, options) => {
    const url = new URL(rawUrl);
    assert.equal(url.pathname, '/rest/v1/workbench_documents');
    if (options.method === 'POST') {
      storedDocument = JSON.parse(options.body);
      throw new TypeError('Simulated response loss after commit');
    }
    return Response.json([storedDocument]);
  });
  const bytes = pdfBytes();
  const uploaded = await request('/api/documents', { method: 'POST', body: { candidateId: CANDIDATE, name: 'original.pdf', base64: bytes.toString('base64') } });
  assert.equal(uploaded.status, 400);
  assert.ok(storedDocument?.id);
  assert.deepEqual(await readFile(join(directory, 'documents', OWNER, storedDocument.id)), bytes);
  const downloaded = await request(`/api/documents/${storedDocument.id}/download`, { binary: true });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.body, bytes);
});

test('document upload rejects invalid supplied job IDs before writing bytes or metadata', async t => {
  let storageCalls = 0;
  const { request, directory } = await fixture(t, async () => { storageCalls += 1; throw new Error('Storage must not be reached'); });
  for (const jobId of ['not-a-job', 0, -1, 1.5]) {
    const response = await request('/api/documents', { method: 'POST', body: { candidateId: CANDIDATE, jobId, name: 'original.pdf', base64: pdfBytes().toString('base64') } });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.message, 'Invalid job');
  }
  assert.equal(storageCalls, 0);
  assert.deepEqual(await readdir(directory), []);
});

test('automation and document routes require the supplied owner authentication middleware', async t => {
  let storageCalls = 0;
  const { request, directory } = await fixture(t, async () => { storageCalls += 1; throw new Error('Storage must not be reached'); });
  for (const [method, path] of [
    ['GET', '/api/automation/jobs'],
    ['POST', '/api/automation/reconcile'],
    ['POST', `/api/automation/jobs/${TASK}/retry`],
    ['GET', `/api/automation/candidates/${encodeURIComponent(CANDIDATE)}/inputs`],
    ['PUT', `/api/automation/candidates/${encodeURIComponent(CANDIDATE)}/inputs`],
    ['GET', '/api/documents'],
    ['POST', '/api/documents'],
    ['GET', `/api/documents/${TASK}/download`],
  ]) {
    const response = await request(path, { method, token: null, ...(method === 'GET' ? {} : { body: {} }) });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(response.body.error.code, 'UNAUTHORIZED');
  }
  assert.equal(storageCalls, 0);
  assert.deepEqual(await readdir(directory), []);
});
