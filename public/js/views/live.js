// Live decoy: the citizen merges a scam call in; the persona talks; intelligence builds up live.
import { $, esc, mmss, sleep, api, toast, rupees, ID_LABEL, ringColor } from '../util.js';
import { speak, stopSpeaking, warmUp, renderVoiceSettings, onVoices, LANG_TAG, onSpeechActivity, isSpeechPlaying, createVoiceProfile } from '../voice.js';
import { createRecognitionGate } from '../recognition.js';

const STAGE_LABEL = { HOOK: 'Hook', TRUST: 'Trust', PRESSURE: 'Pressure', PAYMENT: 'Payment ask', EXTRACT: 'Extract', STALL: 'Stall' };
const STAGE_GOAL = {
  HOOK: 'Let the caller explain; classify the scam within 3 to 4 turns.',
  TRUST: 'Sound like the ideal victim for this scam; invite the demand.',
  PRESSURE: 'Sound frightened and offer to "solve it", which pulls the payment ask forward.',
  PAYMENT: 'Agree to pay and ask exactly where to send the money.',
  EXTRACT: 'Get UPI ID, then account and IFSC; read each back so it is confirmed on tape.',
  STALL: 'Everything captured: waste their time with believable failures.'
};
const FLAG_LABEL = {
  threat: 'Threats (arrest, block, disconnection)', urgency: 'Artificial urgency', secrecy: 'Isolation: "do not disconnect / tell anyone"',
  otp: 'Asked for OTP / PIN', remoteApp: 'Asked to install a remote-access app', payment: 'Payment demand', personal: 'Asked for personal details'
};
const MEMORY_LABEL = { callerName: 'Caller said they are', officer: 'Officer named', place: 'Place mentioned', item: 'Alleged contraband', amount: 'Amount demanded', deadline: 'Deadline given', accountName: 'Account name given' };

let app, root, active = null, lastPersona = null, playbooks = [];

export const view = {
  id: 'live',
  title: 'Live decoy',
  mount(el, a) {
    app = a;
    root = el;
    el.innerHTML = `
    <header class="page-head">
      <div>
        <p class="overline">Live decoy <span>·</span> citizen merge line</p>
        <h2>Take a scam call</h2>
        <p class="page-sub">The citizen merges the suspicious call into the decoy number. The persona keeps the caller talking until they say where the money should go.</p>
      </div>
      <div class="page-head-side"><span class="state-chip" id="line-status">Line idle</span></div>
    </header>
    <div class="live-grid">
      <section class="panel call">
        <div id="reveal" class="reveal" hidden></div>
        <div id="call-idle" class="setup">
          <ol class="setup-steps">
            <li>
              <span class="step-n">1</span>
              <div class="step-body">
                <h3>Incoming call</h3>
                <div class="form-row">
                  <label class="field">Caller number (caller ID)<input id="caller" inputmode="tel" placeholder="+91 98401 23456" autocomplete="off"></label>
                  <label class="field">Persona language<select id="lang"><option value="en">English (India)</option><option value="hi">हिन्दी Hindi</option><option value="ta">தமிழ் Tamil</option></select></label>
                  <label class="field">Person on the call<select id="persona"><option value="teacher">Kamala · retired teacher</option><option value="shopowner">Ramesh · shop owner</option><option value="student">Arjun · student</option></select></label>
                </div>
              </div>
            </li>
            <li>
              <span class="step-n">2</span>
              <div class="step-body">
                <h3>Recording consent</h3>
                <label class="consent-row"><input type="checkbox" id="consent"><span><b>Citizen pressed 1 to consent</b><small>Recorded and analysed under the DPDP Act 2023. Calls cleared as not a scam are erased.</small></span></label>
              </div>
            </li>
            <li>
              <span class="step-n">3</span>
              <div class="step-body">
                <h3>Answer as the decoy</h3>
                <div class="answer-row">
                  <button class="answer primary" id="start-mic"><b>Answer with microphone</b><small>A teammate speaks as the scammer</small></button>
                  <button class="answer" id="start-text"><b>Answer, type as caller</b><small>No microphone needed</small></button>
                </div>
              </div>
            </li>
          </ol>
          <div class="call-settings">
            <section>
              <h4>Dialogue</h4>
              <div class="seg" id="dlg-mode"><button data-v="off">Playbook only</button><button data-v="ollama">Playbook + local AI</button></div>
              <p class="fine" id="dlg-note"></p>
            </section>
            <section>
              <h4>Persona voices</h4>
              <details class="voices"><summary>Choose and preview voices</summary><div id="voice-settings"></div></details>
            </section>
          </div>
        </div>
        <div id="call-live" class="live" hidden>
          <div class="persona">
            <div class="avatar" id="p-avatar">?</div>
            <div class="who"><strong id="p-name">Elderly voice</strong><span id="p-role">Neutral opener</span></div>
            <div class="scamtype" id="p-type"><span>Classifying…</span></div>
          </div>
          <div class="honeytoken" id="p-honey" hidden></div>
          <p id="call-voice" class="fine"></p>
          <ol class="stages" id="stages"></ol>
          <p class="reason" id="reason">Listening to the caller's opening.</p>
          <ol class="transcript" id="transcript" aria-live="polite"></ol>
          <div class="chips" id="chips" aria-label="Extracted identifiers"></div>
          <p id="mic-label" class="small muted" aria-live="polite">Text input</p>
          <form class="say" id="say-form">
            <span class="mic" id="mic-state" title="Microphone"></span>
            <input id="say" placeholder="Type what the caller says, then Enter" autocomplete="off">
            <button class="btn" type="submit">Send</button>
          </form>
          <div class="actions end">
            <span class="timer" id="timer">00:00</span>
            <span class="latency" id="latency" title="From the end of the caller's turn to the decoy starting to speak"></span>
            <button class="btn danger" id="end-call">End call &amp; link</button>
          </div>
        </div>
      </section>
      <aside class="live-side">
        <div id="side-idle">
          <section class="panel">
            <header class="panel-head"><h2>Rehearsal backup</h2><label class="switch"><input type="checkbox" id="speak-rehearsal" checked><span>Speak aloud</span></label></header>
            <p class="fine top">Scripted scammer calls for when the mic or venue audio fails. Play call 1, then call 2: they link into one ring.</p>
            <div id="rehearsal-buttons" class="script-list"></div>
          </section>
          <section class="panel">
            <header class="panel-head"><h2>How a call unfolds</h2></header>
            <ol class="flow-steps">
              <li><b>Hook</b><span>Caller explains; the scam type is classified in 3 to 4 turns</span></li>
              <li><b>Trust</b><span>Persona switches to the victim this scam expects</span></li>
              <li><b>Pressure</b><span>Sounds frightened and invites the payment demand</span></li>
              <li><b>Payment ask</b><span>Agrees to pay and asks where to send it</span></li>
              <li><b>Extract</b><span>UPI ID, account and IFSC, each read back on tape</span></li>
              <li><b>Stall</b><span>Believable failures keep the caller busy</span></li>
            </ol>
          </section>
          <section class="panel">
            <header class="panel-head"><h2>Guardrails in code</h2></header>
            <ul class="guard-list">
              <li>Never pays or claims to have paid</li><li>Never reads out an OTP or PIN</li><li>Never installs apps or opens links</li>
              <li>Never calls out</li><li>No tracking links or hack-back</li>
            </ul>
          </section>
        </div>
        <section class="panel intel" id="side-live" hidden>
          <header class="panel-head"><h2>Live intelligence</h2><span class="muted small" id="intel-call"></span></header>
          <div id="intel-body"></div>
        </section>
      </aside>
    </div>`;

    $('#start-mic', el).onclick = () => begin({ mode: 'mic' });
    $('#start-text', el).onclick = () => begin({ mode: 'text' });
    $('#end-call', el).onclick = () => finish(active?.mode === 'rehearsal' ? { rehearsalSpeaker: 'rehearsal-A' } : {});
    $('#say-form', el).onsubmit = (e) => {
      e.preventDefault();
      const text = $('#say', el).value.trim();
      $('#say', el).value = '';
      if (active) active.lastHeardAt = performance.now();
      if (text) sendTurn(text);
    };
    const voiceBox = $('#voice-settings', el);
    const refreshVoices = () => renderVoiceSettings(voiceBox, $('#lang', el).value);
    $('#lang', el).onchange = refreshVoices;
    onVoices(refreshVoices);
    refreshVoices();
    api('/api/playbooks').then((p) => (playbooks = p)).catch(() => {});
    const dlg = $('#dlg-mode', el);
    const showMode = (s) => {
      dlg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.dialogue === 'ollama' ? 'ollama' : 'off')));
      $('#dlg-note', el).textContent = s.dialogue === 'ollama'
        ? `Local model ${s.local?.model || ''} adds a short reaction to English caller speech; the playbook preserves the next move. Unsupported languages and unavailable replies use the playbook. Actual response time appears during the call.`
        : `Playbook dialogue is ready offline. ${s.local?.downloaded ? 'The local model is downloaded and available to enable.' : 'Run "npm run start:ai" to make the local model available.'}`;
    };
    api('/api/settings').then(showMode).catch(() => {});
    dlg.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      b.disabled = true;
      try {
        await api('/api/settings', { dialogue: b.dataset.v });
        showMode(await api('/api/settings'));
        toast(b.dataset.v === 'ollama' ? 'Local AI reactions on' : 'Playbook-only dialogue');
      } catch (err) {
        toast(err.message, 'warn');
      }
      b.disabled = false;
    };
  },
  update(state) {
    const box = $('#rehearsal-buttons', root);
    if (!box.childElementCount) {
      for (const script of state.rehearsal) {
        const [name, story] = script.title.split(' · ');
        const b = document.createElement('button');
        b.className = 'script-card';
        b.innerHTML = `<span class="sc-n">${esc(name)}</span><span class="sc-t">${esc(story || '')}</span><span class="sc-m">${esc(script.callerNumber)} · ${script.lines.length} caller lines</span><span class="sc-go">Play</span>`;
        b.onclick = () => runRehearsal(script);
        box.appendChild(b);
      }
    }
    if (active) {
      const call = state.calls.find((c) => c.id === active.id);
      if (call) renderCall(call);
    }
  },
  isBusy: () => Boolean(active)
};

// ---------- Rendering ----------
function renderCall(call) {
  active.call = call;
  const p = call.persona;
  const av = $('#p-avatar', root);
  av.textContent = p.id === 'neutral' ? '?' : p.name[0];
  if (lastPersona && lastPersona !== p.id) {
    av.classList.remove('switched');
    void av.offsetWidth;
    av.classList.add('switched');
  }
  lastPersona = p.id;
  $('#p-name', root).textContent = p.age ? `${p.name}, ${p.age}` : p.name;
  $('#p-role', root).textContent = p.role;
  $('#p-type', root).innerHTML = call.scamLabel ? `<span class="hit">${esc(call.scamLabel)}</span><small>confidence ${Math.round(call.scamConfidence * 100)}%${call.relabels?.length ? ` · was ${esc(call.relabels[0].from)}` : ''}</small>` : '<span>Classifying…</span>';
  const ht = call.honeytoken;
  $('#p-honey', root).hidden = !ht;
  if (ht) $('#p-honey', root).innerHTML = `Honeytoken identity <b>${esc(ht.fullName)}</b>, ${esc(ht.address)}. If another call ever quotes it back, both calls share a data source.`;
  const reached = call.stages.indexOf(call.maxStage);
  $('#stages', root).innerHTML = call.stages.map((s, i) => `<li class="${s === call.stage ? 'now' : i <= reached ? 'done' : ''}">${STAGE_LABEL[s]}</li>`).join('');
  const last = call.events[call.events.length - 1];
  if (last) $('#reason', root).textContent = last.reason;
  const ids = call.identifiers.filter((x) => x.type !== 'email');
  const marks = ids.filter((x) => x.type !== 'amount').map((x) => x.value);
  const t = $('#transcript', root);
  const interim = t.querySelector('.interim');
  t.innerHTML = call.turns.map((x) => `<li class="${x.speaker}"><span class="t">${mmss(x.t)} · ${x.speaker === 'scammer' ? 'Caller' : esc(p.id === 'neutral' ? 'Decoy' : p.name)}</span>${x.speaker === 'scammer' ? highlight(x.text, marks) : esc(x.text)}</li>`).join('');
  if (interim) t.appendChild(interim);
  t.scrollTop = t.scrollHeight;
  $('#chips', root).innerHTML = ids.map((x) => {
    let check = '';
    if (x.type === 'ifsc') check = x.meta?.valid ? `<span class="ok">✓ ${esc(x.meta.bank)}</span>` : `<span class="bad">✗ ${esc(x.meta?.reason)}</span>`;
    if (x.type === 'upi') check = x.meta?.knownHandle ? '<span class="ok">✓ known handle</span>' : '<span class="bad">? handle</span>';
    const known = active.hits?.some((h) => h.value === x.value);
    const value = x.type === 'amount' ? rupees(x.value) : x.value;
    return `<span class="chip ${x.type} ${known ? 'known' : ''}"><i>${ID_LABEL[x.type]}</i><code>${esc(value)}</code>${check}${x.mentions > 1 ? `<i>×${x.mentions}</i>` : ''}${known ? '<i class="kn">known mule</i>' : ''}</span>`;
  }).join('');
  renderIntel(call);
}

function renderIntel(call) {
  $('#intel-call', root).textContent = call.id;
  const hits = active.hits || [];
  const callerHit = active.callerHits?.[0];
  const flags = Object.entries(call.flags || {}).filter(([k]) => FLAG_LABEL[k] && k !== 'payment');
  const mem = call.memory || {};
  const facts = Object.entries(MEMORY_LABEL).filter(([k]) => mem[k]).map(([k, label]) => [label, k === 'amount' ? rupees(mem[k]) : mem[k]]);
  if (mem.agencies?.length) facts.unshift(['Claims to be from', mem.agencies.join(', ')]);
  const guards = call.events.filter((e) => /guardrail|OTP|remote-access/i.test(e.reason));
  const book = playbooks.find((b) => b.type === call.scamType);
  const mules = call.identifiers.filter((x) => ['upi', 'account', 'ifsc', 'phone', 'url'].includes(x.type));
  $('#intel-body', root).innerHTML = `
    <section class="intel-card ${callerHit ? 'alert' : ''}">
      <h3>Caller ID check</h3>
      ${call.callerNumber ? (callerHit ? `<p><b>${esc(call.callerNumber)}</b> has called the decoy before: ring <a href="#/rings/${esc(callerHit.ringId)}">${esc(callerHit.ringId)}</a> (${callerHit.ringCalls} calls).</p>` : `<p><b>${esc(call.callerNumber)}</b> is new to Chakravyuh. Watching for voice, account and UPI matches.</p>`) : '<p class="muted">No caller ID given.</p>'}
    </section>
    ${hits.length ? `<section class="intel-card alert"><h3>Known mule identifiers</h3>${hits.map((h) => `<p><code>${esc(h.value)}</code> was already given in ${h.callIds.length} earlier call${h.callIds.length > 1 ? 's' : ''}: ring <a href="#/rings/${esc(h.ringId)}">${esc(h.ringId)}</a> (${h.ringCalls} calls).</p>`).join('')}<p class="small">This call will join that ring at hang-up. Its case gets an updated dossier and a fresh golden hour.</p></section>` : ''}
    <section class="intel-card">
      <h3>Mule identifiers (${mules.length})</h3>
      ${mules.length ? `<table class="mini"><tbody>${mules.map((x) => `<tr><td>${ID_LABEL[x.type]}</td><td><code>${esc(x.value)}</code></td><td class="muted">${mmss(x.firstAt || 0)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None yet. The playbook steers toward the payment step.</p>'}
    </section>
    <section class="intel-card">
      <h3>Playbook${book ? `: ${esc(book.label)}` : ''}</h3>
      <p><b>${STAGE_LABEL[call.stage]}.</b> ${STAGE_GOAL[call.stage]}</p>
      ${book ? `<p class="small muted">Persona ${esc(book.persona.name)}, ${esc(book.persona.role)}. <a href="#/playbooks">Full playbook</a></p>` : ''}
    </section>
    <section class="intel-card">
      <h3>Red flags heard</h3>
      ${flags.length ? `<ul class="flags">${flags.map(([k, n]) => `<li>${esc(FLAG_LABEL[k])}${n > 1 ? ` <span class="muted">×${n}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}
    </section>
    <section class="intel-card">
      <h3>What the caller told us</h3>
      ${facts.length ? `<table class="mini"><tbody>${facts.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">The persona remembers names, agencies, places and amounts and uses them later in the call.</p>'}
    </section>
    ${guards.length ? `<section class="intel-card"><h3>Guardrails triggered</h3><ul class="flags">${guards.map((g) => `<li>${mmss(g.t)} ${esc(g.reason)}</li>`).join('')}</ul></section>` : ''}`;
}

function highlight(text, marks) {
  let out = esc(text);
  for (const m of marks) out = out.replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (s) => `<mark>${s}</mark>`);
  return out;
}

function setMic(cls) {
  $('#mic-state', root).className = `mic ${cls || ''}`;
  $('#mic-label', root).textContent = cls === 'speaking' ? 'Microphone paused for app speech' : cls === 'on' ? 'Listening to caller' : active?.mode === 'mic' ? 'Microphone off' : 'Text input';
}

// ---------- Speaking ----------
function markLatency() {
  if (!active?.lastHeardAt) return;
  const ms = Math.round(performance.now() - active.lastHeardAt);
  active.lastHeardAt = null;
  active.latencies = [...(active.latencies || []), ms];
  const avg = Math.round(active.latencies.reduce((s, x) => s + x, 0) / active.latencies.length);
  $('#latency', root).textContent = `reply in ${ms} ms · avg ${avg} ms`;
}

async function decoySpeaks(text) {
  if (!active || active.mute) return;
  const p = active.call?.persona?.voice || {};
  active.speaking = true;
  active.spoken = `${active.spoken || ''} ${text}`.slice(-600);
  if (active.capture) active.capture.paused = true; // keep our own voice out of the caller's voiceprint
  if (rec) setMic('speaking');
  await sleep(40 + Math.random() * 100);
  await speak(text, { lang: active.lang, profile: active.voiceProfile, rate: p.rate || 0.96, gender: p.gender || 'female', onstart: markLatency });
  if (!active) return;
  active.speaking = false;
  active.spokeUntil = performance.now();
}

// ---------- Listening (live mic) ----------
// Pause recognition for every app utterance (including fillers and voice previews).
// Fresh sessions discard queued results from before playback; a tail buffer drains echoes.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, buffer = '', interimText = '', flushTimer = null, consumeInterim = null;
const wordsOf = (s) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
onSpeechActivity((playing) => {
  if (active?.capture) active.capture.paused = playing || Boolean(rec);
  if (!rec) return;
  if (playing) {
    rec.hold();
    clearTimeout(flushTimer);
    buffer = ''; interimText = ''; consumeInterim = null;
    showInterim('');
  } else rec.release();
});

function startListening() {
  if (!SR) {
    $('#reason', root).textContent = 'This browser has no speech recognition. Use Chrome or Edge, or type the caller\'s words.';
    return;
  }
  rec?.stop();
  buffer = ''; interimText = ''; consumeInterim = null;
  rec = createRecognitionGate({ Recognition: SR, lang: LANG_TAG[active.lang], onState: (state) => {
    if (active?.capture) active.capture.paused = state !== 'on';
    setMic(state === 'off' ? '' : state);
    $('#mic-state', root).title = state === 'speaking' ? 'Microphone paused during app speech and echo buffer. Wait for listening before speaking.' : state === 'on' ? 'Listening to caller' : 'Microphone off';
  }, onResult: ({ final: finalText, interim, consumeInterim: consume }) => {
    if (!active || active.stopped) return;
    const heard = (finalText + ' ' + interim).trim();
    if (!heard) return;
    consumeInterim = consume;
    buffer += finalText;
    interimText = interim;
    active.lastHeardAt = performance.now();
    showInterim((buffer + ' ' + interim).trim());
    clearTimeout(flushTimer);
    const n = wordsOf(buffer + ' ' + interim).length;
    flushTimer = setTimeout(flush, interim ? (n >= 8 ? 700 : 900) : n <= 2 ? 650 : 280);
  }, onError: (e) => {
    if (e.error === 'not-allowed') $('#reason', root).textContent = 'Microphone blocked. Allow it in the address bar, or type the caller\'s words.';
    else if (e.error !== 'aborted' && e.error !== 'no-speech') $('#reason', root).textContent = `Speech recognition unavailable (${e.error}). You can type the caller's words.`;
  } });
  if (isSpeechPlaying()) rec.hold();
  rec.start();
}

function showInterim(text) {
  const t = $('#transcript', root);
  let li = t.querySelector('.interim');
  if (!text) return li?.remove();
  if (!li) {
    li = document.createElement('li');
    li.className = 'scammer interim';
    t.appendChild(li);
  }
  li.textContent = text;
  t.scrollTop = t.scrollHeight;
}

async function flush() {
  const text = (buffer + ' ' + interimText).trim();
  if (interimText) consumeInterim?.();
  buffer = '';
  interimText = '';
  showInterim('');
  if (text) await sendTurn(text);
}

// ---------- Call flow ----------
async function begin({ mode, callerNumber, lang, channel = 'citizen-merge', mute = false }) {
  if (active) return;
  const consent = channel === 'rehearsal' || $('#consent', root).checked;
  if (!consent) {
    toast('Tick the consent box: the decoy only joins calls the citizen agreed to record.', 'warn');
    $('#consent', root).focus();
    return;
  }
  $('#reveal', root).hidden = true;
  let res;
  try {
    res = await api('/api/calls', { callerNumber: callerNumber ?? $('#caller', root).value, lang: lang || $('#lang', root).value, channel, consent, personaId: $('#persona', root).value });
  } catch (err) {
    return toast(err.message, 'warn');
  }
  const { call, reply, hits } = res;
  active = { id: call.id, mode, lang: call.lang, call, startedAt: Date.now(), mute, callerHits: hits, hits: [] };
  const thisCall = active;
  active.voiceProfile = await createVoiceProfile({ lang: call.lang, gender: call.persona.voice?.gender || 'female', rate: call.persona.id === 'student' ? 1 : 0.96 });
  if (active !== thisCall || thisCall.stopped) return;
  $('#call-voice', root).textContent = `Voice locked for this call: ${active.voiceProfile.name}${active.voiceProfile.natural ? '' : ' · Browser voice quality; choose a natural voice before the next call if available.'}`;
  lastPersona = call.persona.id;
  $('#call-idle', root).hidden = true;
  $('#call-live', root).hidden = false;
  $('#line-status', root).textContent = `Live · ${call.id}`;
  $('#line-status', root).className = 'state-chip live';
  $('#side-idle', root).hidden = true;
  $('#side-live', root).hidden = false;
  app.setLive(call.id);
  $('#reason', root).textContent = `Answering as ${call.persona.name}. This person and voice stay consistent throughout the call.`;
  $('#say', root).placeholder = mode === 'rehearsal' ? 'Rehearsal is playing…' : 'Type what the caller says, then Enter';
  $('#say', root).disabled = mode === 'rehearsal';
  $('#latency', root).textContent = '';
  renderCall(call);
  if (hits?.length) toast(`Caller ID ${call.callerNumber} is already in ring ${hits[0].ringId}`, 'alert');
  active.tick = setInterval(() => ($('#timer', root).textContent = mmss((Date.now() - active.startedAt) / 1000)), 500);
  if (!mute) warmUp();
  if (mode === 'mic') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      active.stream = stream;
      active.capture = new window.VoiceprintCapture();
      await active.capture.start(stream);
    } catch {
      $('#reason', root).textContent = 'No microphone access: voiceprint off. Speech recognition may still work.';
    }
    startListening();
  } else setMic('');
  await decoySpeaks(reply);
}

async function sendTurn(text) {
  if (!active || active.stopped) return;
  if (active.speaking) stopSpeaking();
  let res;
  try {
    res = await api(`/api/calls/${active.id}/turn`, { text });
  } catch (err) {
    return toast(err.message, 'warn');
  }
  if (!active || active.stopped) return;
  if (res.hits?.length) {
    active.hits = [...active.hits, ...res.hits];
    for (const h of res.hits) toast(`Known mule: ${h.value} is already in ring ${h.ringId}`, 'alert');
  }
  renderCall(res.call);
  await decoySpeaks(res.reply);
}

async function finish(extra = {}) {
  if (!active) return;
  const a = active;
  a.stopped = true;
  clearInterval(a.tick);
  clearTimeout(flushTimer);
  if (buffer.trim()) await flush();
  if (rec) { rec.stop(); rec = null; }
  stopSpeaking();
  const voiceprint = a.capture ? a.capture.result() : null;
  a.stream?.getTracks().forEach((t) => t.stop());
  setMic('');
  let res;
  try {
    res = await api(`/api/calls/${a.id}/end`, { voiceprint, ...extra });
  } catch (err) {
    toast(err.message, 'warn');
  }
  active = null;
  app.setLive(null);
  $('#call-live', root).hidden = true;
  $('#call-idle', root).hidden = false;
  $('#line-status', root).textContent = 'Line idle';
  $('#line-status', root).className = 'state-chip';
  $('#side-live', root).hidden = true;
  $('#side-idle', root).hidden = false;
  if (res) showReveal(res.reveal, res.call);
}

function showReveal(r, call) {
  const box = $('#reveal', root);
  box.hidden = false;
  const mules = call.identifiers.filter((x) => x.type === 'upi' || x.type === 'account').length;
  const mins = ((call.endedAt - call.startedAt) / 60000).toFixed(1);
  const stats = `<p class="small">${mins} min of scammer time absorbed · ${mules} mule identifier${mules === 1 ? '' : 's'} · dossier ready in ${Math.max(1, Math.round(call.dossierMs || 0))} ms · golden hour ends ${new Date(r.case.goldenHour.deadline).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</p>`;
  if (r.linked && r.links.length) {
    const others = [...new Set(r.links.flatMap((l) => l.callIds))].filter((c) => c !== r.callId);
    box.innerHTML = `<h3 style="--ring:${ringColor(r.ringId)}">${esc(r.callId)} joins ring ${esc(r.ringId)}</h3>
      <p>Same ring as ${others.map(esc).join(', ')}. The ring now has ${r.ringSize} calls from ${r.numbers} different numbers. Shared evidence:</p>
      <ul>${r.links.map((l) => `<li><strong>${esc(l.typeLabel)}</strong> <code>${esc(l.label)}</code>${l.type === 'voice' && r.voice?.score ? ` (similarity ${r.voice.score.toFixed(2)})` : ''}</li>`).join('')}</ul>${stats}
      <div class="actions"><a class="btn primary" href="/dossier/${encodeURIComponent(r.ringId)}" target="_blank">Open 1930 dossier</a><a class="btn" href="#/rings/${encodeURIComponent(r.ringId)}">See ring</a><a class="btn" href="#/cases">Case board</a></div>`;
  } else {
    box.innerHTML = `<h3>${esc(r.callId)} recorded as a new pattern</h3>
      <p>No shared voice, number, UPI ID, account or honeytoken yet. It links automatically the moment any of them shows up in another call.</p>${stats}
      <div class="actions"><a class="btn primary" href="/dossier/${encodeURIComponent(r.ringId)}" target="_blank">Open 1930 dossier</a><a class="btn" href="#/rings/${encodeURIComponent(r.ringId)}">See in graph</a></div>`;
  }
  app.pulse([`call:${r.callId}`, ...r.links.map((l) => l.nodeId), ...r.links.flatMap((l) => l.callIds.map((c) => `call:${c}`))]);
}

async function runRehearsal(script) {
  if (active) return;
  const aloud = $('#speak-rehearsal', root).checked;
  await begin({ mode: 'rehearsal', callerNumber: script.callerNumber, lang: 'en', channel: 'rehearsal', mute: !aloud });
  const me = active;
  if (!me) return;
  const callerVoice = aloud ? await createVoiceProfile({ lang: 'en', gender: 'male', rate: 1.02, exclude: me.voiceProfile?.voice }) : null;
  for (const line of script.lines) {
    if (me.stopped) return;
    showInterim(line);
    if (aloud) await speak(line, { profile: callerVoice });
    else await sleep(1000);
    showInterim('');
    if (me.stopped) return;
    me.lastHeardAt = performance.now();
    await sendTurn(line);
    if (!aloud) await sleep(700);
  }
  await sleep(500);
  if (!me.stopped) await finish({ rehearsalSpeaker: 'rehearsal-A' });
}
