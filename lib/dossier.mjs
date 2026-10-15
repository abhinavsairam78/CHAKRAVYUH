// Golden-hour packet: a pre-filled 1930 / NCRP complaint draft plus one freeze request per mule
// account or UPI handle, with transcript evidence. The portal has no filing API, so this is a draft
// the complainant or cyber cell files; nothing is submitted automatically.

import { createHash } from 'node:crypto';
import { detectAgencies } from './extract.mjs';

export const PSP = {
  ybl: 'PhonePe (Yes Bank)', ibl: 'PhonePe (ICICI Bank)', axl: 'PhonePe (Axis Bank)', okaxis: 'Google Pay (Axis Bank)',
  oksbi: 'Google Pay (SBI)', okhdfcbank: 'Google Pay (HDFC Bank)', okicici: 'Google Pay (ICICI Bank)', paytm: 'Paytm',
  ptyes: 'Paytm (Yes Bank)', ptsbi: 'Paytm (SBI)', pthdfc: 'Paytm (HDFC Bank)', ptaxis: 'Paytm (Axis Bank)', apl: 'Amazon Pay',
  upi: 'BHIM / bank UPI', sbi: 'SBI', icici: 'ICICI Bank', hdfcbank: 'HDFC Bank', kotak: 'Kotak Mahindra Bank', axisbank: 'Axis Bank'
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const when = (ms) => new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export function evidenceHash(calls) {
  const payload = JSON.stringify(calls.map((c) => ({ id: c.id, callerNumber: c.callerNumber, startedAt: c.startedAt, turns: c.turns })));
  return createHash('sha256').update(payload).digest('hex');
}

export function ringPacket(ring, calls) {
  const members = calls.filter((c) => ring.callIds.includes(c.id)).sort((a, b) => a.startedAt - b.startedAt);
  const ids = new Map();
  for (const call of members) {
    for (const id of call.identifiers) {
      if (!['upi', 'account', 'ifsc', 'phone', 'url'].includes(id.type)) continue;
      const key = `${id.type}:${id.value}`;
      const ifsc = id.type === 'account' && call.identifiers.find((x) => x.type === 'ifsc');
      if (!ids.has(key)) ids.set(key, { ...id, seenIn: [], firstCall: call.id, ...(ifsc ? { meta: { ifsc: ifsc.value, bank: ifsc.meta?.bank } } : {}) });
      ids.get(key).seenIn.push(call.id);
    }
    if (call.callerNumber) {
      const key = `caller:${call.callerNumber}`;
      if (!ids.has(key)) ids.set(key, { type: 'caller', value: call.callerNumber, seenIn: [], firstCall: call.id, firstAt: 0, confidence: 1 });
      ids.get(key).seenIn.push(call.id);
    }
  }
  const agencies = [...new Set(members.flatMap((c) => detectAgencies(c.turns.filter((t) => t.speaker === 'scammer').map((t) => t.text).join(' '))))];
  const amounts = [...new Set(members.flatMap((c) => c.identifiers.filter((x) => x.type === 'amount').map((x) => Number(x.value))))];
  const freeze = [];
  for (const call of members) {
    const ifsc = call.identifiers.find((x) => x.type === 'ifsc');
    for (const acct of call.identifiers.filter((x) => x.type === 'account')) {
      if (!freeze.some((f) => f.value === acct.value)) freeze.push({ kind: 'account', value: acct.value, ifsc: ifsc?.value, bank: ifsc?.meta?.bank || 'Bank (IFSC not stated)', call, at: acct.firstAt, quote: acct.quote });
    }
    for (const upi of call.identifiers.filter((x) => x.type === 'upi')) {
      if (!freeze.some((f) => f.value === upi.value)) freeze.push({ kind: 'upi', value: upi.value, bank: PSP[upi.meta?.handle] || `UPI handle @${upi.meta?.handle}`, call, at: upi.firstAt, quote: upi.quote });
    }
  }
  return { members, identifiers: [...ids.values()], agencies, amounts, freeze, hash: evidenceHash(members) };
}

export function renderDossier(ring, calls, generatedAt = Date.now(), kase = null) {
  const p = ringPacket(ring, calls);
  const typeName = { upi: 'UPI ID', account: 'Bank account', ifsc: 'IFSC', phone: 'Phone (stated)', url: 'Link', caller: 'Caller ID' };
  const title = ring.linked ? `Ring ${ring.id}` : `Call ${ring.callIds[0]}`;
  const highlight = (text, call) => {
    let out = esc(text);
    for (const id of call.identifiers.filter((x) => ['upi', 'account', 'ifsc', 'phone', 'url'].includes(x.type))) {
      out = out.replace(new RegExp(esc(id.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
    }
    return out;
  };

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>1930 dossier · ${esc(title)}</title><link rel="stylesheet" href="/dossier.css"></head><body>
<div class="toolbar"><a href="/">← Dashboard</a><button onclick="window.print()">Print / save as PDF</button><a href="/api/export/${esc(ring.id)}.json" download>Export bank / I4C feed (JSON)</a></div>
<main>
<header>
  <p class="kicker">Draft for the National Cyber Crime Reporting Portal (cybercrime.gov.in) and the 1930 helpline</p>
  <h1>Complaint packet · ${esc(title)}</h1>
  <p class="note">Prepared automatically by the Chakravyuh decoy on ${esc(when(generatedAt))} IST. <strong>Not submitted.</strong> The complainant or cyber cell files it; Chakravyuh never contacts, tracks or pays the suspects.</p>
</header>

<section>
  <h2>Summary</h2>
  <table class="kv">
    <tr><th>Suggested category</th><td>Online Financial Fraud · Fraud call / vishing (confirm sub-category on the portal)</td></tr>
    <tr><th>Scam type${p.members.length > 1 ? 's' : ''}</th><td>${esc(ring.scamTypes.join(', ') || 'Unclassified')}</td></tr>
    <tr><th>Calls linked</th><td>${p.members.length} call${p.members.length > 1 ? 's' : ''} from ${ring.callerNumbers.length} number${ring.callerNumbers.length === 1 ? '' : 's'}, ${esc(when(ring.firstSeen))} to ${esc(when(ring.lastSeen))}</td></tr>
    <tr><th>Impersonated</th><td>${esc(p.agencies.join(', ') || 'Not stated')}</td></tr>
    <tr><th>Amounts demanded</th><td>${p.amounts.length ? p.amounts.map((a) => `₹${a.toLocaleString('en-IN')}`).join(', ') : 'Not stated'}</td></tr>
    <tr><th>Money lost</th><td>₹0. The decoy never pays.</td></tr>
    ${kase ? `<tr><th>Case status</th><td>${esc({ DRAFT: 'Dossier ready', REVIEWED: 'Reviewed', FILED: 'Filed on NCRP / 1930', FREEZE_SENT: 'Freeze requests sent', FROZEN: 'Accounts frozen', CLOSED: 'Closed' }[kase.status])}${kase.ncrpAck ? ` · NCRP acknowledgement ${esc(kase.ncrpAck)}` : ''}</td></tr>
    <tr><th>Golden hour</th><td>Freeze requests due by ${esc(when(kase.goldenHour.deadline))} IST${kase.goldenHour.met === true ? ' · met' : kase.goldenHour.met === false ? ' · missed' : ''}</td></tr>` : ''}
    <tr><th>Scammer time absorbed</th><td>${(ring.scammerSeconds / 60).toFixed(1)} minutes</td></tr>
  </table>
</section>

<section>
  <h2>Suspect identifiers</h2>
  <table class="grid">
    <thead><tr><th>Type</th><th>Value</th><th>Detail</th><th>Seen in</th><th>First stated</th></tr></thead>
    <tbody>${p.identifiers.map((id) => `<tr><td>${typeName[id.type]}</td><td class="mono">${esc(id.value)}</td><td>${esc(id.type === 'ifsc' ? (id.meta?.valid ? `${id.meta.bank}${id.meta.branch ? ', ' + id.meta.branch : ''}` : id.meta?.reason) : id.type === 'upi' ? PSP[id.meta?.handle] || `@${id.meta?.handle}` : id.type === 'account' && id.meta?.ifsc ? `${id.meta.bank || ''} · IFSC ${id.meta.ifsc}` : '')}</td><td>${id.seenIn.map(esc).join(', ')}</td><td>${id.type === 'caller' ? 'Caller ID' : `${esc(id.firstCall)} at ${mmss(id.firstAt || 0)}`}</td></tr>`).join('')}</tbody>
  </table>
</section>

${ring.linked ? `<section>
  <h2>Why these calls are one ring</h2>
  <ul class="evidence">${ring.evidence.map((e) => `<li><strong>${esc(e.typeLabel)}</strong> <span class="mono">${esc(e.label)}</span> appears in ${e.callIds.map(esc).join(', ')}${e.type === 'voice' ? ' (voiceprint similarity above threshold; one signal among several)' : ''}${e.type === 'honeytoken' ? ' (a decoy identity planted in one call was quoted back in another: the two share a data source)' : ''}</li>`).join('')}</ul>
</section>` : ''}

<section>
  <h2>Freeze requests (${p.freeze.length})</h2>
  ${p.freeze.map((f, i) => `<article class="letter">
    <p class="mono small">REF CKV-${esc(ring.id)}-${i + 1}</p>
    <p>To: The Nodal Officer (Cyber Fraud), ${esc(f.bank)}</p>
    <p><strong>Subject: Request to review and place a debit freeze on suspected mule ${f.kind === 'upi' ? 'UPI ID' : 'account'} ${esc(f.value)}${f.ifsc ? ` (IFSC ${esc(f.ifsc)})` : ''}</strong></p>
    <p>On ${esc(when(f.call.startedAt))}, a caller using ${esc(f.call.callerNumber || 'an unknown number')} told a recorded decoy line to pay into this ${f.kind === 'upi' ? 'UPI ID' : 'account'} as part of a "${esc(f.call.scamLabel || 'fraud')}" scam. At ${mmss(f.at || 0)} into the call the caller said: <q>${esc(f.quote)}</q></p>
    <p>We request that the ${f.kind === 'upi' ? 'linked account' : 'account'} be reviewed and, if confirmed as a mule account, frozen for debits pending law-enforcement verification, and that KYC details be shared with the investigating cyber cell on request. A complaint is being filed on the NCRP / 1930 with the reference above.</p>
    <p class="sign">Complainant / officer: ______________________ &nbsp; Date: ____________</p>
  </article>`).join('') || '<p>No accounts or UPI IDs were extracted.</p>'}
</section>

<section>
  <h2>Call transcripts</h2>
  ${p.members.map((c) => `<article class="call">
    <h3>${esc(c.id)} · ${esc(c.scamLabel || 'Unclassified')} · ${esc(c.callerNumber || 'unknown number')} · ${esc(when(c.startedAt))} · ${((c.endedAt - c.startedAt) / 60000).toFixed(1)} min</h3>
    <p class="small">Channel: ${esc(c.channelLabel || c.channel)}${c.source?.operator ? ` (${esc(c.source.operator)}, ${esc(c.source.flag)})` : ''} · Consent: ${esc(c.consent?.basis || 'recorded')} · Decoy persona: ${esc(c.persona?.name || 'neutral')}${c.honeytoken ? ` (decoy identity "${esc(c.honeytoken.fullName)}")` : ''}</p>
    <ol class="transcript">${c.turns.map((t) => `<li class="${t.speaker}"><span class="t">${mmss(t.t)}</span><span class="who">${t.speaker === 'scammer' ? 'Caller' : 'Decoy'}</span><span>${t.speaker === 'scammer' ? highlight(t.text, c) : esc(t.text)}</span></li>`).join('')}</ol>
  </article>`).join('')}
</section>

<footer>
  <p>Evidence integrity: SHA-256 of the transcripts in this packet <span class="mono">${p.hash}</span></p>
  <p>Recorded with the consent of the citizen who merged the call (or on a decoy line). Calls cleared as non-scam are deleted (DPDP Act 2023). Shared only with law enforcement and banks.</p>
</footer>
</main></body></html>`;
}

export function feedExport(ring, calls) {
  const p = ringPacket(ring, calls);
  return {
    schema: 'chakravyuh.mule-feed.v0',
    ring: ring.id,
    generatedAt: new Date().toISOString(),
    scamTypes: ring.scamTypes,
    evidenceSha256: p.hash,
    indicators: p.identifiers.map((id) => ({ type: id.type, value: id.value, seenInCalls: id.seenIn, ifsc: id.type === 'ifsc' ? id.value : undefined })),
    linkEvidence: ring.evidence.map((e) => ({ type: e.type, value: e.label, calls: e.callIds }))
  };
}
