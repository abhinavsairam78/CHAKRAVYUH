import { test } from 'node:test';
import assert from 'node:assert/strict';

const utterances = [];
globalThis.window = { speechSynthesis: { getVoices: () => [], addEventListener() {}, speak(u) { utterances.push(u); }, cancel() {} } };
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const { speak, stopSpeaking, onSpeechActivity, isSpeechPlaying } = await import('../public/js/voice.js');

test('speech gate covers queued audio, completion, cancellation, and late completion events', async () => {
  const states = [], unsubscribe = onSpeechActivity((value) => states.push(value));
  const first = speak('Hello caller');
  assert.equal(isSpeechPlaying(), true);
  assert.equal(states.at(-1), true, 'block microphone before the voice starts');
  utterances.at(-1).onend(); await first;
  assert.equal(isSpeechPlaying(), false); assert.equal(states.at(-1), false);
  const second = speak('Please repeat'); const old = utterances.at(-1);
  const third = speak('What is the account number?');
  await second;
  old.onend();
  assert.equal(isSpeechPlaying(), true, 'an old voice cannot unblock the current voice');
  stopSpeaking(); await third;
  assert.equal(isSpeechPlaying(), false); assert.equal(states.at(-1), false);
  unsubscribe();
});
