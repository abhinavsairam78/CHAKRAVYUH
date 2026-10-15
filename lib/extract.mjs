// Pulls mule identifiers (UPI IDs, bank accounts, IFSC, phone numbers, links, amounts) out of
// speech-to-text output. Scammers spell details out loud ("V E R I F Y dot R B I at the rate okaxis"),
// so the text is first normalized from spoken form into written form.

import { checkIfsc } from './ifsc.mjs';

export const UPI_HANDLES = new Set([
  'ybl', 'ibl', 'axl', 'okaxis', 'oksbi', 'okhdfcbank', 'okicici', 'paytm', 'ptyes', 'ptsbi', 'pthdfc', 'ptaxis',
  'upi', 'apl', 'yapl', 'rapl', 'axisbank', 'icici', 'hdfcbank', 'sbi', 'kotak', 'kmbl', 'pnb', 'barodampay', 'unionbank',
  'cnrb', 'idfcfirst', 'indus', 'federal', 'aubank', 'jupiteraxis', 'freecharge', 'airtel', 'jio', 'fbl', 'yesbank',
  'ikwik', 'waaxis', 'wahdfcbank', 'waicici', 'wasbi', 'timecosmos', 'abfspay', 'axisb', 'naviaxis', 'superyes'
]);

const EN_DIGITS = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
const HI_DIGITS = {
  shunya: '0', sunya: '0', ek: '1', do: '2', teen: '3', char: '4', chaar: '4', paanch: '5', panch: '5', chhe: '6', chhah: '6',
  saat: '7', aath: '8', nau: '9',
  'பூஜ்ஜியம்': '0', 'சைபர்': '0', 'ஒன்று': '1', 'ஒண்ணு': '1', 'இரண்டு': '2', 'ரெண்டு': '2', 'மூன்று': '3', 'மூணு': '3', 'நான்கு': '4', 'நாலு': '4',
  'ஐந்து': '5', 'அஞ்சு': '5', 'ஆறு': '6', 'ஏழு': '7', 'எட்டு': '8', 'ஒன்பது': '9',
  'शून्य': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पांच': '5', 'पाँच': '5', 'छह': '6', 'छः': '6', 'सात': '7', 'आठ': '8', 'नौ': '9'
};
const GLUE = { '⟨AT⟩': '@', '⟨DOT⟩': '.', '⟨US⟩': '_', '⟨DASH⟩': '-' };
const SPELL = /^[a-z]$|^\d+$/;
const WORDISH = /^[a-z0-9][a-z0-9._-]*$/;

export function normalizeSpoken(text) {
  let s = ` ${String(text || '').toLowerCase()} `
    .replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d)))
    .replace(/\s(?:at the rate of|at the rate|at rate|at d rate|एट द रेट|ऐट द रेट|एट दा रेट|அட் தி ரேட்|அட் த ரேட்)\s/g, ' ⟨AT⟩ ')
    .replace(/\s(?:dot|डॉट|डोट|டாட்)\s/g, ' ⟨DOT⟩ ')
    .replace(/\s(?:underscore|अंडरस्कोर)\s/g, ' ⟨US⟩ ')
    .replace(/\s(?:hyphen|dash)\s/g, ' ⟨DASH⟩ ');
  // Re-run once: adjacent spoken symbols share a separating space ("r dot b dot i").
  s = s.replace(/\s(?:dot|डॉट)\s/g, ' ⟨DOT⟩ ');

  // Tokenize, splitting trailing punctuation into its own (run-breaking) token.
  let tokens = [];
  for (const raw of s.split(/\s+/).filter(Boolean)) {
    const m = raw.match(/^(.*?)([,;:!?।]+|\.+)?$/);
    let core = m[1];
    if (core.includes('@') || /^[a-z0-9]/.test(core)) core = core.replace(/[,]/g, '');
    if (core) tokens.push(core);
    if (m[2]) tokens.push('⟨P⟩');
  }

  // English number words, with "double five" / "triple nine".
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = EN_DIGITS[tokens[i + 1]] ?? (/^\d$/.test(tokens[i + 1] || '') ? tokens[i + 1] : null);
    if ((t === 'double' || t === 'triple') && next != null) {
      out.push(...Array(t === 'double' ? 2 : 3).fill(next));
      i++;
    } else out.push(EN_DIGITS[t] ?? t);
  }
  tokens = out;

  // Hindi number words only inside a run of 3+ number tokens ("do" is also an English word).
  const isNumTok = (t) => /^\d+$/.test(t) || t in HI_DIGITS;
  for (let i = 0; i < tokens.length;) {
    let j = i;
    while (j < tokens.length && isNumTok(tokens[j])) j++;
    if (j - i >= 3) for (let k = i; k < j; k++) tokens[k] = HI_DIGITS[tokens[k]] ?? tokens[k];
    i = Math.max(j, i + 1);
  }

  // Join spelled-out runs: "h d f c 0 0 0 1 2 3 4" -> "hdfc0001234", "98401 23456" -> "9840123456".
  const joined = [];
  for (let i = 0; i < tokens.length;) {
    let j = i;
    while (j < tokens.length && SPELL.test(tokens[j])) j++;
    const run = tokens.slice(i, j);
    if (run.length >= 3 || (run.length === 2 && run.every((t) => /^\d+$/.test(t)))) {
      joined.push(run.join(''));
      i = j;
    } else {
      joined.push(tokens[i]);
      i++;
    }
  }
  tokens = joined;

  // "raju at ybl" -> spoken @ when the right side is a known UPI handle.
  for (let i = 1; i < tokens.length - 1; i++) {
    if ((tokens[i] === 'at' || tokens[i] === 'एट') && WORDISH.test(tokens[i - 1]) && UPI_HANDLES.has(tokens[i + 1])) tokens[i] = '⟨AT⟩';
  }

  // Glue spoken symbols to their neighbours: "verify ⟨DOT⟩ rbi ⟨AT⟩ okaxis" -> "verify.rbi@okaxis".
  const glued = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (GLUE[t] && glued.length && WORDISH.test(glued[glued.length - 1]) && WORDISH.test(tokens[i + 1] || '')) {
      glued[glued.length - 1] += GLUE[t] + tokens[i + 1];
      i++;
    } else glued.push(t);
  }
  return glued.map((t) => (t === '⟨P⟩' ? ',' : GLUE[t] ?? t)).join(' ').replace(/ ,/g, ',');
}

const ACCOUNT_CONTEXT = /(account|a\/c|acct|khata|खाता|अकाउंट|neft|imps|rtgs|transfer|அக்கவுண்ட்|கணக்கு)/;
const PHONE_CONTEXT = /(call|phone|number|mobile|whatsapp|contact|फोन|नंबर)/;

function context(text, index, width = 70) {
  return text.slice(Math.max(0, index - width), index);
}

export function extractIdentifiers(text) {
  const n = normalizeSpoken(text);
  const ids = [];
  const seen = new Set();
  const add = (item) => {
    const key = `${item.type}:${item.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    ids.push(item);
  };
  const taken = []; // spans already claimed by a higher-priority identifier
  const overlaps = (a, b) => taken.some(([s, e]) => a < e && b > s);

  for (const m of n.matchAll(/(?<![a-z0-9._-])([a-z0-9][a-z0-9._-]{0,48}[a-z0-9]|[a-z0-9])@([a-z][a-z0-9]{1,24})((?:\.[a-z]{2,})*)/g)) {
    taken.push([m.index, m.index + m[0].length]);
    if (m[3]) {
      add({ type: 'email', value: m[0], confidence: 0.9 });
      continue;
    }
    const known = UPI_HANDLES.has(m[2]);
    add({ type: 'upi', value: `${m[1]}@${m[2]}`, confidence: known ? 0.95 : 0.7, meta: { handle: m[2], knownHandle: known } });
  }

  for (const m of n.matchAll(/(?<![a-z0-9])([a-z]{4}0[a-z0-9]{6})(?![a-z0-9])/g)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    taken.push([m.index, m.index + m[0].length]);
    const check = checkIfsc(m[1]);
    add({ type: 'ifsc', value: check.ifsc, confidence: check.valid ? 0.95 : 0.5, meta: check });
  }

  for (const m of n.matchAll(/(?<![a-z0-9+])(\+?\d{9,18})(?![a-z0-9])/g)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const digits = m[1].replace('+', '');
    const ctx = context(n, m.index);
    const phoneShape = /^(?:91)?[6-9]\d{9}$/.test(digits);
    // Whichever cue word is closest to the number decides it.
    const lastAcct = Math.max(ctx.lastIndexOf('account'), ctx.lastIndexOf('a/c'), ctx.lastIndexOf('khata'), ctx.lastIndexOf('neft'), ctx.lastIndexOf('खाता'));
    const lastPhone = Math.max(ctx.lastIndexOf('call'), ctx.lastIndexOf('phone'), ctx.lastIndexOf('mobile'), ctx.lastIndexOf('whatsapp'), ctx.lastIndexOf('फोन'));
    const isAccount = !phoneShape || (ACCOUNT_CONTEXT.test(ctx) && lastAcct > lastPhone);
    taken.push([m.index, m.index + m[0].length]);
    if (isAccount) add({ type: 'account', value: digits, confidence: ACCOUNT_CONTEXT.test(ctx) ? 0.9 : 0.6 });
    else add({ type: 'phone', value: `+91${digits.slice(-10)}`, confidence: PHONE_CONTEXT.test(ctx) ? 0.9 : 0.75 });
  }

  for (const m of n.matchAll(/(?<![a-z0-9@.])((?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|in|net|org|xyz|top|online|site|info|app|link|ly|io|co|live|apk|vip|club|shop)(?:\/[^\s,]*)?)(?![a-z0-9])/g)) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    add({ type: 'url', value: m[1], confidence: 0.8 });
  }

  for (const amount of extractAmounts(n)) add({ type: 'amount', value: String(amount), confidence: 0.8 });

  return { identifiers: ids, normalized: n };
}

export function extractAmounts(n) {
  const found = [];
  const unit = { lakh: 100000, lac: 100000, lakhs: 100000, crore: 10000000, thousand: 1000, hazaar: 1000, hazar: 1000, 'हजार': 1000, 'लाख': 100000 };
  for (const m of n.matchAll(/(\d+(?:\.\d+)?)\s*(lakhs?|lac|crore|लाख)(?:\s*(?:and\s*)?(\d+)\s*(thousand|hazaa?r|हजार))?/g)) {
    found.push(Math.round(Number(m[1]) * unit[m[2]] + (m[3] ? Number(m[3]) * 1000 : 0)));
  }
  for (const m of n.matchAll(/(?<![\d.])(\d+)\s*(thousand|hazaa?r|हजार)/g)) {
    if (!found.length || !n.slice(Math.max(0, m.index - 12), m.index).match(/lakh|lac|लाख/)) found.push(Number(m[1]) * 1000);
  }
  for (const m of n.matchAll(/(?:₹|\brs\.?|\binr)\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:rupees|rupaye|रुपये|rs\b)/g)) {
    const v = Number((m[1] || m[2]).replace(/,/g, ''));
    if (v > 0 && v < 1e9 && !found.includes(v)) found.push(v);
  }
  return [...new Set(found)];
}

const INDICATORS = {
  remoteApp: /anydesk|any desk|teamviewer|team viewer|quicksupport|quick support|rustdesk|airdroid|screen ?share/,
  otp: /\botp\b|one time password|\bpin\b|cvv|verification code|password|ओटीपी|ஓடிபி/,
  payment: /\bpay\b|payment|transfer (?:the |your |it\b|money|amount|funds|savings|\d)|bank transfer|send (?:it|the|money|amount)|deposit|upi|\bneft\b|\bimps\b|account number|fee|fine|charge|refund|amount|भेज|पैसे|पेमेंट|ट्रांसफर|பணம்|அனுப்ப|கட்டுங்க|பேமெண்ட்/,
  threat: /arrest|warrant|jail|police|fir\b|case (?:is )?(?:registered|filed)|court|blocked|block|suspend|disconnect|legal action|गिरफ्तार|पुलिस|जेल|ब्लॉक|கைது|போலீஸ்|ஜெயில்|பிளாக்/,
  urgency: /immediately|urgent|right now|fast|quickly|within \d+|in \d+ (?:minutes|hours)|today itself|tonight|जल्दी|अभी/,
  personal: /your (?:full )?name|your address|date of birth|aadhaar number|pan number|where do you (?:live|stay)|आपका नाम|पता/,
  secrecy: /don'?t tell|do not tell|do not disconnect|don'?t disconnect|cannot disconnect|stay on (?:the )?(?:video )?call|confidential|किसी को मत/
};

export function detectIntents(text) {
  const n = normalizeSpoken(text);
  return Object.fromEntries(Object.entries(INDICATORS).map(([k, re]) => [k, re.test(n)]));
}

export const AGENCIES = [
  ['CBI', /\bcbi\b/], ['Enforcement Directorate', /\bed\b officer|enforcement directorate/], ['Customs', /customs/],
  ['Narcotics Control Bureau', /\bncb\b|narcotics/], ['Police / Cyber Crime', /police|cyber ?crime|crime branch/],
  ['TRAI', /\btrai\b/], ['RBI', /\brbi\b|reserve bank/], ['SBI', /\bsbi\b|state bank/], ['FedEx', /fedex|fed ex/],
  ['DHL', /\bdhl\b/], ['Income Tax Dept', /income tax/], ['Electricity board', /electricity|tneb|bescom|power cut/],
  ['Telegram', /telegram/], ['WhatsApp', /whatsapp/]
];

export function detectAgencies(text) {
  const n = normalizeSpoken(text);
  return AGENCIES.filter(([, re]) => re.test(n)).map(([name]) => name);
}

// How the decoy reads an identifier back, so the scammer confirms it on the recording.
export function speakIdentifier(item) {
  if (item.type === 'upi') return item.value.replace('@', ', at, ').replace(/\./g, ' dot ');
  if (item.type === 'account' || item.type === 'phone') return item.value.replace('+91', '').match(/.{1,4}/g).join(', ');
  if (item.type === 'ifsc') return item.value.split('').join(' ');
  return item.value;
}
