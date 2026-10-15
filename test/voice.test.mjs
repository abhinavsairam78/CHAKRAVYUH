import { test } from 'node:test';
import assert from 'node:assert/strict';

const utterances = [];
let available = [{ name: 'Microsoft Neerja Natural', lang: 'en-IN', voiceURI: 'neerja' }], voicesChanged;
globalThis.window = { speechSynthesis: { getVoices: () => available, addEventListener(name, callback) { voicesChanged = callback; }, speak(u) { utterances.push(u); }, cancel() {} } };
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const { speak, stopSpeaking, onSpeechActivity, isSpeechPlaying, createVoiceProfile, speakable } = await import('../public/js/voice.js');

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
test('one call retains its voice, rate and pitch after browser voices change', async () => {
  const profile = await createVoiceProfile({ lang: 'en', gender: 'female', rate: 0.96 });
  const originalVoice = profile.voice;
  const first = speak('Hello, who is speaking?', { profile });
  const a = utterances.at(-1); a.onend(); await first;
  available = [{ name: 'New Neural Female', lang: 'en-IN', voiceURI: 'replacement' }]; voicesChanged();
  const next = speak('Please tell me the account number.', { profile });
  const b = utterances.at(-1); b.onend(); await next;
  assert.equal(a.voice, originalVoice); assert.equal(b.voice, originalVoice);
  assert.equal(a.rate, 0.96); assert.equal(b.rate, 0.96); assert.equal(a.pitch, b.pitch);
  assert.ok(Object.isFrozen(profile));
});
test('currency is spoken as an amount while account digits remain explicit', () => {
  assert.equal(speakable('Send 50000 rupees.'), 'Send fifty thousand rupees.');
  assert.equal(speakable('It is ₹1,50,000.'), 'It is one lakh fifty thousand rupees.');
  assert.equal(speakable('I am 68 years old.'), 'I am 68 years old.');
  assert.equal(speakable('Account 50100447.'), 'Account 5 0 1 0 0 4 4 7.');
});
