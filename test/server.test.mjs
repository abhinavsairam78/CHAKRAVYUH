import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let server, folder, base;
before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'chakravyuh-test-'));
  server = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: '0', CHAKRAVYUH_LLM: '', CHAKRAVYUH_DATA_FILE: join(folder, 'store.json') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 15000);
    server.once('error', reject);
    server.stdout.on('data', (chunk) => { const m = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
  });
});
after(async () => { if (server) { server.kill(); await new Promise((r) => server.exitCode !== null ? r() : server.once('exit', r)); } if (folder) await rm(folder, { recursive: true, force: true }); });
async function post(path, payload) { return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); }

test('malformed input and cross-origin writes are rejected without crashing', async () => {
  assert.equal((await fetch(base + '/api/calls', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await post('/api/calls', { consent: 'yes' })).status, 400);
  assert.equal((await fetch(base + '/api/reset', { method: 'POST', headers: { origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/health')).status, 200);
});
test('transcript analysis works without changing the stored call count', async () => {
  const before = await fetch(base + '/api/state').then((r) => r.json());
  const r = await post('/api/analysis', { transcript: 'Caller: Send money immediately to test@ybl.', useAI: true });
  assert.equal(r.status, 200); const a = await r.json(); assert.equal(a.ranking.mode, 'local-rules');
  const after = await fetch(base + '/api/state').then((r) => r.json());
  assert.equal(before.calls.length, after.calls.length);
});
test('complete call lifecycle supports analysis, closing and erasure', async () => {
  const started = await post('/api/calls', { consent: true, callerNumber: '9000000001' }).then((r) => r.json());
  const id = started.call.id;
  assert.equal((await post(`/api/calls/${id}/turn`, { text: {} })).status, 400);
  assert.equal((await post('/api/reset', {})).status, 409);
  assert.equal((await post(`/api/calls/${id}/turn`, { text: 'Your SBI KYC is expired, account blocked. Send money to test@ybl.' })).status, 200);
  const analysis = await fetch(base + `/api/calls/${id}/analysis`).then((r) => r.json());
  assert.ok(analysis.identifiers.some((i) => i.value === 'test@ybl'));
  assert.equal((await post(`/api/calls/${id}/end`, {})).status, 200);
  assert.equal((await post(`/api/calls/${id}/turn`, { text: 'hello' })).status, 409);
  assert.equal((await post(`/api/calls/${id}/not-scam`, {})).status, 200);
  assert.equal((await post('/api/analysis', { callId: id })).status, 410);
});
