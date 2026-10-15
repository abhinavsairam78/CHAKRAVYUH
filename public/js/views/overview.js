// Command center: what the decoy network achieved, where the rings are, what needs action now.
import { $, esc, countdown, riskBar, ringColor, scamColor } from '../util.js';
import { stackedDays, hbars } from '../charts.js';

let root;

export const view = {
  id: 'overview',
  title: 'Command center',
  mount(el) {
    root = el;
    el.innerHTML = `
      <div class="overview-heading">
        <div><p class="overline">OPERATIONS OVERVIEW <span>·</span> SYNTHETIC DEMO DATA</p><h2>Investigations at a glance</h2><p>Follow captured calls, shared identifiers, and the cases that still need action.</p></div>
        <a class="btn primary overview-action" href="#/live">Start a decoy call <span aria-hidden="true">↗</span></a>
      </div>
      <dl class="overview-metrics" id="ov-metrics"></dl>
      <div class="overview-workspace">
        <section class="panel priority-panel"><header class="panel-head"><div><p class="overline">ACTION QUEUE</p><h2>Cases needing action</h2></div><a href="#/cases" class="link">Open case board <span aria-hidden="true">↗</span></a></header><div id="ov-queue"></div></section>
        <div class="overview-rail">
          <section class="panel next-panel"><header class="panel-head"><div><p class="overline">NEXT REVIEW</p><h2>Start here</h2></div></header><div id="ov-next"></div></section>
          <section class="panel"><header class="panel-head"><div><p class="overline">PAYMENT TRAIL</p><h2>Most frequent endpoints</h2></div><a href="#/feed" class="link">Mule feed ↗</a></header><div id="ov-banks"></div></section>
        </div>
      </div>
      <section class="panel trend-panel"><header class="panel-head"><div><p class="overline">NETWORK ACTIVITY</p><h2>Calls over the last 14 days</h2></div><a href="#/calls" class="link">Call log ↗</a></header><div id="ov-days"></div></section>
      <div class="overview-secondary">
        <section class="panel"><header class="panel-head"><h2>Scam patterns</h2></header><div id="ov-types"></div></section>
        <section class="panel"><header class="panel-head"><h2>Impersonated authorities</h2></header><div id="ov-agencies"></div></section>
      </div>`;
  },
  update(state) {
    const k = state.kpis;
    const a = state.analytics;
    const metrics = [
      [k.openCases, 'Cases awaiting action', 'Review the case board'],
      [k.linkedRings, 'Linked rings', `${k.callsInRings} connected calls`],
      [k.muleIdentifiers, 'Payment identifiers', 'UPI IDs and accounts captured'],
      [k.calls, 'Calls handled', `${a.avgMinutes.toFixed(1)} min average`]
    ];
    $('#ov-metrics', root).innerHTML = metrics.map(([value, label, detail]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd><small>${esc(detail)}</small></div>`).join('');
    stackedDays($('#ov-days', root), a.perDay);
    hbars($('#ov-banks', root), a.muleBanks, { color: '#ac7857', limit: 4 });
    hbars($('#ov-types', root), a.byType, { color: (t) => scamColor(t), limit: 8 });
    hbars($('#ov-agencies', root), a.agencies, { color: '#758e93', limit: 5 });
    const now = Date.now();
    const stageOrder = { DRAFT: 0, REVIEWED: 1, FILED: 2, FREEZE_SENT: 3 };
    const queue = state.graph.rings.filter((r) => stageOrder[r.case.status] != null && (r.upis.length || r.accounts.length)).sort((x, y) => stageOrder[x.case.status] - stageOrder[y.case.status] || y.risk - x.risk).slice(0, 5);
    $('#ov-queue', root).innerHTML = queue.length ? `<div class="queue-scroll"><table class="table queue-table"><thead><tr><th>Ring / pattern</th><th>Risk</th><th>Evidence</th><th>Case status</th><th>Golden hour</th><th></th></tr></thead><tbody>${queue.map((r) => `<tr><td><a href="#/rings/${esc(r.id)}" class="ring-id" style="--ring:${ringColor(r.id)}">${esc(r.id)}</a><div class="muted small">${esc(r.scamTypes.join(' + '))}</div></td><td>${riskBar(r.risk)}</td><td>${r.callIds.length} calls · ${r.upis.length + r.accounts.length} IDs</td><td>${esc(state.caseStages.find((s) => s.id === r.case.status).label)}</td><td>${goldenCell(r.case, now)}</td><td><a href="#/rings/${esc(r.id)}" aria-label="Inspect ring ${esc(r.id)}">↗</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No cases need review right now.</p>';
    const next = queue[0];
    $('#ov-next', root).innerHTML = next ? `<a href="#/rings/${esc(next.id)}" class="next-link"><span class="ring-id" style="--ring:${ringColor(next.id)}">${esc(next.id)}</span><strong>${esc(next.scamTypes.join(' + '))}</strong><span>${esc(state.caseStages.find((s) => s.id === next.case.status).label)} · ${next.callIds.length} connected calls</span><small>Inspect ring evidence <b>↗</b></small></a>` : '<p class="empty">The queue is clear.</p>';
  }
};

export function goldenCell(c, now = Date.now()) {
  const g = c.goldenHour;
  if (g.met === true) return '<span class="status good">✓ met</span>';
  if (g.met === false) return '<span class="status bad">✗ missed</span>';
  const left = g.deadline - now;
  return `<span class="status ${left < 0 ? 'bad' : left < 15 * 60000 ? 'warn' : 'info'}" data-deadline="${g.deadline}">⏱ ${countdown(left)}</span>`;
}
