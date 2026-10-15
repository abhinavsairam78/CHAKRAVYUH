// Fraud-ring graph. Every call becomes a node linked to what it revealed: caller numbers, UPI IDs,
// bank accounts, links, a voice cluster, a script cluster and any honeytoken it quoted back.
// Calls that share any of those nodes fall into the same ring (connected component).

import { normalizeSpoken, detectAgencies } from './extract.mjs';

export const VOICE_THRESHOLD = { synthetic: 0.85, 'mfcc-lite': Number(process.env.CHAKRAVYUH_VOICE_T || 0.82) };
export const SCRIPT_THRESHOLD = 0.12;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function voiceSimilarity(a, b) {
  if (!a || !b || a.kind !== b.kind) return 0;
  if (a.kind === 'synthetic') return cosine(a.vector, b.vector);
  // Lite voiceprint from the browser: MFCC statistics plus median pitch.
  const timbre = Math.max(0, cosine(a.vector, b.vector));
  const pitch = a.f0 && b.f0 ? Math.exp(-(((Math.log(a.f0) - Math.log(b.f0)) / 0.15) ** 2)) : 0.5;
  return 0.5 * timbre + 0.5 * pitch;
}

export function scriptShingles(texts) {
  const words = normalizeSpoken(texts.join(' '))
    .replace(/[^a-zऀ-ॿ\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w));
  const set = new Set();
  for (let i = 0; i + 2 < words.length; i++) set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return set;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Hard links put calls in the same ring. A shared script only marks a campaign: many gangs buy the
// same script, so it is shown as context but never merges rings on its own.
const LINKABLE = new Set(['phone', 'upi', 'account', 'url', 'voice', 'honeytoken']);
const TYPE_LABEL = { phone: 'Phone', upi: 'UPI ID', account: 'Bank account', url: 'Link', voice: 'Voiceprint', script: 'Script pattern', honeytoken: 'Honeytoken' };

export function buildGraph(calls) {
  const ordered = [...calls].filter((c) => c.endedAt && !c.purged).sort((a, b) => a.startedAt - b.startedAt);
  const nodes = new Map();
  const edges = [];
  const addNode = (id, data) => {
    if (!nodes.has(id)) nodes.set(id, { id, calls: new Set(), ...data });
    return nodes.get(id);
  };
  const link = (call, nodeId, data, edge) => {
    const node = addNode(nodeId, data);
    node.calls.add(call.id);
    edges.push({ source: `call:${call.id}`, target: nodeId, ...edge });
  };

  const voiceClusters = [];
  const scriptClusters = [];
  const honeytokens = [];
  const voiceByCall = {};
  const nameCount = new Map();
  for (const c of ordered) if (c.honeytoken) { const k = c.honeytoken.fullName.toLowerCase(); nameCount.set(k, (nameCount.get(k) || 0) + 1); }

  for (const call of ordered) {
    addNode(`call:${call.id}`, {
      type: 'call', label: call.id, sub: call.scamLabel || 'Unclassified', callId: call.id, channel: call.channel,
      startedAt: call.startedAt
    }).calls.add(call.id);

    if (call.callerNumber) link(call, `phone:${call.callerNumber}`, { type: 'phone', label: call.callerNumber, sub: 'Caller ID' }, { type: 'called-from', label: 'called from' });

    const accountIfsc = call.identifiers.find((x) => x.type === 'ifsc');
    for (const id of call.identifiers) {
      if (id.type === 'upi') link(call, `upi:${id.value}`, { type: 'upi', label: id.value, sub: 'UPI ID' }, { type: 'pay-to', label: 'asked payment to' });
      if (id.type === 'account') {
        link(call, `account:${id.value}`, { type: 'account', label: id.value, sub: accountIfsc ? `${accountIfsc.value} · ${accountIfsc.meta?.bank || ''}` : 'Bank account', ifsc: accountIfsc?.value, bank: accountIfsc?.meta?.bank }, { type: 'pay-to', label: 'asked payment to' });
      }
      if (id.type === 'phone' && id.value !== call.callerNumber) link(call, `phone:${id.value}`, { type: 'phone', label: id.value, sub: 'Callback number' }, { type: 'mentioned', label: 'gave number' });
      if (id.type === 'url') link(call, `url:${id.value}`, { type: 'url', label: id.value, sub: 'Link (not opened)' }, { type: 'mentioned', label: 'sent link' });
    }

    if (call.voiceprint?.vector?.length) {
      let best = null;
      for (const cl of voiceClusters) {
        if (cl.kind !== call.voiceprint.kind) continue;
        const s = Math.max(...cl.members.map((m) => voiceSimilarity(m, call.voiceprint)));
        if (!best || s > best.score) best = { cl, score: s };
      }
      let cluster;
      if (best && best.score >= VOICE_THRESHOLD[call.voiceprint.kind]) {
        cluster = best.cl;
        cluster.members.push(call.voiceprint);
      } else {
        cluster = { id: `V-${voiceClusters.length + 1}`, kind: call.voiceprint.kind, members: [call.voiceprint] };
        voiceClusters.push(cluster);
      }
      const matched = best && cluster === best.cl;
      voiceByCall[call.id] = { cluster: cluster.id, score: matched ? best.score : null };
      link(call, `voice:${cluster.id}`, { type: 'voice', label: `Voice ${cluster.id}`, sub: call.voiceprint.kind === 'synthetic' ? 'Voiceprint (rehearsal/seed)' : 'Voiceprint (lite MFCC + pitch)' }, { type: 'spoken-by', label: matched ? `voice match ${best.score.toFixed(2)}` : 'voiceprint', weight: matched ? best.score : 1 });
    }

    const shingles = scriptShingles(call.turns.filter((t) => t.speaker === 'scammer').map((t) => t.text));
    let bestScript = null;
    for (const cl of scriptClusters) {
      const s = Math.max(...cl.members.map((m) => jaccard(m, shingles)));
      if (!bestScript || s > bestScript.score) bestScript = { cl, score: s };
    }
    if (bestScript && bestScript.score >= SCRIPT_THRESHOLD) {
      bestScript.cl.members.push(shingles);
      bestScript.cl.calls.push(call);
      if (bestScript.cl.calls.length === 2) {
        const first = bestScript.cl.calls[0];
        link(first, `script:${bestScript.cl.id}`, { type: 'script', label: `Script ${bestScript.cl.id}`, sub: 'Shared script phrasing' }, { type: 'script', label: 'same script' });
      }
      link(call, `script:${bestScript.cl.id}`, { type: 'script', label: `Script ${bestScript.cl.id}`, sub: 'Shared script phrasing' }, { type: 'script', label: `script overlap ${bestScript.score.toFixed(2)}`, weight: bestScript.score });
    } else {
      scriptClusters.push({ id: `S-${scriptClusters.length + 1}`, members: [shingles], calls: [call] });
    }

    // Honeytokens: did this call's scammer quote a decoy identity planted in an earlier call?
    const scammerText = normalizeSpoken(call.turns.filter((t) => t.speaker === 'scammer').map((t) => t.text).join(' '));
    for (const ht of honeytokens) {
      if (ht.callId === call.id) continue;
      // A decoy name shared by two personas proves nothing; the door number is unique per call.
      const usable = ht.tokens.filter((tok) => !nameCount.get(tok) || nameCount.get(tok) === 1);
      if (usable.some((tok) => scammerText.includes(tok))) {
        const id = `honeytoken:${ht.callId}`;
        const owner = ordered.find((c) => c.id === ht.callId);
        if (!nodes.has(id)) link(owner, id, { type: 'honeytoken', label: ht.fullName, sub: `Decoy identity planted in ${ht.callId}` }, { type: 'planted', label: 'planted decoy identity' });
        link(call, id, { type: 'honeytoken', label: ht.fullName }, { type: 'quoted', label: 'quoted decoy identity back' });
      }
    }
    if (call.honeytoken) honeytokens.push({ callId: call.id, fullName: call.honeytoken.fullName, tokens: call.honeytoken.tokens });
  }

  // Rings = connected components over shared identifier nodes.
  const parent = new Map(ordered.map((c) => [c.id, c.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const node of nodes.values()) {
    if (!LINKABLE.has(node.type) || node.calls.size < 2) continue;
    const [first, ...rest] = [...node.calls];
    for (const other of rest) parent.set(find(other), find(first));
  }
  const groups = new Map();
  for (const call of ordered) {
    const root = find(call.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(call);
  }

  const rings = [];
  for (const members of groups.values()) {
    const callIds = new Set(members.map((c) => c.id));
    const shared = [...nodes.values()]
      .filter((n) => LINKABLE.has(n.type) && n.calls.size >= 2 && [...n.calls].some((c) => callIds.has(c)))
      .map((n) => ({ nodeId: n.id, type: n.type, typeLabel: TYPE_LABEL[n.type], label: n.label, sub: n.sub, callIds: [...n.calls] }));
    const linked = members.length > 1;
    const ring = {
      // Named after its earliest call, so the id stays put as new calls join it.
      id: `R-${members[0].id.replace(/^C-/, '')}`,
      linked,
      callIds: members.map((c) => c.id),
      evidence: shared,
      campaigns: [...new Set([...nodes.values()].filter((n) => n.type === 'script' && [...n.calls].some((c) => callIds.has(c))).map((n) => n.label))],
      scamTypes: [...new Set(members.map((c) => c.scamLabel).filter(Boolean))],
      callerNumbers: [...new Set(members.map((c) => c.callerNumber).filter(Boolean))],
      upis: [...new Set(members.flatMap((c) => c.identifiers.filter((x) => x.type === 'upi').map((x) => x.value)))],
      accounts: [...new Set(members.flatMap((c) => c.identifiers.filter((x) => x.type === 'account').map((x) => x.value)))],
      scammerSeconds: members.reduce((s, c) => s + (c.endedAt - c.startedAt) / 1000, 0),
      firstSeen: Math.min(...members.map((c) => c.startedAt)),
      lastSeen: Math.max(...members.map((c) => c.endedAt)),
      demanded: members.reduce((s, c) => s + Math.max(0, ...c.identifiers.filter((x) => x.type === 'amount').map((x) => Number(x.value))), 0),
      agencies: [...new Set(members.flatMap((c) => detectAgencies(c.turns.filter((t) => t.speaker === 'scammer').map((t) => t.text).join(' '))))],
      banks: [...new Set(members.flatMap((c) => c.identifiers.filter((x) => x.type === 'ifsc' && x.meta?.bank).map((x) => x.meta.bank)))],
      channels: [...new Set(members.map((c) => c.channel))]
    };
    const mules = ring.upis.length + ring.accounts.length;
    ring.risk = Math.min(99, Math.round(25 + 15 * Math.log2(members.length) + 4 * Math.min(ring.callerNumbers.length - 1, 5) + 3 * Math.min(mules, 5) + (shared.some((e) => e.type === 'voice') ? 5 : 0) + (shared.some((e) => e.type === 'honeytoken') ? 5 : 0)));
    rings.push(ring);
    for (const c of members) {
      const n = nodes.get(`call:${c.id}`);
      n.ring = ring.id;
    }
  }
  for (const node of nodes.values()) {
    if (node.type !== 'call') node.ring = nodes.get(`call:${[...node.calls][0]}`)?.ring;
  }

  return {
    nodes: [...nodes.values()].map(({ calls: cs, ...n }) => ({ ...n, callIds: [...cs] })),
    edges,
    rings: rings.sort((a, b) => b.callIds.length - a.callIds.length || a.firstSeen - b.firstSeen),
    voiceByCall
  };
}
