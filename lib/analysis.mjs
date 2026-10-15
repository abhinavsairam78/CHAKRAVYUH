// Evidence-first triage. Every finding points to a caller turn; scores are heuristics.
import { classifyScam } from './classifier.mjs';
import { extractIdentifiers, detectIntents, detectAgencies } from './extract.mjs';
import { createHash } from 'node:crypto';

const SIGNALS = {
  otp: ['Credential request', 30, 'The caller mentions an OTP, PIN or password. Verify the context before escalation.'],
  remoteApp: ['Remote access request', 30, 'The caller mentions remote-control or screen-sharing software.'],
  threat: ['Threat or account restriction', 15, 'Threat language or a restriction is present in the transcript.'],
  urgency: ['Time pressure', 10, 'The caller uses urgency to shorten the decision window.'],
  secrecy: ['Isolation or secrecy', 15, 'The caller asks for secrecy or continued contact.'],
  payment: ['Payment discussion', 10, 'The caller discusses payment or a transfer.']
};

export function parseTranscript(text) {
  if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('Add a transcript to analyse.'), { status: 400 });
  if (text.length > 30000) throw Object.assign(new Error('Transcript limit is 30,000 characters.'), { status: 413 });
  return text.split(/\r?\n/).filter((s) => s.trim()).map((line, i) => {
    const m = line.match(/^\s*(caller|scammer|agent|decoy|victim|user)\s*:\s*(.*)$/i);
    return { speaker: m && /agent|decoy|victim|user/i.test(m[1]) ? 'decoy' : 'scammer', text: (m ? m[2] : line).trim(), t: i };
  });
}

export function analyseCall(call) {
  if (call.purged) return { unavailable: true, reason: 'This call has been erased.' };
  const turns = call.turns || [];
  const caller = turns.map((t, i) => ({ ...t, turn: i + 1 })).filter((t) => t.speaker === 'scammer');
  const classification = classifyScam(caller.map((t) => t.text));
  const evidence = [], identifiers = new Map(), agencies = new Set();
  for (const t of caller) {
    const intents = detectIntents(t.text);
    for (const [key, [label, weight, explanation]] of Object.entries(SIGNALS)) {
      if (intents[key]) evidence.push({ id: `E${evidence.length + 1}`, signal: key, label, weight, explanation, turn: t.turn, seconds: t.t, quote: t.text });
    }
    for (const id of extractIdentifiers(t.text).identifiers) {
      const key = `${id.type}:${id.value}`;
      if (!identifiers.has(key)) identifiers.set(key, { ...id, turns: [], quote: t.text });
      identifiers.get(key).turns.push(t.turn);
    }
    for (const agency of detectAgencies(t.text)) agencies.add(agency);
  }
  const signals = [...new Set(evidence.map((e) => e.signal))];
  const ids = [...identifiers.values()];
  const paymentIds = ids.filter((i) => ['upi', 'account'].includes(i.type));
  const score = Math.min(99, signals.reduce((sum, k) => sum + SIGNALS[k][1], 0) + (paymentIds.length ? 15 : 0));
  const priority = score >= 65 ? 'High' : score >= 30 ? 'Medium' : 'Low';
  const gaps = [];
  if (!caller.length) gaps.push('No caller statements are available.');
  if (!paymentIds.length) gaps.push('No payment destination captured.');
  if (classification.type === 'unknown') gaps.push('Insufficient cues to identify a scam pattern.');
  if (paymentIds.some((x) => x.confidence < .85)) gaps.push('One or more payment identifiers need manual confirmation.');
  if (!ids.some((x) => x.type === 'ifsc') && ids.some((x) => x.type === 'account')) gaps.push('Bank account captured without an IFSC code.');
  const actions = [
    'Review the cited caller statements and confirm whether the context is suspicious.',
    ...(paymentIds.length ? ['Read back the payment identifiers against the source transcript before sharing a dossier.'] : ['If appropriate, capture the requested payment destination without sending money.']),
    ...(signals.includes('otp') || signals.includes('remoteApp') ? ['Protect credentials and stop remote-access requests; do not share OTPs or install software.'] : []),
    'Check related calls and prepare a draft for human review.'
  ];
  return {
    callId: call.id || 'transcript-preview', classification, score, priority, evidence,
    identifiers: ids, agencies: [...agencies], gaps, actions,
    summary: caller.length ? `${classification.type === 'unknown' ? 'Unclassified conversation' : classification.label + ' cues detected'}. ${signals.length} distinct risk signals and ${paymentIds.length} payment destination${paymentIds.length === 1 ? '' : 's'} extracted from ${caller.length} caller statements.` : 'No caller evidence to analyse.',
    scoreExplanation: 'Heuristic review priority, not a probability or a finding of fraud. A cue can occur in a legitimate conversation.',
    fingerprint: createHash('sha256').update(JSON.stringify(turns)).digest('hex'),
    source: 'Local evidence engine', generatedAt: new Date().toISOString()
  };
}

export function reviewQueue(calls) {
  return calls.filter((c) => !c.purged && c.endedAt).map((c) => {
    const a = analyseCall(c);
    return { callId: c.id, score: a.score, priority: a.priority, label: a.classification.label, evidenceCount: a.evidence.length, gaps: a.gaps.length, startedAt: c.startedAt };
  }).sort((a, b) => b.score - a.score || b.startedAt - a.startedAt);
}
