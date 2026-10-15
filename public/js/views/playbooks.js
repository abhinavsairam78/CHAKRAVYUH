// Playbook library: how each scam is recognised and how the decoy plays it.
import { $, esc, api, scamColor } from '../util.js';
import { speak, stopSpeaking } from '../voice.js';

let root, books = [];

export const view = {
  id: 'playbooks',
  title: 'Playbooks',
  mount(el) {
    root = el;
    el.innerHTML = `<header class="page-head"><div><p class="overline">System <span>·</span> playbooks</p><h2>How the decoy plays each scam</h2><p class="page-sub">The call is classified from its first lines, the matching persona takes over, and six stages steer the caller to say the UPI ID and account out loud.</p></div></header>
            <ol class="stage-strip" id="pb-stages"></ol>
      <div class="pb-grid" id="pb-list"><p class="empty">Loading playbooks…</p></div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-say]');
      if (!b) return;
      stopSpeaking();
      speak(b.dataset.say, { gender: b.dataset.gender });
    });
    api('/api/playbooks').then((p) => {
      books = p;
      render();
    });
  },
  update() {}
};

const GENDER = { Kamala: 'female', Ramesh: 'male', Arjun: 'male' };

function render() {
  $('#pb-stages', root).innerHTML = books[0].stages.map((s, i) => `<li><b>${i + 1}. ${esc(s.id[0] + s.id.slice(1).toLowerCase())}</b><span>${esc(s.goal)}</span></li>`).join('');
  $('#pb-list', root).innerHTML = books.map((b) => `<article class="panel pb" style="--accent-c:${scamColor(b.label)}">
    <header><h3>${esc(b.label)}</h3><span class="persona-tag">Persona: ${esc(b.persona.name)}${b.persona.age ? `, ${b.persona.age}` : ''}</span></header>
    <p>${esc(b.story)}</p>
    <div class="pb-cols">
      <div><h4>Red flags</h4><ul>${b.redFlags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h4>What they ask for</h4><ul>${b.asks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    </div>
    <h4>How ${esc(b.persona.name)} plays it</h4><ul>${b.tactics.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <h4>Sample lines <span class="muted small">(click to hear)</span></h4>
    <ul class="lines">${b.sampleLines.map((l) => `<li><button class="say-btn" data-say="${esc(l.replace(/\{sir\}/g, 'sir'))}" data-gender="${GENDER[b.persona.name] || 'female'}">▶</button>${esc(l.replace(/\{sir\}/g, 'sir'))}</li>`).join('')}</ul>
    <details><summary>Classifier cues (weight)</summary><ul class="cues">${b.cues.map((c) => `<li><code>${esc(c.pattern)}</code> <b>${c.weight}</b></li>`).join('')}</ul></details>
  </article>`).join('');
}
