// Call log: every call the decoy took, with transcript, playbook decisions and DPDP controls.
import { $, esc, api, toast, when, mmss, channelPill, ringColor, ID_LABEL, rupees, stats } from '../util.js';

let root, state, selected = null, filter = 'all';

export const view = {
  id: 'calls',
  title: 'Call log',
  mount(el) {
    root = el;
    el.innerHTML = `
      <header class="page-head"><div><p class="overline">Investigations <span>·</span> call log</p><h2>Every call the decoy took</h2><p class="page-sub">Transcripts with the reason for each decoy reply, the identifiers extracted, and consent. Clear a call as not a scam to erase it.</p></div><dl class="page-stats" id="cl-stats"></dl></header>
      <div class="toolbar-row">
        <div class="seg" id="cl-filter"><button data-v="all" class="on">All</button><button data-v="citizen-merge">Citizen merge</button><button data-v="telco-divert">Telco divert</button><button data-v="rehearsal">Rehearsal</button><button data-v="seed">History</button></div>
        <span class="spacer"></span><span class="muted small" id="cl-count"></span>
      </div>
      <div class="calls-grid">
        <section class="panel"><div id="cl-table"></div></section>
        <aside class="panel" id="cl-detail"><p class="empty">Select a call to see its transcript, the playbook's decisions turn by turn, and what was extracted.</p></aside>
      </div>`;
    $('#cl-filter', el).onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      filter = b.dataset.v;
      el.querySelectorAll('#cl-filter button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    };
    el.addEventListener('click', async (e) => {
      const row = e.target.closest('tr[data-id]');
      if (row && !e.target.closest('a')) {
        location.hash = `#/calls/${row.dataset.id}`;
        return;
      }
      if (e.target.closest('#cl-purge')) {
        if (!confirm(`Erase the recording, transcript, voiceprint and identifiers of ${selected}? Only a tombstone stays. This cannot be undone.`)) return;
        try {
          await api(`/api/calls/${encodeURIComponent(selected)}/not-scam`, { reason: 'Reviewer cleared it as not a scam' });
          toast(`${selected} erased under the DPDP retention rule`);
        } catch (err) {
          toast(err.message, 'warn');
        }
      }
    });
  },
  update(s) {
    state = s;
    render();
  },
  route(param) {
    selected = param || null;
    render();
  }
};

function render() {
  if (!state) return;
  const rings = new Map();
  for (const r of state.graph.rings) for (const id of r.callIds) rings.set(id, r);
  const calls = state.calls.filter((c) => filter === 'all' || c.channel === filter);
  $('#cl-count', root).textContent = `${calls.length} calls`;
  const by = (ch) => state.calls.filter((c) => c.channel === ch).length;
  stats($('#cl-stats', root), [[state.calls.length, 'calls'], [by('citizen-merge') + by('rehearsal'), 'citizen & rehearsal'], [by('telco-divert'), 'telco diverted'], [state.calls.filter((c) => c.purged).length, 'erased']]);
  $('#cl-table', root).innerHTML = `<table class="table clickable"><thead><tr><th>Call</th><th>When</th><th>Entry</th><th>Caller</th><th>Scam type</th><th>Length</th><th>Mule IDs</th><th>Ring</th></tr></thead><tbody>
    ${calls.map((c) => {
      const r = rings.get(c.id);
      const mules = c.identifiers.filter((x) => x.type === 'upi' || x.type === 'account').length;
      return `<tr data-id="${esc(c.id)}" class="${c.id === selected ? 'on' : ''} ${c.purged ? 'purged' : ''}">
        <td><b>${esc(c.id)}</b>${!c.endedAt ? ' <span class="pill live sm">live</span>' : ''}</td><td class="small">${when(c.startedAt)}</td><td>${channelPill(c.channel)}</td>
        <td><code>${esc(c.callerNumber || '—')}</code></td><td>${c.purged ? '<span class="muted">erased</span>' : esc(c.scamLabel || 'Unclassified')}</td>
        <td>${mmss(c.durationSec)}</td><td>${mules}</td>
        <td>${r ? `<a href="#/rings/${esc(r.id)}" class="ring-id" style="--ring:${ringColor(r.id)}">${esc(r.id)}</a>` : '—'}</td></tr>`;
    }).join('')}</tbody></table>`;
  renderDetail(rings);
}

function renderDetail(rings) {
  const box = $('#cl-detail', root);
  const c = state.calls.find((x) => x.id === selected);
  if (!c) return (box.innerHTML = '<p class="empty">Select a call to see its transcript, the playbook\'s decisions turn by turn, and what was extracted.</p>');
  if (c.purged) {
    box.innerHTML = `<h3>${esc(c.id)}</h3><div class="notice">Content erased on ${when(c.purged.at)}: ${esc(c.purged.reason)}. Only this tombstone remains (DPDP Act 2023: data not needed for the purpose is deleted).</div>`;
    return;
  }
  const r = rings.get(c.id);
  const ids = c.identifiers.filter((x) => x.type !== 'email');
  const decisions = c.events || [];
  box.innerHTML = `
    <header class="detail-head"><h3>${esc(c.id)}</h3>${channelPill(c.channel)}${r ? `<a href="#/rings/${esc(r.id)}" class="ring-id" style="--ring:${ringColor(r.id)}">${esc(r.id)}</a>` : ''}</header>
    <p>${esc(c.scamLabel || 'Unclassified')} · persona ${esc(c.persona?.name)} · ${esc(c.callerNumber || 'no caller ID')} · ${when(c.startedAt)} · ${mmss(c.durationSec)}</p>
    <p class="small muted">Consent: ${esc(c.consent?.basis || 'recorded')}${c.source?.operator ? ` · ${esc(c.source.operator)}: ${esc(c.source.flag)}` : ''}${c.voiceprint ? ` · voiceprint ${esc(c.voiceprint.kind)}${c.voiceprint.f0 ? `, median pitch ${c.voiceprint.f0} Hz` : ''}` : ' · no voiceprint'}</p>
    ${ids.length ? `<div class="chips">${ids.map((x) => `<span class="chip ${x.type}"><i>${ID_LABEL[x.type]}</i><code>${esc(x.type === 'amount' ? rupees(x.value) : x.value)}</code></span>`).join('')}</div>` : ''}
    <p><a class="btn sm" href="#/analyst/${esc(c.id)}">Analyse evidence in Investigation studio ↗</a></p>
    <h4>Transcript and playbook decisions</h4>
    <ol class="transcript compact">${c.turns.map((t, i) => {
      const d = t.speaker === 'scammer' ? decisions.find((e) => Math.abs(e.t - t.t) < 0.05) : null;
      return `<li class="${t.speaker}"><span class="t">${mmss(t.t)} · ${t.speaker === 'scammer' ? 'Caller' : esc(c.persona?.name || 'Decoy')}</span>${esc(t.text)}${d ? `<em class="why">Playbook › ${esc(d.reason)}</em>` : ''}</li>`;
    }).join('')}</ol>
    <div class="actions">${c.endedAt ? `<a class="btn primary" href="/dossier/${esc(c.id)}" target="_blank">1930 dossier</a>` : ''}<button class="btn danger-ghost" id="cl-purge">Not a scam: erase content</button></div>`;
}
