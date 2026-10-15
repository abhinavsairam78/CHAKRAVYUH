// Ring graph: every call and what it revealed, linked into rings; search any identifier.
import { $, esc, api, when, ago, riskBar, ringColor, rupees, channelPill, stats } from '../util.js';
import { goldenCell } from './overview.js';

let root, app, graph, state, selected = null;

export const view = {
  id: 'rings',
  title: 'Ring graph',
  mount(el, a) {
    root = el;
    app = a;
    el.innerHTML = `
      <header class="page-head"><div><p class="overline">Investigations <span>·</span> ring graph</p><h2>Who is behind the calls</h2><p class="page-sub">Calls that share a caller number, UPI ID, bank account, voiceprint or honeytoken fall into one ring. Click a ring for its evidence.</p></div><dl class="page-stats" id="rg-stats"></dl></header>
      <div class="rings-grid">
        <section class="panel graph-panel">
          <header class="panel-head"><h2>Scam-ring graph</h2><div class="legend" id="rg-legend"></div></header>
          <div class="canvas-wrap"><canvas id="rg-canvas" aria-label="Graph of calls linked by shared identifiers"></canvas><div class="tooltip" id="rg-tip" hidden></div></div>
          <p class="fine">Calls (outlined circles) link to what they revealed. Calls sharing a caller number, UPI ID, bank account, voiceprint or honeytoken fall into one ring. A shared script only marks a campaign; it never merges rings on its own. Drag to pan, scroll to zoom, double-click to refit, click a node to open its ring.</p>
        </section>
        <aside class="panel ring-side">
          <form class="lookup" id="rg-lookup"><input id="rg-q" placeholder="Look up a UPI ID, account, phone or IFSC" autocomplete="off"><button class="btn">Search</button></form>
          <div id="rg-result"></div>
          <div id="rg-detail"></div>
          <h3 class="side-h">All rings</h3>
          <div id="rg-list" class="ring-list"></div>
        </aside>
      </div>`;
    graph = new window.RingGraph($('#rg-canvas', el), $('#rg-tip', el));
    graph.onSelect = (n) => select(n.ring);
    $('#rg-legend', el).innerHTML = Object.entries(window.TYPE_LABEL).map(([t, l]) => `<span style="--dot:${window.NODE_COLORS[t]}">${l}</span>`).join('');
    $('#rg-lookup', el).onsubmit = async (e) => {
      e.preventDefault();
      const q = $('#rg-q', el).value.trim();
      if (!q) return;
      const res = await api(`/api/v1/lookup?q=${encodeURIComponent(q)}`);
      const box = $('#rg-result', el);
      if (!res.hits.length) {
        box.innerHTML = `<div class="notice">No call has mentioned <code>${esc(q)}</code>. Nothing is known about it yet.</div>`;
        return;
      }
      box.innerHTML = res.hits.map((h) => `<div class="notice hit"><b>${esc(h.type.toUpperCase())} <code>${esc(h.value)}</code></b> appears in ${h.calls.length} call${h.calls.length > 1 ? 's' : ''} (${h.calls.map((c) => esc(c.id)).join(', ')}), ring <a href="#/rings/${esc(h.ringId)}">${esc(h.ringId)}</a>.</div>`).join('');
      select(res.hits[0].ringId);
      graph.pulse(res.hits.map((h) => `${h.type}:${h.value}`));
    };
  },
  update(s) {
    state = s;
    graph.update(s.graph);
    const linked = s.graph.rings.filter((r) => r.linked);
    stats($('#rg-stats', root), [[linked.length, 'linked rings'], [s.kpis.callsInRings, 'calls in rings'], [s.kpis.numbers, 'numbers mapped'], [s.mules.length, 'mule IDs']]);
    renderList();
    if (selected) renderDetail();
  },
  route(param) {
    if (param) select(param);
  },
  pulse(ids) {
    graph?.pulse(ids);
  }
};

function select(id) {
  selected = id || null;
  graph.focusRing(selected);
  renderDetail();
  renderList();
}

function renderList() {
  const rings = [...state.graph.rings].sort((a, b) => b.linked - a.linked || b.risk - a.risk);
  $('#rg-list', root).innerHTML = rings.map((r) => `<button class="ring-row ${r.id === selected ? 'on' : ''} ${r.linked ? '' : 'single'}" data-id="${esc(r.id)}" style="--ring:${ringColor(r.id)}">
      <span class="rid">${esc(r.id)}</span><span class="rt">${esc(r.scamTypes.join(' + ') || 'Unclassified')}</span><span class="rc">${r.callIds.length} call${r.callIds.length > 1 ? 's' : ''}</span>${riskBar(r.risk)}
    </button>`).join('');
  root.querySelectorAll('.ring-row').forEach((b) => (b.onclick = () => select(b.dataset.id)));
}

function renderDetail() {
  const box = $('#rg-detail', root);
  const r = state.graph.rings.find((x) => x.id === selected);
  if (!r) return (box.innerHTML = '');
  const calls = state.calls.filter((c) => r.callIds.includes(c.id)).sort((a, b) => a.startedAt - b.startedAt);
  const stage = state.caseStages.find((s) => s.id === r.case.status);
  box.innerHTML = `<section class="ring-detail" style="--ring:${ringColor(r.id)}">
    <header><h3>${esc(r.id)}</h3>${riskBar(r.risk)}<button class="x" title="Close" id="rg-close">×</button></header>
    <p>${esc(r.scamTypes.join(' + ') || 'Unclassified')} · ${r.callIds.length} calls from ${r.callerNumbers.length} number${r.callerNumbers.length === 1 ? '' : 's'} · first seen ${when(r.firstSeen)}, last ${ago(r.lastSeen)}</p>
    <dl class="facts">
      <dt>Mule UPI IDs</dt><dd>${r.upis.map((x) => `<code>${esc(x)}</code>`).join(' ') || '—'}</dd>
      <dt>Mule accounts</dt><dd>${r.accounts.map((x) => `<code>${esc(x)}</code>`).join(' ') || '—'}</dd>
      <dt>Banks</dt><dd>${esc(r.banks.join(', ') || '—')}</dd>
      <dt>Caller numbers</dt><dd>${r.callerNumbers.map((x) => `<code>${esc(x)}</code>`).join(' ')}</dd>
      <dt>Impersonates</dt><dd>${esc(r.agencies.join(', ') || '—')}</dd>
      <dt>Amount demanded</dt><dd>${rupees(r.demanded)} across calls</dd>
      ${r.campaigns.length ? `<dt>Script campaign</dt><dd>${esc(r.campaigns.join(', '))}</dd>` : ''}
    </dl>
    ${r.linked ? `<h4>Why these calls are one ring</h4><ul class="evidence">${r.evidence.map((e) => `<li><b>${esc(e.typeLabel)}</b> <code>${esc(e.label)}</code> <span class="muted">in ${e.callIds.map(esc).join(', ')}</span></li>`).join('')}</ul>` : '<p class="muted">Single call so far. It links the moment any identifier reappears.</p>'}
    <h4>Calls</h4>
    <ol class="call-timeline">${calls.map((c) => `<li><a href="#/calls/${esc(c.id)}">${esc(c.id)}</a> ${channelPill(c.channel)} <span>${esc(c.scamLabel || 'Unclassified')}</span> <span class="muted">${esc(c.callerNumber || '')} · ${when(c.startedAt)}</span></li>`).join('')}</ol>
    <h4>Case</h4>
    <p>${esc(stage.label)}${r.case.ncrpAck ? ` · NCRP ack <code>${esc(r.case.ncrpAck)}</code>` : ''} · ${goldenCell(r.case)}</p>
    <div class="actions"><a class="btn primary" href="/dossier/${esc(r.id)}" target="_blank">1930 dossier</a><a class="btn" href="#/cases">Case board</a><a class="btn" href="/api/export/${esc(r.id)}.json">Bank / I4C feed</a></div>
  </section>`;
  $('#rg-close', root).onclick = () => select(null);
}
