// App shell: hash router, live state over server-sent events, global ticking clocks.
import { $, $$, esc, api, toast, countdown } from './util.js';
import { view as overview } from './views/overview.js';
import { view as live } from './views/live.js';
import { view as rings } from './views/rings.js';
import { view as cases } from './views/cases.js';
import { view as feed } from './views/feed.js';
import { view as calls } from './views/calls.js';
import { view as playbooks } from './views/playbooks.js';
import { view as integrations } from './views/integrations.js';
import { view as privacy } from './views/privacy.js';
import { view as analyst } from './views/analyst.js';
import { hosted, installHostedExports } from './hosted.js';

const VIEWS = [overview, live, analyst, rings, cases, feed, calls, playbooks, integrations, privacy];
let state = null;
let current = null;

const app = {
  liveId: null,
  setLive(callId) {
    app.liveId = callId;
    const dot = $('#nav-live-dot');
    dot.hidden = !callId;
    $('#live-banner').hidden = !callId || current === live;
    $('#live-banner').innerHTML = callId ? `Live call ${esc(callId)} in progress · <a href="#/live">Back to the call</a>` : '';
  },
  pulse(ids) {
    rings.pulse(ids);
  }
};

for (const v of VIEWS) {
  const el = document.createElement('div');
  el.className = 'view';
  el.dataset.view = v.id;
  el.hidden = true;
  $('#views').appendChild(el);
  v.mount(el, app);
  v.el = el;
}

function route() {
  const [, name = '', param] = location.hash.match(/^#\/?([^/]*)\/?(.*)$/) || [];
  const v = VIEWS.find((x) => x.id === (name || 'overview')) || overview;
  if (current !== v) {
    VIEWS.forEach((x) => (x.el.hidden = x !== v));
    current = v;
    $('#page-title').textContent = v.title;
    $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === v.id));
    if (state) v.update(state);
    v.show?.();
    app.setLive(app.liveId);
    window.scrollTo(0, 0);
  }
  v.route?.(param ? decodeURIComponent(param) : null);
}
window.addEventListener('hashchange', route);

function applyState(next) {
  state = next;
  $('#conn').className = 'conn on';
  $('#connection-label').textContent = 'Connected';
  live.update(state); // the live call keeps running while you look at other pages
  rings.update(state); // the graph keeps settling in the background
  if (current && current !== live && current !== rings) current.update(state);
  renderNavCounts();
}
function disconnected() {
  $('#conn').className = 'conn off';
  $('#connection-label').textContent = 'Reconnecting';
}
if (hosted) {
  let refreshing = false;
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try { applyState(await api('/api/state')); } catch { disconnected(); }
    finally { refreshing = false; }
  };
  window.addEventListener('ckv-state-changed', refresh);
  window.addEventListener('ckv-storage-warning', () => toast('Browser storage is full or unavailable. Progress will last until this page closes.', 'warn'));
  window.addEventListener('ckv-export-error', (event) => toast(event.detail, 'warn'));
  installHostedExports();
  const badge = document.querySelector('.demo-badge');
  badge.textContent = 'BROWSER DEMO';
  badge.title = 'Synthetic demo data. Progress is saved in this browser.';
  document.querySelector('.demo-note span').textContent = 'Synthetic data. Demo progress is saved in this browser; local AI runs in the laptop version.';
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
} else {
  const events = new EventSource('/api/events');
  events.addEventListener('state', (event) => applyState(JSON.parse(event.data)));
  events.onerror = disconnected;
}

function renderNavCounts() {
  const k = state.kpis;
  $('#nav-cases').textContent = k.openCases || '';
  $('#nav-rings').textContent = k.linkedRings || '';
  $('#nav-feed').textContent = k.muleIdentifiers || '';
  $('#side-llm').textContent = state.llm ? `Dialogue model: ${state.llm}` : 'Dialogue: rule-based playbook';
}

// Golden-hour clocks tick every second wherever they are on screen.
setInterval(() => {
  const now = Date.now();
  $$('[data-deadline]').forEach((el) => {
    const left = Number(el.dataset.deadline) - now;
    el.textContent = `⏱ ${countdown(left)}`;
    el.className = `status ${left < 0 ? 'bad' : left < 15 * 60000 ? 'warn' : 'info'}`;
  });
}, 1000);

$('#reset').onclick = async () => {
  if (live.isBusy()) return toast('End the live call first.', 'warn');
  if (!confirm('Restore the synthetic 14-day history and remove all demo calls and case changes?')) return;
  await api('/api/reset', {});
  toast('Demo data restored');
};

route();
