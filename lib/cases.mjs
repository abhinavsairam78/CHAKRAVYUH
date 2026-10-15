// Case workflow for each ring's complaint packet, the golden-hour clock, and an audit log.

export const CASE_STAGES = [
  { id: 'DRAFT', label: 'Dossier ready', hint: 'Generated automatically at hang-up' },
  { id: 'REVIEWED', label: 'Reviewed', hint: 'Officer checked identifiers and transcript' },
  { id: 'FILED', label: 'Filed on NCRP / 1930', hint: 'Acknowledgement number recorded' },
  { id: 'FREEZE_SENT', label: 'Freeze requests sent', hint: 'Letters sent to bank nodal officers' },
  { id: 'FROZEN', label: 'Accounts frozen', hint: 'Bank confirmed debit freeze' },
  { id: 'CLOSED', label: 'Closed', hint: 'No further action' }
];

export const GOLDEN_HOUR_MS = 60 * 60 * 1000;

function ensure(store) {
  store.data.cases = store.data.cases || {};
  store.data.audit = store.data.audit || [];
  store.data.activity = store.data.activity || [];
  return store.data;
}

// A ring keeps its case even when it absorbs another ring: the case follows the calls.
export function caseFor(store, ring) {
  const data = ensure(store);
  let c = data.cases[ring.id];
  if (!c) {
    const prior = Object.values(data.cases).filter((x) => x.callIds.some((id) => ring.callIds.includes(id)));
    const rank = (x) => CASE_STAGES.findIndex((s) => s.id === x.status);
    const best = prior.sort((a, b) => rank(b) - rank(a))[0];
    c = {
      ringId: ring.id,
      status: best?.status || 'DRAFT',
      ncrpAck: best?.ncrpAck || null,
      history: best ? [...best.history] : [{ status: 'DRAFT', at: ring.lastSeen, note: 'Dossier generated at hang-up' }],
      readyAt: ring.lastSeen,
      callIds: []
    };
    for (const p of prior) delete data.cases[p.ringId];
    data.cases[ring.id] = c;
  }
  if (ring.lastSeen > (c.readyAt || 0) && c.callIds.length !== ring.callIds.length) {
    // A new call joined the ring: the packet was regenerated, and the golden hour restarts.
    c.readyAt = ring.lastSeen;
    c.history.push({ status: c.status, at: ring.lastSeen, note: `Packet updated: ring now has ${ring.callIds.length} calls` });
  }
  c.callIds = ring.callIds;
  return c;
}

export function caseView(store, ring, now = Date.now()) {
  const c = caseFor(store, ring);
  const deadline = c.readyAt + GOLDEN_HOUR_MS;
  const acted = ['FREEZE_SENT', 'FROZEN', 'CLOSED'].includes(c.status);
  const actedAt = acted ? c.history.find((h) => ['FREEZE_SENT', 'FROZEN', 'CLOSED'].includes(h.status))?.at : null;
  return {
    ...c,
    stageIndex: CASE_STAGES.findIndex((s) => s.id === c.status),
    goldenHour: { deadline, remainingMs: deadline - now, met: acted ? actedAt <= deadline : null, actedAt }
  };
}

export function advanceCase(store, ring, { status, ncrpAck, note, actor = 'Demo officer' }) {
  const c = caseFor(store, ring);
  if (!CASE_STAGES.some((s) => s.id === status)) throw Object.assign(new Error('Unknown status'), { status: 400 });
  const currentIndex = CASE_STAGES.findIndex((s) => s.id === c.status);
  const nextIndex = CASE_STAGES.findIndex((s) => s.id === status);
  if (nextIndex !== currentIndex + 1) throw Object.assign(new Error('Complete the current review step before advancing the case.'), { status: 409 });
  if (status === 'FILED' && !(ncrpAck || c.ncrpAck)) throw Object.assign(new Error('NCRP acknowledgement number required'), { status: 400 });
  c.status = status;
  if (ncrpAck) c.ncrpAck = ncrpAck;
  c.history.push({ status, at: Date.now(), note: note || CASE_STAGES.find((s) => s.id === status).label, actor });
  audit(store, actor, `Case ${ring.id} → ${CASE_STAGES.find((s) => s.id === status).label}${ncrpAck ? ` (ack ${ncrpAck})` : ''}`);
  return c;
}

export function audit(store, actor, action) {
  const data = ensure(store);
  data.audit.unshift({ at: Date.now(), actor, action });
  data.audit.length = Math.min(data.audit.length, 400);
}

export function activity(store, type, text, ref) {
  const data = ensure(store);
  data.activity.unshift({ at: Date.now(), type, text, ref });
  data.activity.length = Math.min(data.activity.length, 200);
}

// Older synthetic rings arrive with realistic case progress, so the board is not all "Draft".
export function seedCases(store, graph) {
  const plan = [
    ['FROZEN', '31410240011873'], ['FROZEN', '31410240012004'], ['FREEZE_SENT', '31410240012690'], ['CLOSED', '31410240012751'],
    ['FROZEN', '31410240013021'], ['FREEZE_SENT', '31410240013388']
  ];
  const rings = graph.rings.filter((r) => (r.upis.length || r.accounts.length) && r.callIds.every((id) => !id.startsWith('C-1'))).sort((a, b) => a.lastSeen - b.lastSeen);
  // Every historical case was acted on in time; only today's demo calls run a live golden-hour clock.
  rings.forEach((ring, i) => {
    const [status, ack] = plan[i % plan.length];
    const c = caseFor(store, ring);
    const order = ['REVIEWED', 'FILED', 'FREEZE_SENT', 'FROZEN', 'CLOSED'];
    const steps = order.slice(0, order.indexOf(status) + 1);
    steps.forEach((s, k) => c.history.push({ status: s, at: ring.lastSeen + (k + 1) * 11 * 60000, note: CASE_STAGES.find((x) => x.id === s).label, actor: 'Cyber Cell (synthetic)' }));
    c.status = status;
    c.ncrpAck = steps.includes('FILED') ? ack : null;
  });
}
