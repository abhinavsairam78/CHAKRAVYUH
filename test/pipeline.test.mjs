import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIdentifiers } from '../lib/extract.mjs';
import { classifyScam } from '../lib/classifier.mjs';
import { createStore, startCall, scammerTurn, decoyReply, endCall } from '../lib/calls.mjs';
import { seedHistory, REHEARSAL, syntheticVoice } from '../lib/seed.mjs';
import { buildGraph } from '../lib/graph.mjs';
import { renderDossier } from '../lib/dossier.mjs';

const values = (text, type) => extractIdentifiers(text).identifiers.filter((i) => i.type === type).map((i) => i.value);

test('spelled-out UPI IDs are reassembled', () => {
  assert.deepEqual(values('Send to V E R I F Y dot R B I at the rate okaxis', 'upi'), ['verify.rbi@okaxis']);
  assert.deepEqual(values('pay to raju at ybl please', 'upi'), ['raju@ybl']);
  assert.deepEqual(values('mail me at ravi.k@gmail.com', 'upi'), []);
});

test('accounts, IFSC and phones are told apart', () => {
  const r = extractIdentifiers('Account number 5 0 1 0 0 4 4 7 2 1 9 3 8 6, IFSC code H D F C 0 0 0 1 2 3 4. Call me on 98401 23456.');
  const got = Object.fromEntries(r.identifiers.map((i) => [i.type, i.value]));
  assert.equal(got.account, '50100447219386');
  assert.equal(got.ifsc, 'HDFC0001234');
  assert.equal(got.phone, '+919840123456');
  assert.equal(r.identifiers.find((i) => i.type === 'ifsc').meta.bank, 'HDFC Bank');
});

test('Hindi digits in a run become an account number', () => {
  assert.deepEqual(values('खाता नंबर पांच शून्य एक शून्य शून्य चार चार सात दो एक नौ तीन आठ छह', 'account'), ['50100447219386']);
});

test('amounts in lakh and thousand', () => {
  assert.deepEqual(values('Transfer 1 lakh 80 thousand rupees now', 'amount'), ['180000']);
});

test('classifier labels common scripts', () => {
  assert.equal(classifyScam(['This is CBI, you are under digital arrest, a warrant is issued']).type, 'digital_arrest');
  assert.equal(classifyScam(['Your SBI KYC has expired, account will be blocked']).type, 'kyc');
  assert.equal(classifyScam(['hello']).type, 'unknown');
});

test('decoy never reads out an OTP or claims payment', () => {
  const store = createStore(null);
  const call = startCall(store, { callerNumber: '9000000000' });
  scammerTurn(call, 'Your SBI KYC has expired and the account will be blocked', 5);
  const { reply } = scammerTurn(call, 'Tell me the OTP you received now, 6 digit code', 12);
  assert.match(reply, /OTP|message/i);
  assert.doesNotMatch(reply, /\b\d{6}\b/);
});

test('two rehearsal calls from different numbers link into one ring', () => {
  const store = createStore(null);
  seedHistory(store, Date.now() - 3600e3);
  const ids = [];
  for (const script of REHEARSAL) {
    const call = startCall(store, { callerNumber: script.callerNumber, channel: 'rehearsal' });
    let t = 3;
    for (const line of script.lines) {
      const { reply } = scammerTurn(call, line, (t += 8));
      decoyReply(call, reply, (t += 2));
    }
    endCall(call, { voiceprint: syntheticVoice('rehearsal-A', call.id), endedAt: call.startedAt + t * 1000 });
    ids.push(call.id);
  }
  const graph = buildGraph(store.data.calls);
  const ring = graph.rings.find((r) => r.callIds.includes(ids[0]));
  assert.ok(ring.callIds.includes(ids[1]), 'calls share a ring');
  const kinds = ring.evidence.map((e) => e.type).sort();
  assert.deepEqual(kinds, ['account', 'voice']);
  assert.equal(ring.callerNumbers.length, 2);
  // The rehearsal ring stays separate from the synthetic history.
  assert.ok(ring.callIds.every((id) => ids.includes(id)));
  const html = renderDossier(ring, store.data.calls);
  assert.match(html, /50100447219386/);
  assert.match(html, /HDFC Bank/);
  assert.match(html, /verify\.rbi@okaxis/);
});

test('honeytoken quoted back links two calls', () => {
  const store = createStore(null);
  seedHistory(store);
  const graph = buildGraph(store.data.calls);
  const ring = graph.rings.find((r) => r.callIds.includes('C-0005'));
  assert.ok(ring.callIds.includes('C-0004'));
  assert.ok(ring.evidence.some((e) => e.type === 'honeytoken'));
});
