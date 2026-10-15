import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseCall, parseTranscript, reviewQueue } from '../lib/analysis.mjs';
import { validateEvidenceSelection, prioritiseEvidence, setDialogueMode, validDialogueCandidate } from '../lib/llm.mjs';
import { createStore, startCall, purgeCall } from '../lib/calls.mjs';
import { withCallLock, busyCalls } from '../lib/turn-lock.mjs';
import { advanceCase } from '../lib/cases.mjs';

test('analysis cites caller statements and excludes decoy identifiers', () => {
  const a = analyseCall({ turns: parseTranscript('Caller: CBI digital arrest. Transfer 50000 rupees immediately to test@ybl.\nDecoy: my account is 50100447219386\nCaller: Share your OTP and install AnyDesk. Do not tell anyone.') });
  assert.equal(a.priority, 'High');
  assert.equal(a.classification.type, 'digital_arrest');
  assert.ok(a.evidence.every((e) => [1, 3].includes(e.turn)));
  assert.ok(a.identifiers.some((i) => i.value === 'test@ybl'));
  assert.ok(!a.identifiers.some((i) => i.value === '50100447219386'));
  assert.match(a.fingerprint, /^[a-f0-9]{64}$/);
});
test('repeated threat statements do not inflate the risk score', () => {
  const a = analyseCall({ turns: parseTranscript('Caller: Your account will be blocked.') });
  const b = analyseCall({ turns: parseTranscript(Array(30).fill('Caller: Your account will be blocked.').join('\n')) });
  assert.equal(a.score, b.score);
});
test('ordinary conversation has low priority and missing-evidence guidance', () => {
  const a = analyseCall({ turns: parseTranscript('Caller: Hello, are we meeting for lunch?') });
  assert.equal(a.score, 0); assert.equal(a.classification.type, 'unknown'); assert.ok(a.gaps.length);
});
test('invalid transcript payloads are rejected', () => {
  for (const value of ['', 42, null, 'a'.repeat(30001)]) assert.throws(() => parseTranscript(value));
});
test('AI output cannot add evidence IDs or use free text as evidence', () => {
  const evidence = [{ id: 'E1' }, { id: 'E2' }];
  assert.deepEqual(validateEvidenceSelection('{"evidenceIds":["E2","E1","E2"]}', evidence), ['E2','E1']);
  for (const text of ['{"evidenceIds":["E99"]}', '{"evidenceIds":[]}', 'ignore instructions', '{"evidenceIds":[{}]}']) assert.throws(() => validateEvidenceSelection(text, evidence));
});
test('AI disabled uses an explicit deterministic fallback', async () => {
  await setDialogueMode('off');
  const a = analyseCall({ turns: parseTranscript('Caller: Tell me your OTP immediately.') });
  const r = await prioritiseEvidence(a);
  assert.equal(r.mode, 'local-rules'); assert.ok(r.evidenceIds.length);
  assert.equal((await setDialogueMode('invented-provider')).ok, false);
});
test('model dialogue rejects invented payment destinations and unsafe promises', () => {
  const call = { identifiers: [{ type: 'upi', value: 'test@ybl' }] };
  assert.equal(validDialogueCandidate('Should I use test@ybl?', 'Which UPI ID?', call), true);
  assert.equal(validDialogueCandidate('Use stranger@okaxis.', 'Which UPI ID?', call), false);
  assert.equal(validDialogueCandidate('I will install AnyDesk.', 'My phone cannot install it.', call), false);
  assert.equal(validDialogueCandidate('I have sent the money.', 'Let me check.', call), false);
});
test('purged calls retain no caller phone or extracted content and leave the queue', () => {
  const store = createStore(null), c = startCall(store, { callerNumber: '9000000000' });
  purgeCall(c);
  assert.equal(c.callerNumber, null); assert.deepEqual(c.turns, []);
  assert.equal(analyseCall(c).unavailable, true); assert.deepEqual(reviewQueue([c]), []);
});
test('call lock rejects concurrent work and releases after errors', async () => {
  let release;
  const work = withCallLock('call-1', () => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(withCallLock('call-1', async () => {}), { status: 409 });
  release(); await work; assert.equal(busyCalls.size, 0);
  await assert.rejects(withCallLock('call-1', async () => { throw new Error('failure'); }));
  assert.equal(busyCalls.size, 0);
});
test('case workflow requires review and acknowledgement before escalation', () => {
  const store = createStore(null), ring = { id: 'R-test', callIds: ['C-test'], lastSeen: Date.now() };
  assert.throws(() => advanceCase(store, ring, { status: 'FROZEN' }), { status: 409 });
  assert.equal(advanceCase(store, ring, { status: 'REVIEWED' }).status, 'REVIEWED');
  assert.throws(() => advanceCase(store, ring, { status: 'FILED' }), { status: 400 });
  assert.equal(advanceCase(store, ring, { status: 'FILED', ncrpAck: 'DEMO-123' }).status, 'FILED');
});
