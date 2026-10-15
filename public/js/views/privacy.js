// Privacy & audit: consent, retention, guardrails, and who looked at what.
import { $, esc, api, when } from '../util.js';

let root;

export const view = {
  id: 'privacy',
  title: 'Privacy & audit',
  mount(el) {
    root = el;
    el.innerHTML = `
      <header class="page-head"><div><p class="overline">System <span>·</span> privacy &amp; audit</p><h2>Defensive by design</h2><p class="page-sub">Consent before every call, erasure of anything that is not a scam, guardrails in code, and a log of every dossier, export and lookup.</p></div></header>
      <div class="int-grid">
        <section class="panel">
          <header class="panel-head"><h2>Consent</h2></header>
          <table class="table"><tbody>
            <tr><td>Citizen merge</td><td>The citizen presses 1 to consent before the decoy joins; the console will not start a citizen call without it.</td></tr>
            <tr><td>Telco diversion</td><td>Only calls the operator already flagged as fraud, under a DoT / law-enforcement framework.</td></tr>
            <tr><td>Decoy numbers</td><td>Unused numbers that no real person owns.</td></tr>
          </tbody></table>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>Retention (DPDP Act 2023)</h2></header>
          <ul class="biz">
            <li><b>Not a scam</b> A reviewer can clear any call; its recording, transcript, voiceprint and identifiers are erased at once, leaving a tombstone (Call log → “Not a scam”).</li>
            <li><b>Scam evidence</b> Kept for the investigation and shared only with law enforcement and banks. (Retention period to be set with the pilot cyber cell.)</li>
            <li><b>Voiceprints</b> Taken from the caller's side only, never the citizen's.</li>
          </ul>
        </section>
        <section class="panel">
          <header class="panel-head"><h2>Guardrails in code</h2></header>
          <ul class="biz">
            <li>Never sends money or claims a payment went through</li>
            <li>Never reads out an OTP, PIN or card number</li>
            <li>Never installs apps, opens links or visits sites the caller sends</li>
            <li>Never calls out; no tracking links, no hack-back</li>
            <li>Every line, including model-written ones, passes a guard filter</li>
          </ul>
        </section>
        <section class="panel span3">
          <header class="panel-head"><h2>Audit log</h2><button class="btn sm" id="au-refresh">Refresh</button></header>
          <div id="au-log"></div>
        </section>
      </div>`;
    $('#au-refresh', el).onclick = load;
  },
  update() {},
  show: load
};

async function load() {
  const rows = await api('/api/audit');
  $('#au-log', root).innerHTML = rows.length ? `<table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th></tr></thead><tbody>${rows.slice(0, 100).map((r) => `<tr><td class="small">${when(r.at)}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No access recorded yet. Opening a dossier, exporting a feed or running a lookup is logged here.</p>';
}
