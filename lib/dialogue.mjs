// Makes the rule-based decoy sound like a person in a conversation rather than a script:
// it remembers what the caller said (their name, the agency, the place, the amount), reacts to
// new details, mishears now and then, answers the caller's direct questions, and rarely repeats.

import { detectAgencies, extractAmounts, normalizeSpoken } from './extract.mjs';

// Seeded per call and turn, so seeded history and tests stay reproducible.
export function turnRandom(call) {
  let h = 2166136261;
  for (const c of `${call.id}:${call.turns.length}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const NOT_NAMES = /^(Calling|From|The|Your|A|An|In|On|Sir|Madam|Speaking|Here|Not|Very|Just|Also|Going|Transferring|Connecting)$/;
const PLACES = /\b(Taiwan|Malaysia|Thailand|China|Dubai|Cambodia|Myanmar|Hong Kong|Singapore|Iran|Mumbai|Delhi|Kolkata|Bangalore|Bengaluru|Hyderabad|Lucknow)\b/i;
const ITEMS = /\b(passports?|drugs|mdma|ganja|cash|laptops?|credit cards|sim cards|fake documents|illegal items)\b/i;
const DEADLINE = /\b(\d+|one|two|three|ten|fifteen|thirty)\s+(hours?|minutes?)\b/i;

// What the caller has told us so far. Returns only the facts that are new this turn.
export function rememberFacts(call, text) {
  const mem = (call.memory = call.memory || {});
  const fresh = {};
  const set = (k, v) => {
    if (v && mem[k] !== v) {
      mem[k] = v;
      fresh[k] = v;
    }
  };
  const name = text.match(/\b(?:i am|i'm|this is|my name is)\s+(?:inspector|officer|sub[- ]inspector|constable|mr\.?|mrs\.?|ms\.?|dr\.?)?\s*([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?/);
  if (name && !NOT_NAMES.test(name[1])) set('callerName', name[2] && !NOT_NAMES.test(name[2]) ? `${name[1]} ${name[2]}` : name[1]);
  const officer = text.match(/\b(?:officer|inspector|sir|mr\.?)\s+([A-Z][a-z]{2,})(?:\s+([A-Z][a-z]{2,}))?/);
  if (officer && !NOT_NAMES.test(officer[1])) set('officer', officer[2] && !NOT_NAMES.test(officer[2]) ? `${officer[1]} ${officer[2]}` : officer[1]);
  const agency = detectAgencies(text).find((a) => !(mem.agencies || []).includes(a));
  if (agency) {
    mem.agencies = [...(mem.agencies || []), agency];
    fresh.agency = agency;
  }
  set('place', text.match(PLACES)?.[1]);
  set('item', text.match(ITEMS)?.[1]?.toLowerCase());
  const dl = text.match(DEADLINE);
  set('deadline', dl && `${dl[1]} ${dl[2]}`);
  const amounts = extractAmounts(normalizeSpoken(text));
  // Only money the caller wants paid; "earn 5000 per day" is bait, not a demand.
  if (amounts.length && /(pay|deposit|transfer|fee|fine|charge|penalty|send)/i.test(text)) set('amount', Math.max(...amounts));
  set('accountName', text.match(/account name (?:is )?([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){0,3})/)?.[1]);
  return fresh;
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function below100(n) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}
export function rupeesInWords(n) {
  const parts = [];
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thousand = Math.floor((n % 1e5) / 1000), rest = n % 1000;
  if (crore) parts.push(`${below100(crore)} crore`);
  if (lakh) parts.push(`${below100(lakh)} lakh`);
  if (thousand) parts.push(`${below100(thousand)} thousand`);
  if (rest >= 100) parts.push(`${ONES[Math.floor(rest / 100)]} hundred`);
  if (rest % 100) parts.push(below100(rest % 100));
  return `${parts.join(' ') || 'zero'} rupees`;
}

const pickR = (r, list) => list[Math.floor(r() * list.length)];

// How the decoy addresses the caller: mostly "sir", sometimes by the name they gave.
export function addressee(call, r) {
  const who = call.memory?.officer || call.memory?.callerName;
  if (who && r() < 0.45) return `${who.split(' ').pop()} sir`;
  const official = call.memory?.officer || ['digital_arrest', 'kyc', 'electricity'].includes(call.scamType);
  return call.persona?.id === 'student' || official ? 'sir' : r() < 0.25 ? 'beta' : 'sir';
}

const ECHO = {
  agency: ['{agency}? Oh god.', '{agency}? Why would {agency} call me?', '{agency}... Achha.'],
  item: ['{Item}?! In my name?', '{Item}? Sir, I have never even seen {item} in my life.'],
  place: ['{place}? I do not know anyone in {place}.', '{place}? Why {place}? I have never even been there.'],
  abroad: ['{place}? I have never even been out of India, sir.', '{place}? I do not know anyone in {place}.'],
  bigAmount: ['{amount}?! Sir, that is almost all my savings.', '{amount}... that is a lot of money, sir.', 'Arre, {amount}? I will have to break my FD for that.'],
  smallAmount: ['Only {amount}? Okay, that much I can do.', '{amount}, okay. That is fine.'],
  deadline: ['{deadline}? So soon?', 'Only {deadline}? Please give me some time, sir.'],
  name: ['Okay, {name} sir.', '{name} sir, okay okay.']
};

// One short reaction to the most striking new detail, or nothing.
export function echo(call, fresh, r, lang) {
  if (lang !== 'en' || r() < 0.3) return '';
  const order = [
    ['item', (v) => ({ item: v, Item: v.replace(/^./, (c) => c.toUpperCase()) })],
    ['amount', (v) => ({ amount: rupeesInWords(v), key: v >= 5000 ? 'bigAmount' : 'smallAmount' })],
    ['place', (v) => ({ place: v, key: /mumbai|delhi|kolkata|bangalore|bengaluru|hyderabad|lucknow/i.test(v) ? 'place' : 'abroad' })],
    ['deadline', (v) => ({ deadline: v })],
    ['agency', (v) => ({ agency: v === 'Police / Cyber Crime' ? 'Police' : v })],
    ['callerName', (v) => ({ name: v.split(' ').pop(), key: 'name' })]
  ];
  for (const [k, toVars] of order) {
    if (!fresh[k]) continue;
    if (k === 'place' && /mumbai|delhi|kolkata|bangalore|bengaluru|hyderabad|lucknow/i.test(fresh[k])) continue; // a city in an office name is not news
    const vars = toVars(fresh[k]);
    return pickR(r, ECHO[vars.key || k]).replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? '');
  }
  return '';
}

const CONFUSE = [
  [/taiwan/i, 'Sorry, sorry... Thailand, you said? The line is breaking.'],
  [/malaysia/i, 'Malaysia or Maldives? My hearing is not so good, sir.'],
  [/fedex|fed ex/i, 'Fed... what? Federal Bank? I have no account in Federal Bank.'],
  [/\bcbi\b/i, 'C I D? Like the TV serial?'],
  [/customs/i, 'Customers? Which customers, sir?'],
  [/\bkyc\b/i, 'K Y... what is that? Please explain slowly, I am not very modern.'],
  [/mdma/i, 'M D... what? I only take BP tablets, sir.'],
  [/narcotics/i, 'Narco... what? Please say again.'],
  [/telegram/i, 'Telegram? Like the old telegram? Those still come?'],
  [/processing fee/i, 'Processing what? Sorry, there is noise here.']
];

// Elderly people mishear. Do it at most twice per call, never while identifiers are being given.
export function mishear(call, text, r) {
  call.misheard = call.misheard || [];
  if (call.misheard.length >= 2 || r() > 0.35) return null;
  const hit = CONFUSE.find(([re]) => re.test(text) && !call.misheard.includes(String(re)));
  if (!hit) return null;
  call.misheard.push(String(hit[0]));
  return hit[1];
}

const QUESTIONS = [
  [/(are you there|can you hear|hello\?+\s*$|you there\??$|listening\?)/i, ['Haan, haan, I am here. Sorry, I was looking for my spectacles.', 'Yes, yes, I am listening. Go on.', 'Hello? Yes, I can hear. Your voice is cutting a little.']],
  [/(did you|have you) (do|done|send|sent|pay|paid|transfer|transferred|complete)|is it done|done\?|payment (done|completed)/i, ['Not yet, {sir}. It is still loading, the circle is going round and round.', 'I pressed the button, {sir}, but nothing is happening. Should I press again?', 'It is asking for some PIN... wait, wait, which PIN?']],
  [/(how much|what is your) (balance|money|savings)|how much (money )?(do you have|is there)/i, ['Around two lakhs in savings, and one FD in Indian Bank. Why, {sir}?', 'I do not know exactly, my son checks all that. Maybe one and a half lakh?']],
  [/which bank|what bank/i, ['{bankPhrase}', 'Bank? It is the one near the temple... {bankPhrase}']],
  [/(are you|is anyone|who is) (alone|with you|at home)/i, ['Yes, I am alone. My son is in Bangalore, he comes only for Pongal.', 'Only me and the cat, {sir}.']],
  [/do you understand|understood|are you clear/i, ['Yes, yes, I understand. Please do not shout, {sir}, I am getting nervous.', 'I understand... I think. Tell me once more slowly.']],
  [/what (is|was) (your|the) (name|address)|who am i speaking|your full name/i, null]
];

// A direct question from the caller gets a direct answer, like it would in a real call.
export function answerQuestion(call, text, r, lang) {
  if (lang !== 'en') return null;
  for (const [re, answers] of QUESTIONS) {
    if (!re.test(text)) continue;
    if (!answers) return null; // handled as a personal-details question
    return pickR(r, answers)
      .replace(/\{sir\}/g, addressee(call, r))
      .replace(/\{bankPhrase\}/g, call.honeytoken?.bankPhrase || 'Indian Bank.');
  }
  return null;
}

const BACKCHANNEL = {
  en: ['Haan?', 'Yes, tell me.', 'Hmm. Then?', 'Okay... I am listening.', 'Achha. Go on, {sir}.', 'Yes, yes.'],
  hi: ['हाँ?', 'हाँ, बोलिए।', 'अच्छा... फिर?', 'हम्म।'],
  ta: ['ம்ம்?', 'சொல்லுங்க.', 'சரி... அப்புறம்?']
};

export function backchannel(call, r, lang) {
  return pickR(r, BACKCHANNEL[lang] || BACKCHANNEL.en).replace('{sir}', addressee(call, r));
}
