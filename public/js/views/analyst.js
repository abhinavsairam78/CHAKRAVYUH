import { $, esc, api, toast, ID_LABEL } from '../util.js';

let root, state, report, selected = '', sequence = 0, query = '';
const sample = 'Caller: I am calling from CBI. You are under digital arrest.\nCaller: Do not tell anyone and do not disconnect.\nDecoy: What should I do?\nCaller: Transfer 50000 rupees immediately to verification@ybl.\nCaller: Install AnyDesk and share your OTP for verification.';

export const view = {
  id: 'analyst', title: 'Investigation studio',
  mount(el) {
    root = el;
    el.innerHTML = `
      <header class="page-head"><div><p class="overline">INTELLIGENCE <span> / </span> EVIDENCE REVIEW</p><h2>From conversation to a clear next step.</h2><p class="page-sub">Inspect the signals, check the source, and decide what deserves attention.</p></div><span class="analyst-mark">HUMAN REVIEW REQUIRED</span></header>
      <div class="analyst-layout">
        <aside class="analyst-source">
          <section class="panel"><p class="overline">01 / SELECT A SOURCE</p><label class="field">Search calls<input id="an-search" type="search" placeholder="Call ID, number or scam type" aria-label="Search calls"></label><div id="an-calls" class="analyst-call-list"></div></section>
          <section class="panel"><header class="panel-head"><h2>Analyse a transcript</h2><button class="btn sm ghost" id="an-example">Try example</button></header><p class="small muted">Use Caller: and Decoy: labels. Unlabelled lines are treated as caller speech. Preview text is not saved.</p><label class="sr-only" for="an-text">Transcript text</label><textarea id="an-text" maxlength="30000" rows="7" placeholder="Caller: Your account will be blocked…"></textarea><div class="analyst-import"><label class="btn sm ghost">Open .txt<input id="an-file" type="file" accept=".txt,text/plain" class="sr-only"></label><span id="an-length" class="small muted">0 / 30,000</span></div><button class="btn primary analyst-full" id="an-analyse">Analyse transcript <span aria-hidden="true">↗</span></button></section>
        </aside>
        <div class="analyst-output" id="an-report" aria-live="polite"><div class="analyst-welcome"><p class="overline">INVESTIGATION STUDIO</p><h3>Evidence you can<br>trace back to the call.</h3><p>Select a captured call or paste a transcript to see review priority, payment destinations, quoted signals, and evidence gaps.</p><div class="analyst-workflow"><span>01 Capture</span><span>02 Understand</span><span>03 Verify</span></div><button class="btn primary" id="an-start">Analyse example transcript ↗</button></div></div>
      </div>
      <section class="panel analyst-health"><div><p class="overline">MODEL OPERATIONS</p><h2 id="an-model-title">Checking model status…</h2><p class="small muted" id="an-model-info"></p></div><div class="actions"><button class="btn sm" id="an-enable">Enable local AI</button><button class="btn sm ghost" id="an-disable">Use playbook</button><button class="btn sm ghost" id="an-refresh">Refresh status</button></div></section>`;
    $('#an-search', el).oninput = (e) => { query = e.target.value.toLowerCase(); renderCalls(); };
    $('#an-text', el).oninput = (e) => { $('#an-length', el).textContent = `${e.target.value.length.toLocaleString()} / 30,000`; };
    $('#an-file', el).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 120000) return toast('Choose a text file under 120 KB.', 'warn');
      const text = await f.text();
      if (text.length > 30000) return toast('Transcript limit is 30,000 characters.', 'warn');
      $('#an-text', root).value = text; $('#an-text', root).dispatchEvent(new Event('input'));
    };
    el.onclick = async (e) => {
      const call = e.target.closest('[data-analysis-call]');
      if (call) {
        const id = call.dataset.analysisCall;
        if (location.hash === `#/analyst/${encodeURIComponent(id)}`) await analyse({ callId: id });
        else location.hash = `#/analyst/${encodeURIComponent(id)}`;
        return;
      }
      const button = e.target.closest('button'); if (!button) return;
      if (button.id === 'an-example' || button.id === 'an-start') {
        $('#an-text', root).value = sample; $('#an-text', root).dispatchEvent(new Event('input'));
        if (button.id === 'an-start') await analyse({ transcript: sample });
      }
      if (button.id === 'an-analyse') await analyse({ transcript: $('#an-text', root).value });
      if (button.id === 'an-rank') await analyse(selected ? { callId: selected, useAI: true } : { transcript: reportTranscript, useAI: true });
      if (button.id === 'an-export' && report) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `chakravyuh-analysis-${report.callId}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      if (['an-enable', 'an-disable'].includes(button.id)) {
        button.disabled = true; const label = button.textContent; button.textContent = 'Updating…';
        try { await api('/api/settings', { dialogue: button.id === 'an-enable' ? 'ollama' : 'off' }); toast('Dialogue mode updated'); }
        catch (err) { toast(err.message, 'warn'); }
        finally { button.disabled = false; button.textContent = label; await health(); }
      }
      if (button.id === 'an-refresh') await health();
    };
  },
  update(s) {
    state = s; renderCalls();
    if (selected && state.calls.find((c) => c.id === selected)?.purged) { sequence++; report = null; $('#an-report', root).innerHTML = '<p class="empty">This call has been erased.</p>'; }
  },
  route(id) { if (id && id !== selected) analyse({ callId: id }); },
  show() { health(); }
};

let reportTranscript = '';
async function analyse(payload) {
  const token = ++sequence;
  selected = payload.callId || '';
  if (payload.transcript !== undefined) reportTranscript = payload.transcript;
  $('#an-report', root).setAttribute('aria-busy', 'true');
  $('#an-report', root).innerHTML = '<div class="analyst-welcome"><p class="overline">ANALYSING SOURCE</p><h3>Tracing the evidence…</h3><p>Matching signals to caller statements and checking payment details.</p></div>';
  renderCalls();
  try {
    const result = await api('/api/analysis', payload);
    if (token !== sequence) return;
    report = result; renderReport();
  } catch (err) {
    if (token !== sequence) return;
    report = null; $('#an-report', root).innerHTML = `<section class="panel"><h3>Analysis unavailable</h3><p>${esc(err.message)}</p><p class="muted">Select a call or edit your transcript and try again.</p></section>`;
  } finally { if (token === sequence) $('#an-report', root).removeAttribute('aria-busy'); }
}

function renderCalls() {
  if (!state) return;
  const priorities = new Map((state.reviewQueue || []).map((c) => [c.callId, c]));
  const calls = state.calls.filter((c) => !c.purged && `${c.id} ${c.callerNumber} ${c.scamLabel}`.toLowerCase().includes(query)).sort((a,b) => (priorities.get(b.id)?.score || 0) - (priorities.get(a.id)?.score || 0));
  $('#an-calls', root).innerHTML = calls.length ? calls.slice(0, 50).map((c) => `<button class="analyst-call ${selected === c.id ? 'selected' : ''}" data-analysis-call="${esc(c.id)}"><span><b>${esc(c.id)}</b><small>${esc(c.scamLabel || 'Unclassified')}</small></span><span class="small muted">${esc(priorities.get(c.id)?.priority || 'Live')} ↗</span></button>`).join('') : '<p class="empty">No matching calls.</p>';
}

function renderReport() {
  const a = report;
  const selectedEvidence = a.ranking?.evidenceIds || [];
  const evidence = [...a.evidence].sort((x, y) => Number(selectedEvidence.includes(y.id)) - Number(selectedEvidence.includes(x.id)) || y.weight - x.weight);
  $('#an-report', root).innerHTML = `
    <section class="analysis-brief"><div class="analysis-brief-top"><p class="overline">02 / INVESTIGATION BRIEF <span>·</span> ${esc(a.callId)}</p><button class="btn sm ghost" id="an-export">Export JSON ↓</button></div><div class="analysis-headline"><div><h3>${esc(a.classification.type === 'unknown' ? 'More context needed' : a.classification.label)}</h3><p>${esc(a.summary)}</p></div><div class="analysis-score ${a.priority.toLowerCase()}"><b>${a.score}<small>/99</small></b><span>${esc(a.priority)} review priority</span></div></div><p class="small muted">${esc(a.scoreExplanation)}</p><div class="analysis-meta"><span>${a.evidence.length} cited signals</span><span>${a.identifiers.length} extracted items</span><span>${a.gaps.length} evidence gaps</span></div></section>
    <section class="panel"><header class="panel-head"><div><p class="overline">FOLLOW THE MONEY</p><h2>Extracted identifiers</h2></div></header>${a.identifiers.length ? `<div class="analyst-identifiers">${a.identifiers.map((i) => `<div><span class="tag">${esc(ID_LABEL[i.type] || i.type)}</span><code>${esc(i.value)}</code><small>Turn ${i.turns.join(', ')} · ${i.confidence >= .85 ? 'Strong extraction match' : 'Verify extraction'}</small><a href="#/rings" title="Open ring graph to look up this identifier">Ring graph ↗</a></div>`).join('')}</div>` : '<p class="muted">No identifiers found in caller statements.</p>'}</section>
    <section class="panel"><header class="panel-head"><div><p class="overline">SOURCE-BASED FINDINGS</p><h2>Why this call needs review</h2></div><button class="btn sm" id="an-rank" ${a.evidence.length ? '' : 'disabled'}>Prioritize with local AI</button></header>${a.ranking ? `<p class="notice small">${esc(a.ranking.note)}</p>` : ''}<div class="analysis-evidence">${evidence.length ? evidence.map((e) => `<article><div><span class="evidence-ref">${esc(e.id)}</span><h4>${esc(e.label)}</h4><span class="small muted">Caller · turn ${e.turn}</span>${selectedEvidence.includes(e.id) ? '<span class="tag">Priority evidence</span>' : ''}</div><blockquote>${esc(e.quote)}</blockquote><p class="small muted">${esc(e.explanation)}</p></article>`).join('') : '<p class="muted">No configured risk signals matched. This does not establish that the call is safe.</p>'}</div></section>
    <div class="analysis-next"><section class="panel"><p class="overline">03 / VERIFY</p><h2>Evidence gaps</h2><ul>${a.gaps.length ? a.gaps.map((g) => `<li>${esc(g)}</li>`).join('') : '<li>No basic extraction gaps detected. Verify the underlying statements.</li>'}</ul></section><section class="panel"><p class="overline">RECOMMENDED NEXT STEPS</p><h2>Reviewer checklist</h2><ol>${a.actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>${selected ? `<a class="btn sm" href="#/calls/${esc(selected)}">Open complete transcript ↗</a>` : ''}</section></div>
    <p class="analysis-fingerprint">SOURCE FINGERPRINT / SHA-256 <code>${esc(a.fingerprint)}</code></p>`;
}

async function health() {
  try {
    const h = await api('/api/health');
    $('#an-model-title', root).textContent = h.model.enabled ? h.model.label : 'Local evidence engine ready';
    $('#an-model-info', root).textContent = `Dialogue: ${h.model.mode === 'off' ? 'playbook' : h.model.mode} · ${h.model.enhanced} AI replies · ${h.model.fallbacks} fallbacks · ${h.model.averageMs === null ? 'no AI latency measured yet' : `${h.model.averageMs} ms average AI latency`}. Transcript analysis works offline.`;
  } catch (err) { $('#an-model-title', root).textContent = 'Connection unavailable'; $('#an-model-info', root).textContent = err.message; }
}
