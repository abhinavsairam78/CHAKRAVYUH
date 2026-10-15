import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.VERCEL = '1';
const { default: hosted } = await import('../api/hosted.mjs');
async function request(path, body, state) {
  const req = { method: 'POST', headers: { host: 'demo.vercel.app', origin: 'https://demo.vercel.app' }, body: { path, method: body === undefined ? 'GET' : 'POST', body, state } };
  let status, output;
  const res = { statusCode: 200, setHeader() {}, end(text) { status = this.statusCode; output = JSON.parse(text); } };
  await hosted(req, res);
  assert.equal(status, 200, JSON.stringify(output));
  return output;
}
test('hosted demo preserves calls across stateless requests and exports dossiers', async () => {
  let result = await request('/api/state');
  const count = result.data.calls.length;
  result = await request('/api/calls', { consent: true, callerNumber: '9000000000' }, result.state);
  const id = result.data.call.id;
  result = await request(`/api/calls/${id}/turn`, { text: 'Your SBI KYC is blocked. Send 49 rupees to test@ybl.' }, result.state);
  assert.equal(result.status, 200);
  result = await request(`/api/calls/${id}/end`, {}, result.state);
  assert.equal(result.status, 200);
  result = await request(`/dossier/${id}`, undefined, result.state);
  assert.equal(result.status, 200); assert.match(result.data, /test@ybl/);
  result = await request('/api/state', undefined, result.state);
  assert.equal(result.data.calls.length, count + 1);
  const clean = await request('/api/state');
  assert.equal(clean.data.calls.length, count, 'another browser has isolated history');
});
test('hosted analysis and exports work without a local model server', async () => {
  let result = await request('/api/analysis', { transcript: 'Caller: Tell me your OTP and install AnyDesk.', useAI: true });
  assert.equal(result.status, 200); assert.equal(result.data.ranking.mode, 'local-rules');
  result = await request('/api/v1/mules.csv', undefined, result.state);
  assert.equal(result.status, 200); assert.match(result.headers['content-type'], /text\/csv/);
  result = await request('/api/settings', undefined, result.state);
  assert.equal(result.data.local.hosted, true);
});
