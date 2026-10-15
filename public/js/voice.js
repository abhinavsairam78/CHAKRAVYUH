// Text-to-speech engine for the personas: best available voice per language and gender (neural
// "Natural" voices win), human-style readbacks, one utterance per reply for zero gaps.
import { esc, sleep } from './util.js';

export const synth = window.speechSynthesis;
let voices = [];
const listeners = new Set();
const loadVoices = () => {
  voices = synth ? synth.getVoices() : [];
  listeners.forEach((fn) => fn());
};
loadVoices();
if (synth) synth.addEventListener?.('voiceschanged', loadVoices);
export const onVoices = (fn) => listeners.add(fn);

const FEMALE = /neerja|heera|swara|kalpana|pallavi|female|zira|aditi|raveena|veena|priya|ananya|hemlata|sonia|aria|jenny|kajal|google हिन्दी/i;
const MALE = /prabhat|ravi|hemant|madhur|valluvar|\bmale\b|david|mark|rishi|guy|kumar|aarav|arjun/i;
const prefs = (() => { try { return JSON.parse(localStorage.getItem('ckv-voices') || '{}'); } catch { return {}; } })();
export const LANG_TAG = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN' };

function scoreVoice(v, lang, gender) {
  const l = v.lang.toLowerCase();
  const want = LANG_TAG[lang].toLowerCase();
  let s = l === want ? 50 : l.startsWith(want.slice(0, 2)) ? 40 : lang !== 'en' && l === 'en-in' ? 5 : lang === 'en' && l.startsWith('en') ? 20 : -100;
  if (/natural|neural/i.test(v.name)) s += 45;
  else if (/online/i.test(v.name)) s += 25;
  else if (/google/i.test(v.name)) s += 12;
  if (gender === 'male') s += MALE.test(v.name) ? 20 : FEMALE.test(v.name) ? -30 : 0;
  else s += FEMALE.test(v.name) ? 20 : MALE.test(v.name) ? -30 : 0;
  return s;
}

export function rankVoices(lang, gender) {
  return voices.map((v) => [v, scoreVoice(v, lang, gender)]).filter(([, s]) => s > -50).sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

export function pickVoice(lang, gender, exclude) {
  const chosen = prefs[`${lang}-${gender}`] && voices.find((v) => v.name === prefs[`${lang}-${gender}`]);
  if (chosen && chosen !== exclude) return chosen;
  return rankVoices(lang, gender).find((v) => v !== exclude) || null;
}

export const isNatural = (v) => /natural|neural|online/i.test(v?.name || '');

// Say it the way a person would: digits one by one, bank codes spelled out.
const KEEP = new Set(['my', 'by', 'why', 'try', 'fly', 'shy', 'sky', 'dry', 'cry', 'hmm', 'hm', 'mm', 'sh', 'mr', 'mrs', 'ms', 'st', 'nd', 'rd', 'th', 'gym', 'rhythm', 'pvt', 'ltd']);
const SPELL = new Set(['rbi', 'sbi', 'upi', 'kyc', 'ifsc', 'otp', 'pan', 'ybl', 'ibl', 'axl', 'apl', 'hdfc', 'icici', 'cbi', 'neft', 'imps', 'atm', 'cvv', 'emi', 'gst', 'tneb', 'ncb', 'ed', 'id']);
export function speakable(text) {
  return text
    .replace(/\d{2,}/g, (d) => d.split('').join(' '))
    .replace(/\bok(axis|sbi|hdfcbank|icici)\b/gi, 'ok $1')
    .replace(/\bhdfcbank\b/gi, 'hdfc bank')
    .replace(/\b[a-z]{2,5}\b/gi, (w) => (SPELL.has(w.toLowerCase()) || (/^[bcdfghjklmnpqrstvwxyz]+$/i.test(w) && !KEEP.has(w.toLowerCase())) ? w.toUpperCase().split('').join(' ') : w));
}

export const FILLERS = {
  en: { elder: ['Hmm...', 'Haan...', 'Acha...', 'Arre...', 'Oh...'], young: ['Uh...', 'Okay...', 'Haan...'] },
  hi: { elder: ['हम्म...', 'अच्छा...', 'अरे...', 'हाँ...'], young: ['अच्छा...', 'हाँ...'] },
  ta: { elder: ['ம்ம்...', 'சரி...', 'அய்யோ...'], young: ['சரி...', 'ம்ம்...'] }
};

let current = null;
const playbackListeners = new Set();
export const isSpeechPlaying = () => current !== null;
export function onSpeechActivity(listener) { playbackListeners.add(listener); return () => playbackListeners.delete(listener); }
function notifyPlayback(playing) { for (const listener of playbackListeners) listener(playing); }

export function speak(text, { lang = 'en', rate = 0.94, pitch = 1, gender = 'female', exclude, filler = false, young = false, onstart } = {}) {
  if (!synth) return sleep(600);
  stopSpeaking();
  const voice = pickVoice(lang, gender, exclude);
  let said = speakable(text);
  if (filler && Math.random() < 0.4 && !/^(okay|haan|hmm|acha|arre|oh|wait|हाँ|अच्छा|अरे|சரி)/i.test(text)) {
    const set = FILLERS[lang] || FILLERS.en;
    const list = young ? set.young : set.elder;
    said = `${list[Math.floor(Math.random() * list.length)]} ${said}`;
  }
  return new Promise((resolve) => {
    const me = { done: false };
    let watchdog;
    const finish = () => {
      if (me.done) return;
      me.done = true;
      clearTimeout(watchdog);
      if (current === me) { current = null; notifyPlayback(false); }
      resolve();
    };
    me.resolve = finish;
    current = me;
    notifyPlayback(true);
    // One utterance per reply: separate utterances add a 200-500 ms gap each on Windows voices.
    const u = new SpeechSynthesisUtterance(said);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || LANG_TAG[lang];
    u.rate = rate * (0.97 + Math.random() * 0.06);
    u.pitch = isNatural(voice) ? 1 : pitch;
    if (onstart) u.onstart = onstart;
    u.onend = finish;
    u.onerror = finish;
    try { synth.speak(u); } catch { finish(); }
    if (!me.done) watchdog = setTimeout(() => {
      if (current === me) synth.cancel();
      finish();
    }, 2000 + text.length * 110); // Stop stuck playback before allowing the mic to resume.
  });
}

export function stopSpeaking() {
  synth?.cancel();
  current?.resolve();
}

export function warmUp() {
  if (!synth) return;
  const w = new SpeechSynthesisUtterance(' ');
  w.volume = 0;
  synth.speak(w);
}

const SAMPLE = {
  en: 'Hello? Haan... who is speaking, please? One minute, the line is not clear.',
  hi: 'हेलो? हाँ... कौन बोल रहा है? एक मिनट, ठीक से सुनाई नहीं दे रहा।',
  ta: 'ஹலோ? ம்ம்... யார் பேசுறீங்க? ஒரு நிமிஷம், லைன் சரியா கேக்கலை.'
};

// Voice picker: best installed voice per persona gender, with preview; remembered per laptop.
export function renderVoiceSettings(box, lang) {
  if (!box) return;
  if (!voices.length) return (box.innerHTML = '<p class="fine">Loading voices…</p>');
  const row = (gender, label) => {
    const ranked = rankVoices(lang, gender);
    const cur = pickVoice(lang, gender);
    return `<label class="field">${label}
      <span class="voice-row"><select data-gender="${gender}">${ranked.map((v) => `<option ${v === cur ? 'selected' : ''} value="${esc(v.name)}">${esc(v.name.replace(/^Microsoft /, ''))} · ${esc(v.lang)}</option>`).join('') || '<option>No voice for this language</option>'}</select>
      <button type="button" class="btn sm" data-preview="${gender}">Preview</button></span></label>`;
  };
  const best = pickVoice(lang, 'female');
  box.innerHTML = row('female', 'Women (Kamala)') + row('male', 'Men (Ramesh, Arjun)') +
    (isNatural(best) ? '<p class="fine ok">Neural voices in use.</p>' : '<p class="fine">Only basic voices on this browser. Open the console in Microsoft Edge for neural Indian voices (Neerja, Prabhat, Swara, Madhur, Pallavi, Valluvar); they need internet.</p>');
  box.querySelectorAll('select').forEach((sel) => (sel.onchange = () => {
    prefs[`${lang}-${sel.dataset.gender}`] = sel.value;
    try { localStorage.setItem('ckv-voices', JSON.stringify(prefs)); } catch {}
  }));
  box.querySelectorAll('[data-preview]').forEach((b) => (b.onclick = () => {
    stopSpeaking();
    speak(SAMPLE[lang] || SAMPLE.en, { lang, gender: b.dataset.preview });
  }));
}
