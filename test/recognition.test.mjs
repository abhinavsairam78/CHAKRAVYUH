import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecognitionGate } from '../public/js/recognition.js';

function setup() {
  const instances = [], timers = new Map(), heard = [], states = [], errors = [];
  let next = 0;
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.started = true; }
    abort() { this.aborted = true; this.onend?.(); }
  }
  const gate = createRecognitionGate({ Recognition, lang: 'en-IN', onResult: (r) => heard.push(r), onState: (s) => states.push(s), onError: (e) => errors.push(e.error), setTimer: (fn, ms) => { timers.set(++next, { fn, ms }); return next; }, clearTimer: (id) => timers.delete(id) });
  const result = (r, text, final = true) => { const item = [{ transcript: text }]; item.isFinal = final; r.onresult({ resultIndex: 0, results: [item] }); };
  const tick = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((t) => t.fn()); };
  return { gate, instances, timers, heard, states, errors, result, tick };
}
test('playback aborts recognition and discards delayed speaker transcripts', () => {
  const s = setup(); s.gate.start(); const old = s.instances[0];
  s.result(old, 'Actual caller speech'); assert.equal(s.heard.length, 1);
  s.gate.hold(); assert.equal(old.aborted, true);
  s.result(old, 'Decoy audio from speakers'); assert.equal(s.heard.length, 1);
  assert.equal(s.timers.size, 0, 'abort must not restart recognition');
  s.gate.release(); assert.equal(s.instances.length, 1);
  assert.equal([...s.timers.values()][0].ms, 650);
  s.result(old, 'Lingering speaker echo'); assert.equal(s.heard.length, 1);
  s.tick(); assert.equal(s.instances.length, 2);
  s.result(old, 'Very late result'); assert.equal(s.heard.length, 1);
  s.result(s.instances[1], 'Next caller response'); assert.equal(s.heard.length, 2);
});
test('a second utterance cancels pending microphone resume', () => {
  const s = setup(); s.gate.start(); s.gate.hold(); s.gate.release();
  s.gate.hold(); s.tick(); assert.equal(s.instances.length, 1);
  s.gate.release(); s.tick(); assert.equal(s.instances.length, 2);
});
test('ending a call during the echo buffer prevents delayed microphone restart', () => {
  const s = setup(); s.gate.start(); s.gate.hold(); s.gate.release(); s.gate.stop(); s.tick();
  assert.equal(s.instances.length, 1); assert.equal(s.states.at(-1), 'off');
});
test('playback already in progress blocks initial recognition', () => {
  const s = setup(); s.gate.hold(); s.gate.start(); assert.equal(s.instances.length, 0);
  s.gate.release(); s.tick(); assert.equal(s.instances.length, 1);
});
test('permission denial stops restart attempts', () => {
  const s = setup(); s.gate.start(); s.instances[0].onerror({ error: 'not-allowed' }); s.tick();
  assert.equal(s.instances.length, 1); assert.deepEqual(s.errors, ['not-allowed']);
});
