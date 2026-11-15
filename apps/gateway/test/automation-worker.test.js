import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomationRest, processAutomationJob, startAutomationWorker } from '../src/automation-worker.js';

const env = { SUPABASE_URL: 'https://automation.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic' };
const job = { id: 'job-1', lease_token: 'lease-1', payload: { candidate: { id: 'sourcing:7' } } };

test('completed job atomically finishes with its exact lease and output status', async () => {
  const calls = [];
  const outputs = [{ type: 'candidate_submission', content: { status: 'ready' } }];
  const result = { needsInformation: true, missing: ['structuredResume'], readyOutputs: ['candidate_submission'] };
  await processAutomationJob(async (path, options) => { calls.push({ path, ...options }); }, job, {
    assembler: async (payload) => { assert.equal(payload, job.payload); return { outputs, result }; },
  });
  assert.deepEqual(calls, [{ path: 'rpc/finish_workbench_automation', method: 'POST', body: { job_id: job.id, token: job.lease_token, outputs, output_status: result } }]);
});

test('failed assembly releases only its own lease through the durable retry RPC', async () => {
  const calls = [];
  await processAutomationJob(async (path, options) => { calls.push({ path, ...options }); }, job, { assembler: async () => { throw new Error('Invalid source snapshot'); } });
  assert.deepEqual(calls, [{ path: 'rpc/fail_workbench_automation', method: 'POST', body: { job_id: job.id, token: job.lease_token, message: 'Invalid source snapshot' } }]);
});

test('storage completion failure never claims success and retains the lease token for failure handling', async () => {
  const calls = [];
  await processAutomationJob(async (path, options) => {
    calls.push({ path, ...options });
    if (path === 'rpc/finish_workbench_automation') throw new Error('Storage unavailable');
  }, job, { assembler: async () => ({ outputs: [], result: {} }) });
  assert.deepEqual(calls.map((call) => call.path), ['rpc/finish_workbench_automation', 'rpc/fail_workbench_automation']);
  assert.equal(calls[1].body.token, 'lease-1');
  assert.equal(calls[1].body.message, 'Storage unavailable');
});

test('automation REST uses owner bearer credentials and does not expose database response details', async () => {
  let request;
  const rest = createAutomationRest({ env, accessToken: 'synthetic-owner-token', fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => [] };
  } });
  assert.deepEqual(await rest('rpc/claim_workbench_automation', { method: 'POST', body: {} }), []);
  assert.equal(request.url, 'https://automation.example.invalid/rest/v1/rpc/claim_workbench_automation');
  assert.equal(request.options.headers.Authorization, 'Bearer synthetic-owner-token');
  assert.equal(request.options.headers.apikey, 'sb_publishable_synthetic');
  assert.equal(request.options.body, '{}');
  assert.ok(request.options.signal instanceof AbortSignal);
  const unavailable = createAutomationRest({ env, accessToken: 'synthetic-owner-token', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ detail: 'private database detail' }) }) });
  await assert.rejects(unavailable('rpc/claim_workbench_automation'), (error) => error.message === 'Automation storage request failed (403)');
});

function deadline(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Worker test timed out')), 1500); })]).finally(() => clearTimeout(timer));
}

test('worker reconciles and drains jobs with owner credentials and no sends or model requests', async () => {
  const paths = [];
  let claims = 0;
  let sessions = 0;
  let completed;
  const done = new Promise((resolve) => { completed = resolve; });
  const worker = startAutomationWorker({
    env: { ...env, ANTHROPIC_API_KEY: 'synthetic-unused-key' }, intervalMs: 60_000,
    issueSession: async () => { sessions += 1; return { access_token: 'synthetic-owner-token', expires_at: Math.floor(Date.now() / 1000) + 3600 }; },
    assembler: async (payload) => { assert.deepEqual(payload, job.payload); return { outputs: [], result: { needsInformation: true } }; },
    fetchImpl: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://automation.example.invalid');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-owner-token');
      paths.push(parsed.pathname);
      if (parsed.pathname.endsWith('/reconcile_workbench_automation')) return { ok: true, json: async () => 1 };
      if (parsed.pathname.endsWith('/claim_workbench_automation')) {
        claims += 1;
        if (claims > 1) completed();
        return { ok: true, json: async () => claims === 1 ? [job] : [] };
      }
      assert.equal(parsed.pathname, '/rest/v1/rpc/finish_workbench_automation');
      assert.equal(JSON.parse(options.body).token, job.lease_token);
      return { ok: true, json: async () => 'case-1' };
    },
    logger: { error(message) { assert.fail(message); } },
  });
  try {
    await deadline(done);
    assert.equal(sessions, 1);
    assert.deepEqual(paths, ['/rest/v1/rpc/reconcile_workbench_automation', '/rest/v1/rpc/claim_workbench_automation', '/rest/v1/rpc/finish_workbench_automation', '/rest/v1/rpc/claim_workbench_automation']);
  } finally { worker.stop(); }
});

test('worker retries an unavailable owner session without logging credentials', async () => {
  const messages = [];
  let sessions = 0;
  let completed;
  const done = new Promise((resolve) => { completed = resolve; });
  const worker = startAutomationWorker({
    env, intervalMs: 10,
    issueSession: async () => {
      sessions += 1;
      if (sessions === 1) throw new Error('private-token-must-not-be-logged');
      return { access_token: 'synthetic-owner-token', expires_at: Math.floor(Date.now() / 1000) + 3600 };
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith('/reconcile_workbench_automation')) return { ok: true, json: async () => 0 };
      assert.match(String(url), /\/claim_workbench_automation$/);
      completed();
      return { ok: true, json: async () => [] };
    },
    logger: { error(message) { messages.push(message); } },
  });
  try {
    await deadline(done);
    assert.equal(sessions, 2);
    assert.equal(messages.length, 1);
    assert.doesNotMatch(messages.join(' '), /private-token/);
  } finally { worker.stop(); }
});
