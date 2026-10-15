// Case board: each ring's complaint packet moves from dossier to frozen accounts, against the clock.
import { $, esc, api, toast, riskBar, ringColor, when, stats } from '../util.js';
import { goldenCell } from './overview.js';

let root, state;
const COLUMNS = ['DRAFT', 'REVIEWED', 'FILED', 'FREEZE_SENT', 'FROZEN'];
const NEXT = {
  DRAFT: ['REVIEWED', 'Mark reviewed'],
  REVIEWED: ['FILED', 'Record NCRP filing'],
  FILED: ['FREEZE_SENT', 'Send freeze requests'],
  FREEZE_SENT: ['FROZEN', 'Confirm frozen'],
  FROZEN: ['CLOSED', 'Close case']
};

export const view = {
  id: 'cases',
  title: 'Cases',
  mount(el) {
    root = el;
    el.innerHTML = `
      <header class="page-head"><div><p class="overline">Investigations <span>·</span> case board</p><h2>Freeze the money inside the golden hour</h2><p class="page-sub">Each ring with a mule account gets a case at hang-up. The golden hour is the first 60 minutes after the dossier is ready, while money can still be frozen.</p></div><dl class="page-stats" id="cs-stats"></dl></header>
            <div class="board" id="cs-board"></div>
      <section class="panel"><header class="panel-head"><h2>Closed</h2></header><div id="cs-closed" class="muted small"></div></section>`;
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-advance]');
      if (!b) return;
      const [id, status] = b.dataset.advance.split('|');
      let ncrpAck;
      if (status === 'FILED') {
        const input = b.closest('.case-card').querySelector('.ack');
        ncrpAck = input.value.trim();
        if (!/^\d{8,20}$/.test(ncrpAck)) {
          input.focus();
          return toast('Enter the acknowledgement number the NCRP portal gave you (digits only).', 'warn');
        }
      }
      if (status === 'FREEZE_SENT') window.open(`/dossier/${encodeURIComponent(id)}#freeze`, '_blank');
      try {
        await api(`/api/cases/${encodeURIComponent(id)}/advance`, { status, ncrpAck });
        toast(`${id}: ${state.caseStages.find((s) => s.id === status).label}`);
      } catch (err) {
        toast(err.message, 'warn');
      }
    });
  },
  update(s) {
    state = s;
    const rings = s.graph.rings.filter((r) => r.upis.length || r.accounts.length);
    const open = rings.filter((r) => !['FROZEN', 'CLOSED'].includes(r.case.status));
    stats($('#cs-stats', root), [[open.length, 'open cases', open.length ? 'warn' : ''], [rings.filter((r) => r.case.status === 'FROZEN').length, 'frozen'], [s.kpis.goldenHourMet == null ? '—' : `${Math.round(s.kpis.goldenHourMet * 100)}%`, 'inside golden hour']]);
    // Keep anything being typed into an acknowledgement field across live refreshes.
    const typed = Object.fromEntries([...root.querySelectorAll('.ack')].map((i) => [i.closest('.case-card').dataset.ring, i.value]));
    const focused = document.activeElement?.classList.contains('ack') ? document.activeElement.closest('.case-card').dataset.ring : null;
    $('#cs-board', root).innerHTML = COLUMNS.map((col) => {
      const stage = s.caseStages.find((x) => x.id === col);
      const items = rings.filter((r) => r.case.status === col).sort((a, b) => a.case.goldenHour.deadline - b.case.goldenHour.deadline);
      return `<section class="col"><header><h3>${esc(stage.label)}</h3><span class="count">${items.length}</span></header><p class="hint">${esc(stage.hint)}</p>
        ${items.map(card).join('') || '<p class="empty small">Nothing here.</p>'}</section>`;
    }).join('');
    root.querySelectorAll('.ack').forEach((i) => {
      const id = i.closest('.case-card').dataset.ring;
      if (typed[id]) i.value = typed[id];
      if (id === focused) i.focus();
    });
    const closed = rings.filter((r) => r.case.status === 'CLOSED');
    $('#cs-closed', root).textContent = closed.length ? closed.map((r) => r.id).join(', ') : 'No closed cases yet.';
  }
};

function card(r) {
  const next = NEXT[r.case.status];
  const mules = r.upis.length + r.accounts.length;
  return `<article class="case-card" data-ring="${esc(r.id)}" style="--ring:${ringColor(r.id)}">
    <header><a href="#/rings/${esc(r.id)}" class="ring-id">${esc(r.id)}</a>${riskBar(r.risk)}</header>
    <p>${esc(r.scamTypes.join(' + ') || 'Unclassified')}</p>
    <p class="small muted">${r.callIds.length} call${r.callIds.length > 1 ? 's' : ''} · ${mules} mule ID${mules === 1 ? '' : 's'} · ${esc(r.banks.slice(0, 2).join(', ') || 'UPI only')}</p>
    ${r.case.ncrpAck ? `<p class="small">NCRP ack <code>${esc(r.case.ncrpAck)}</code></p>` : ''}
    <p>${goldenCell(r.case)}</p>
    <details><summary>History</summary><ol class="hist">${r.case.history.map((h) => `<li><time>${when(h.at)}</time> ${esc(h.note)}${h.actor ? ` <span class="muted">· ${esc(h.actor)}</span>` : ''}</li>`).join('')}</ol></details>
    ${next?.[0] === 'FILED' ? `<input class="ack" inputmode="numeric" placeholder="NCRP acknowledgement no." aria-label="NCRP acknowledgement number">` : ''}
    <div class="actions"><a class="btn sm" href="/dossier/${esc(r.id)}" target="_blank">Dossier</a>${next ? `<button class="btn sm primary" data-advance="${esc(r.id)}|${next[0]}">${next[1]}</button>` : ''}</div>
  </article>`;
}
