// Intelligence views over the ring graph: the mule-account feed for bank fraud teams, identifier
// lookups, live "known mule" hits during a call, and dashboard analytics.

import { PSP } from './dossier.mjs';
import { checkIfsc } from './ifsc.mjs';

const DAY = 86400000;

export function muleFeed(graph, calls, caseByRing) {
  const byId = new Map(calls.map((c) => [c.id, c]));
  const rings = new Map(graph.rings.map((r) => [r.id, r]));
  return graph.nodes
    .filter((n) => n.type === 'upi' || n.type === 'account')
    .map((n) => {
      const cs = n.callIds.map((id) => byId.get(id)).filter(Boolean);
      const ring = rings.get(n.ring);
      const numbers = new Set(cs.map((c) => c.callerNumber).filter(Boolean));
      const handle = n.type === 'upi' ? n.label.split('@')[1] : null;
      const institution = n.type === 'upi' ? PSP[handle] || `@${handle}` : n.bank || (n.ifsc ? checkIfsc(n.ifsc).bank : 'Unknown bank');
      const status = caseByRing.get(n.ring)?.status;
      const risk = Math.min(99, Math.round(30 + 18 * Math.log2(cs.length) + 5 * Math.min(numbers.size - 1, 4) + (ring?.linked ? 8 : 0) + (n.ifsc ? 4 : 0)));
      return {
        type: n.type,
        value: n.label,
        ifsc: n.ifsc || null,
        institution,
        calls: cs.length,
        callIds: n.callIds,
        numbers: numbers.size,
        ringId: n.ring,
        ringCalls: ring?.callIds.length || 1,
        scamTypes: [...new Set(cs.map((c) => c.scamLabel).filter(Boolean))],
        firstSeen: Math.min(...cs.map((c) => c.startedAt)),
        lastSeen: Math.max(...cs.map((c) => c.endedAt)),
        risk,
        status: status === 'FROZEN' ? 'Frozen' : status === 'FREEZE_SENT' ? 'Freeze requested' : 'Watch'
      };
    })
    .sort((a, b) => b.risk - a.risk || b.lastSeen - a.lastSeen);
}

export function toCsv(rows) {
  const cols = ['type', 'value', 'ifsc', 'institution', 'risk', 'status', 'calls', 'numbers', 'ringId', 'scamTypes', 'firstSeen', 'lastSeen'];
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join('; ') : typeof v === 'number' && v > 1e12 ? new Date(v).toISOString() : String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

// Accepts a UPI ID, account number, phone number or IFSC, as typed by an analyst.
export function lookup(graph, calls, q) {
  const raw = String(q || '').trim().toLowerCase();
  if (!raw) return { query: q, hits: [] };
  const digits = raw.replace(/\D/g, '');
  const candidates = new Set([raw]);
  if (/^\+?\d[\d\s-]{8,}$/.test(raw)) {
    candidates.add(digits);
    if (digits.length >= 10) candidates.add(`+91${digits.slice(-10)}`);
  }
  const byId = new Map(calls.map((c) => [c.id, c]));
  const hits = graph.nodes
    .filter((n) => n.type !== 'call' && (candidates.has(String(n.label).toLowerCase()) || (n.ifsc && n.ifsc.toLowerCase() === raw)))
    .map((n) => ({
      type: n.type,
      value: n.label,
      ringId: n.ring,
      calls: n.callIds.map((id) => byId.get(id)).filter(Boolean).map((c) => ({ id: c.id, at: c.startedAt, scamLabel: c.scamLabel, callerNumber: c.callerNumber }))
    }));
  return { query: q, hits };
}

// During a live call: has any identifier the caller just gave been seen in an earlier call?
export function liveHits(graph, items) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const rings = new Map(graph.rings.map((r) => [r.id, r]));
  return items
    .map((x) => nodes.get(`${x.type}:${x.value}`))
    .filter(Boolean)
    .map((n) => ({ type: n.type, value: n.label, ringId: n.ring, callIds: n.callIds, ringCalls: rings.get(n.ring)?.callIds.length || 1 }));
}

export function analytics(calls, now = Date.now()) {
  const done = calls.filter((c) => c.endedAt && !c.purged);
  const days = Array.from({ length: 14 }, (_, i) => {
    const start = now - (now % DAY) - (13 - i) * DAY;
    return { day: new Date(start).toISOString().slice(0, 10), start, byType: {} };
  });
  for (const c of done) {
    const d = days.find((x) => c.startedAt >= x.start && c.startedAt < x.start + DAY);
    if (d) d.byType[c.scamLabel || 'Unclassified'] = (d.byType[c.scamLabel || 'Unclassified'] || 0) + 1;
  }
  const count = (f) => done.reduce((m, c) => { for (const k of [].concat(f(c))) if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    perDay: days.map(({ day, byType }) => ({ day, byType })),
    byType: count((c) => c.scamLabel || 'Unclassified'),
    byChannel: count((c) => c.channelLabel || c.channel),
    muleBanks: count((c) => c.identifiers.filter((x) => x.type === 'ifsc' && x.meta?.bank).map((x) => x.meta.bank).concat(c.identifiers.filter((x) => x.type === 'upi').map((x) => PSP[x.meta?.handle] || `@${x.meta?.handle}`))),
    agencies: count((c) => c.memory?.agencies || []),
    idsPerCall: done.length ? done.reduce((s, c) => s + c.identifiers.filter((x) => ['upi', 'account', 'ifsc', 'phone', 'url'].includes(x.type)).length, 0) / done.length : 0,
    avgMinutes: done.length ? done.reduce((s, c) => s + (c.endedAt - c.startedAt), 0) / done.length / 60000 : 0
  };
}
