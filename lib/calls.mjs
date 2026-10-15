// Call lifecycle and the on-disk store (a single JSON file; Postgres/Neo4j in production).

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { decoyTurn, openingLine, PERSONAS, STAGES, makeHoneytoken } from './persona.mjs';

export const CHANNELS = {
  'citizen-merge': 'Citizen merged the call into the decoy number ("add call")',
  rehearsal: 'Scripted rehearsal (demo backup)',
  seed: 'Historical call (synthetic demo data)',
  'telco-divert': 'Telco-diverted flagged call'
};

export function createStore(file) {
  let data = { nextId: 1001, calls: [] };
  if (file && existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8'));
  return {
    data,
    save() {
      if (!file) return;
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, JSON.stringify(data, null, 1));
      renameSync(temporary, file);
    },
    reset(next) {
      data.nextId = 1001;
      data.calls = [];
      data.cases = {};
      data.audit = [];
      data.activity = [];
      next?.(this);
      this.save();
    }
  };
}

function defaultConsent(channel, at) {
  if (channel === 'telco-divert') return { basis: 'Flagged fraud call diverted by the operator under the anti-fraud framework', at };
  if (channel === 'seed') return { basis: 'Synthetic demo data', at };
  if (channel === 'rehearsal') return { basis: 'Scripted rehearsal, no real caller', at };
  return { basis: 'Citizen merged the call and confirmed recording consent', at };
}

// DPDP: a call the reviewer clears as "not a scam" keeps only a tombstone; content is erased.
export function purgeCall(call, reason = 'Cleared as not a scam') {
  Object.assign(call, { turns: [], identifiers: [], voiceprint: null, memory: {}, events: [], honeytoken: null, used: {} });
  call.callerNumber = null;
  call.flags = {};
  call.source = null;
  call.scamType = 'unknown';
  call.scamLabel = null;
  call.scamConfidence = 0;
  call.purged = { at: Date.now(), reason };
  call.endedAt = call.endedAt || Date.now();
  return call;
}

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length >= 10 ? `+91${digits.slice(-10)}` : `+${digits}`;
}

export function startCall(store, { callerNumber, lang = 'en', channel = 'citizen-merge', startedAt = Date.now(), id, source, consent, personaId } = {}) {
  const call = {
    id: id || `C-${store.data.nextId++}`,
    callerNumber: normalizePhone(callerNumber),
    lang: ['hi', 'ta'].includes(lang) ? lang : 'en',
    source: source || null,
    consent: consent || defaultConsent(channel, startedAt),
    channel,
    channelLabel: CHANNELS[channel] || channel,
    startedAt,
    endedAt: null,
    scamType: 'unknown',
    scamLabel: null,
    scamConfidence: 0,
    persona: { id: 'neutral', name: PERSONAS.neutral.name, role: PERSONAS.neutral.role, voice: PERSONAS.neutral.voice },
    honeytoken: null,
    stage: 'HOOK',
    maxStage: 'HOOK',
    turns: [],
    identifiers: [],
    voiceprint: null,
    events: []
  };
  if (['teacher', 'shopowner', 'student'].includes(personaId)) {
    const p = PERSONAS[personaId];
    call.persona = { id: p.id, name: p.name, age: p.age, role: p.role, voice: p.voice };
    call.personaLocked = true;
    call.honeytoken = makeHoneytoken(p, call.id);
  }
  call.turns.push({ speaker: 'decoy', text: openingLine(call), t: 0 });
  store.data.calls.push(call);
  return call;
}

export function scammerTurn(call, text, t = (Date.now() - call.startedAt) / 1000) {
  call.turns.push({ speaker: 'scammer', text, t: Number(t.toFixed(1)) });
  const result = decoyTurn(call, text, Number(t.toFixed(1)));
  call.flags = call.flags || {};
  for (const [k, v] of Object.entries(result.intents)) if (v) call.flags[k] = (call.flags[k] || 0) + 1;
  call.events.push({ t: Number(t.toFixed(1)), stage: call.stage, reason: result.reason });
  return result;
}

export function decoyReply(call, text, t) {
  call.turns.push({ speaker: 'decoy', text, t: Number(t.toFixed(1)) });
}

export function endCall(call, { voiceprint, endedAt = Date.now() } = {}) {
  call.endedAt = Math.max(endedAt, call.startedAt + 1000);
  if (voiceprint?.vector?.length) call.voiceprint = voiceprint;
  return call;
}

export function publicCall(call) {
  const { used, ...rest } = call;
  return { ...rest, stages: STAGES, durationSec: ((call.endedAt || Date.now()) - call.startedAt) / 1000 };
}
