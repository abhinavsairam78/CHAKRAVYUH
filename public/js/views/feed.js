// Mule feed: what a bank or payment-app fraud team subscribes to.
import { $, esc, when, ago, riskBar, stats } from '../util.js';

let root, state, filter = { type: 'all', min: 0, q: '' };

export const view = {
  id: 'feed',
  title: 'Mule feed',
  mount(el) {
    root = el;
    el.innerHTML = `
      <header class="page-head"><div><p class="overline">Investigations <span>·</span> mule feed</p><h2>Accounts to freeze before victims pay</h2><p class="page-sub">Every UPI ID and account a scammer asked the decoy to pay into, scored by reuse. Banks pull it to freeze accounts; it complements RBI's MuleHunter.AI from the scammer's side.</p></div><dl class="page-stats" id="fd-stats"></dl></header>
            <div class="toolbar-row">
        <div class="seg" id="fd-type"><button data-v="all" class="on">All</button><button data-v="upi">UPI IDs</button><button data-v="account">Bank accounts</button></div>
        <label class="inline">Min risk <input type="range" id="fd-min" min="0" max="90" step="10" value="0"><b id="fd-minv">0</b></label>
        <input id="fd-q" placeholder="Filter by ID, bank or ring" autocomplete="off">
        <span class="spacer"></span>
        <a class="btn" href="/api/v1/mules.csv">Download CSV</a>
        <a class="btn" href="/api/v1/mules" target="_blank">JSON API</a>
      </div>
      <section class="panel"><div id="fd-table"></div></section>
      <section class="panel api-doc">
        <header class="panel-head"><h2>Integration for banks</h2></header>
        <pre><code># Full feed, risk-sorted (JSON)
curl http://127.0.0.1:4310/api/v1/mules

# Check one identifier before releasing a payment
curl "http://127.0.0.1:4310/api/v1/lookup?q=cbi.verify@okicici"</code></pre>
        <p class="fine">Every pull and lookup is written to the audit log. In production this sits behind mutual TLS and per-bank API keys.</p>
      </section>`;
    $('#fd-type', el).onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      filter.type = b.dataset.v;
      el.querySelectorAll('#fd-type button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    };
    $('#fd-min', el).oninput = (e) => {
      filter.min = Number(e.target.value);
      $('#fd-minv', el).textContent = filter.min;
      render();
    };
    $('#fd-q', el).oninput = (e) => {
      filter.q = e.target.value.trim().toLowerCase();
      render();
    };
  },
  update(s) {
    state = s;
    render();
  }
};

function render() {
  if (!state) return;
  const all = state.mules;
  stats($('#fd-stats', root), [[all.length, 'identifiers'], [all.filter((m) => m.risk >= 75).length, 'high risk', 'warn'], [all.filter((m) => m.status === 'Frozen').length, 'frozen']]);
  const rows = state.mules.filter((m) => (filter.type === 'all' || m.type === filter.type) && m.risk >= filter.min && (!filter.q || `${m.value} ${m.institution} ${m.ringId} ${m.ifsc || ''}`.toLowerCase().includes(filter.q)));
  $('#fd-table', root).innerHTML = `<table class="table">
    <thead><tr><th>Risk</th><th>Identifier</th><th>Bank / app</th><th>Calls</th><th>Numbers</th><th>Ring</th><th>Scam types</th><th>First seen</th><th>Last seen</th><th>Status</th></tr></thead>
    <tbody>${rows.map((m) => `<tr>
      <td>${riskBar(m.risk)}</td>
      <td><span class="tag ${m.type}">${m.type === 'upi' ? 'UPI' : 'A/C'}</span> <code>${esc(m.value)}</code>${m.ifsc ? `<div class="muted small">IFSC ${esc(m.ifsc)}</div>` : ''}</td>
      <td>${esc(m.institution)}</td><td>${m.calls}</td><td>${m.numbers}</td>
      <td><a href="#/rings/${esc(m.ringId)}">${esc(m.ringId)}</a></td>
      <td class="small">${esc(m.scamTypes.join(', '))}</td>
      <td class="small">${when(m.firstSeen)}</td><td class="small">${ago(m.lastSeen)}</td>
      <td><span class="status ${m.status === 'Frozen' ? 'good' : m.status === 'Freeze requested' ? 'info' : 'warn'}">${esc(m.status)}</span></td>
    </tr>`).join('') || '<tr><td colspan="10" class="empty">No identifiers match.</td></tr>'}</tbody></table>
    <p class="fine">${rows.length} of ${state.mules.length} identifiers. Risk rises with repeat use, use across different caller numbers, and membership of a linked ring.</p>`;
}
