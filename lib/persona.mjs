// The decoy: adaptive personas, honeytoken identities and the playbook state machine that steers each
// scam toward the payment step, where the scammer has to say the UPI ID and account out loud.
// Guardrails live in code: the decoy never sends money, never reads out an OTP, never installs apps.

import { classifyScam } from './classifier.mjs';
import { detectIntents, extractIdentifiers, speakIdentifier } from './extract.mjs';
import { addressee, answerQuestion, backchannel, echo, mishear, rememberFacts, rupeesInWords, turnRandom } from './dialogue.mjs';

export const STAGES = ['HOOK', 'TRUST', 'PRESSURE', 'PAYMENT', 'EXTRACT', 'STALL'];

export const PERSONAS = {
  neutral: { id: 'neutral', name: 'Elderly voice', role: 'Neutral opener until the scam type is known', age: null, voice: { rate: 0.94, pitch: 1, gender: 'female' } },
  teacher: {
    id: 'teacher', name: 'Kamala', age: 68, role: 'Retired maths teacher, Chennai', forTypes: ['digital_arrest', 'courier', 'sextortion'],
    surnames: ['Venkatesan', 'Raghavan', 'Srinivasan', 'Natesan'], streets: ['Luz Church Road, Mylapore', 'Second Avenue, Besant Nagar', 'Arya Gowda Road, West Mambalam'],
    voice: { rate: 0.9, pitch: 1, gender: 'female' }
  },
  shopowner: {
    id: 'shopowner', name: 'Ramesh', age: 61, role: 'Kirana shop owner, Coimbatore', forTypes: ['kyc', 'loan_app', 'electricity'],
    surnames: ['Subramaniam', 'Krishnan', 'Pillai', 'Murugan'], streets: ['Oppanakara Street, Coimbatore', 'Cross Cut Road, Gandhipuram', 'Big Bazaar Street, Town Hall'],
    voice: { rate: 0.94, pitch: 1, gender: 'male' }
  },
  student: {
    id: 'student', name: 'Arjun', age: 21, role: 'Final-year engineering student, Madurai', forTypes: ['task_job'],
    surnames: ['Natarajan', 'Selvam', 'Balaji', 'Kannan'], streets: ['Bypass Road, Madurai', 'KK Nagar, Madurai', 'Anna Nagar, Madurai'],
    voice: { rate: 1.02, pitch: 1, gender: 'male' }
  }
};

export function personaForType(type) {
  return Object.values(PERSONAS).find((p) => p.forTypes?.includes(type)) || PERSONAS.teacher;
}

// Deterministic per-call RNG so a call's honeytoken identity is reproducible.
function rng(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Each call's persona leaks a unique decoy identity. If a later call quotes it back, that proves
// the two calls share a data source (the same ring, or a list it bought). No links, no tracking.
export function makeHoneytoken(persona, callId) {
  const r = rng(`${callId}:${persona.id}`);
  const surname = persona.surnames[Math.floor(r() * persona.surnames.length)];
  const door = `${10 + Math.floor(r() * 89)}/${1 + Math.floor(r() * 9)}`;
  const street = persona.streets[Math.floor(r() * persona.streets.length)];
  return {
    fullName: `${persona.name} ${surname}`,
    address: `No. ${door}, ${street}`,
    door,
    bankPhrase: `${persona.id === 'student' ? 'My account is in' : persona.id === 'shopowner' ? 'My shop account is in' : 'My pension comes in'} ${['Indian Bank', 'Canara Bank', 'State Bank'][Math.floor(r() * 3)]}.`,
    tokens: [`${persona.name} ${surname}`.toLowerCase(), door]
  };
}

const L = {
  en: {
    greet: ['Hello? Hello... who is speaking, please?'],
    hook: [
      'Sorry, I did not follow. Which office did you say you are calling from?',
      'One minute, let me put my hearing aid properly... haan, tell me again slowly.',
      'Is this about my pension? Who gave you this number?',
      'Hmm? Speak a little louder, {sir}, the line is not clear.',
      'Who is this? Are you from the bank? My son handles all these things.',
      'Sorry, the TV was on. Say again, {sir}?'
    ],
    trust: {
      digital_arrest: ['A police case? On me? Oh god... I am a retired teacher, {sir}. Thirty years I taught maths. What case is this?', 'Arrest? Me? There must be some mistake, {sir}. I have never even got a parking fine.'],
      courier: ['A parcel? I did not send any parcel to anyone. What was inside it?', 'Parcel in my name? I do not even go to the post office these days. Who booked it?'],
      kyc: ['My account will be blocked? But my shop money and my pension come in that account! What do I have to update?', 'Blocked? Arre, I just went to the bank last month. What is missing now?'],
      loan_app: ['Yes, yes, I was looking at a loan for the shop last week. How much can I get?', 'Loan approved? Very good, very good. What is the procedure, {sir}?'],
      task_job: ['Part-time job? Yes, I really need money for my college fees. How much per task?', 'Work from home? Okay, okay, I am interested. What do I have to do exactly?'],
      electricity: ['Disconnection tonight? But I paid the bill last month only! What should I do now?', 'Power cut? Tonight? My mother is at home, {sir}, please do not cut it.'],
      sextortion: ['What video? I do not understand what you are saying. Who is this?']
    },
    steer: [
      'So what do I have to do now? Can I pay something and close this matter?',
      'Please tell me how to solve this, {sir}. If there is a fee, I will pay it.',
      'I do not want any trouble. Tell me exactly what I must do and I will do it.',
      'Okay... so now what? You tell me step by step, I will follow.'
    ],
    scaredType: {
      kyc: ['Please do not block my account, {sir}, all my savings are in it. Tell me what to do.', 'Arre, if it gets blocked how will I pay the suppliers? Please help me, {sir}.'],
      electricity: ['No, no, please do not cut the power, my mother is on the oxygen machine. Tell me how to pay quickly.'],
      loan_app: ['I really need this loan, {sir}. Please do not cancel it. What should I do?'],
      task_job: ['Please do not remove me from the group, I need this money. Tell me what to do.']
    },
    steerType: {
      task_job: ['Okay, how do I start? Is there any registration fee? I can pay a small amount.', 'I have done the free tasks. What next? Where do I deposit for the next level?'],
      loan_app: ['Okay, I need the loan urgently. How do I pay the processing fee?', 'Approval is fine. Where should I pay the charges?']
    },
    scared: [
      'Please, {sir}, I have never done anything wrong in my life. Do not send police to my house. What should I do?',
      'Oh my god, my heart is beating very fast... please help me, {sir}. Tell me how to fix this.',
      'I am alone at home, please do not do anything. I will cooperate fully.',
      'Please, I am a senior citizen, I have BP. Just tell me what to do, I will do it.'
    ],
    personal: ['My name is {fullName}. I stay at {address}. {bankPhrase}', 'I am {fullName}, {sir}. House is {address}. {bankPhrase} Why do you need all this?'],
    askUpi: [
      'Okay, okay, I will pay. Where should I send it? Tell me the UPI ID slowly, I will write it down.',
      'I have PhonePe on my phone. Tell me the UPI ID letter by letter, my eyes are weak.',
      'Wait, let me get a pen... haan, tell me. Where do I send?'
    ],
    askAccount: [
      'Hmm, this UPI is showing some error on my phone. Can I do bank transfer instead? Give me the account number.',
      'It says UPI limit is over for today. My bank allows NEFT. Tell me the account number, slowly please.'
    ],
    askIfsc: ['And the IFSC code, {sir}? The bank form is asking for IFSC.', 'It is asking IFSC code also. Tell me that also, please.'],
    confirm: {
      upi: ['Wait, I am writing... {spoken}. Is that correct?', 'One second... {spoken}. Correct, no?', '{spoken}... okay, written. Let me read it once more to be sure.'],
      account: ['Account number {spoken}. Correct? Let me check once.', 'Slowly, slowly... {spoken}. Is that right?'],
      ifsc: ['IFSC {spoken}. That is {bank}, is it?', '{spoken}... okay. {bank}, right?'],
      phone: ['Your number is {spoken}? I will save it.'],
      url: ['Website {spoken}? My phone is not opening links, {sir}.']
    },
    otp: [
      'OTP? No message has come yet, {sir}. My phone is very slow. Should I wait?',
      'There are so many messages... which one is the OTP? I cannot find it, one minute.',
      'My son told me never to tell OTP to anyone... but you are police, no? Anyway it has not come yet.'
    ],
    remote: ['Any what? AnyDesk? I do not know how to install these things. My grandson does all that, he comes only in the evening.', 'It is asking for some permission... allow, deny... I am scared to press anything, {sir}.'],
    stall: [
      'It is saying "payment failed, try again later". What should I do now?',
      'The bank app is asking me to update. It is downloading... very slow.',
      'My spectacles, where did I keep my spectacles... one minute, please do not cut the call.',
      'It is asking beneficiary name. Should I put {accountName}?',
      'It is asking beneficiary name. What name should I put?',
      'The net went off, {sir}. Can you tell me the account number once more? I lost the page.',
      'Someone is ringing the bell. Please hold, I am coming back.',
      'It is showing some red message. Wait, let me read... "server busy". Should I try again?',
      'I typed {amountWords} but it is saying daily limit exceeded. Can I send half today, half tomorrow?',
      'Battery is at two percent, {sir}. Let me put the charger... do not cut, okay?'
    ],
    filler: ['Haan, haan, I am listening.', 'Yes, go on.', 'Okay... then?'],
    exit: 'My son has come home, {sir}. He says he will handle it. I will call you back.'
  },
  hi: {
    greet: ['हेलो? हेलो... कौन बोल रहा है?'],
    hook: ['माफ़ कीजिए, समझ नहीं आया। आप किस ऑफिस से बोल रहे हैं?', 'एक मिनट, मशीन ठीक से लगाने दो... हाँ, फिर से धीरे बोलिए।', 'यह मेरी पेंशन के बारे में है क्या? आपको यह नंबर किसने दिया?'],
    trust: {
      digital_arrest: 'सीबीआई? हे भगवान। मैं रिटायर्ड टीचर हूँ, तीस साल गणित पढ़ाया है। कौन सा केस है?',
      courier: 'पार्सल? मैंने तो किसी को कोई पार्सल नहीं भेजा। उसमें क्या था?',
      kyc: 'खाता ब्लॉक हो जाएगा? पर उसी में तो मेरी पेंशन आती है! क्या अपडेट करना है?',
      loan_app: 'हाँ हाँ, पिछले हफ़्ते दुकान के लिए लोन देख रहा था। कितना मिलेगा?',
      task_job: 'पार्ट टाइम जॉब? हाँ, मुझे फीस के लिए पैसे चाहिए। एक टास्क में कितना मिलेगा?',
      electricity: 'आज रात बिजली कट जाएगी? पर मैंने पिछले महीने बिल भरा था!',
      sextortion: 'कौन सा वीडियो? मुझे कुछ समझ नहीं आ रहा।'
    },
    steer: ['तो अब मुझे क्या करना है? कुछ पैसे भर के मामला ख़त्म हो सकता है?', 'मुझे कोई परेशानी नहीं चाहिए। बताइए क्या करना है, मैं कर दूँगी।'],
    scared: ['साहब, मैंने ज़िंदगी में कभी कुछ गलत नहीं किया। पुलिस मत भेजिए। मैं क्या करूँ?', 'हे भगवान, मेरा दिल बहुत घबरा रहा है... बताइए कैसे ठीक होगा।'],
    personal: 'मेरा नाम {fullName} है। मैं {address} पर रहती हूँ।',
    askUpi: ['ठीक है, मैं पैसे भेज दूँगी। कहाँ भेजूँ? यूपीआई आईडी धीरे धीरे बोलिए, मैं लिख रही हूँ।'],
    askAccount: ['यह यूपीआई में एरर आ रहा है। बैंक ट्रांसफर कर दूँ? खाता नंबर बताइए।'],
    askIfsc: ['और आईएफएससी कोड? फॉर्म में वो भी माँग रहा है।'],
    confirm: {
      upi: 'रुकिए, लिख रही हूँ... {spoken}। सही है?',
      account: 'खाता नंबर {spoken}। सही है? एक बार फिर पढ़ देती हूँ।',
      ifsc: 'आईएफएससी {spoken}। यह {bank} है ना?',
      phone: 'आपका नंबर {spoken}? सेव कर लेती हूँ।',
      url: 'वेबसाइट {spoken}? मेरे फ़ोन में लिंक नहीं खुलते।'
    },
    otp: ['ओटीपी? अभी तक कोई मैसेज नहीं आया। फ़ोन बहुत धीमा है।'],
    remote: ['एनी क्या? यह सब मुझे नहीं आता। मेरा पोता शाम को आता है, वही करता है।'],
    stall: ['यह "पेमेंट फेल" दिखा रहा है। अब क्या करूँ?', 'मेरा चश्मा कहाँ रख दिया... एक मिनट, फ़ोन मत काटिए।', 'नेट चला गया। खाता नंबर फिर से बताइए, पेज बंद हो गया।', 'कोई घंटी बजा रहा है, रुकिए, अभी आती हूँ।'],
    filler: ['हाँ, हाँ, सुन रही हूँ।', 'अच्छा... फिर?'],
    exit: 'मेरा बेटा आ गया है, वो देख लेगा। मैं आपको बाद में फ़ोन करती हूँ।'
  },
  ta: {
    greet: ['ஹலோ? ஹலோ... யார் பேசுறீங்க?'],
    hook: ['மன்னிக்கணும், புரியலை. எந்த ஆபீஸ்ல இருந்து பேசுறீங்க?', 'ஒரு நிமிஷம், காது மிஷின் சரியா வச்சுக்கறேன்... இப்போ சொல்லுங்க, மெதுவா.', 'என் பென்ஷன் விஷயமா? இந்த நம்பர் யார் கொடுத்தாங்க?', 'சத்தமா பேசுங்க, லைன் சரியா கேக்கலை.'],
    trust: {
      digital_arrest: ['போலீஸ் கேஸா? என் மேலயா? கடவுளே... நான் ரிட்டையர்டு டீச்சர், முப்பது வருஷம் கணக்கு சொல்லிக்கொடுத்தேன். என்ன கேஸ் இது?'],
      courier: ['பார்சலா? நான் யாருக்கும் பார்சல் அனுப்பலையே. அதுல என்ன இருந்தது?'],
      kyc: ['அக்கவுண்ட் பிளாக் ஆகுமா? அதுலதான் என் பென்ஷன் வருது! என்ன அப்டேட் பண்ணணும்?'],
      loan_app: ['ஆமா ஆமா, கடைக்கு லோன் பார்த்துட்டு இருந்தேன். எவ்வளவு கிடைக்கும்?'],
      task_job: ['பார்ட் டைம் வேலையா? ஆமா, காலேஜ் ஃபீஸுக்கு பணம் தேவை. ஒரு டாஸ்க்குக்கு எவ்வளவு?'],
      electricity: ['இன்னைக்கு ராத்திரி கரண்ட் கட்டா? போன மாசம்தான் பில் கட்டினேன்!'],
      sextortion: ['என்ன வீடியோ? நீங்க என்ன சொல்றீங்கன்னு புரியலை.']
    },
    steer: ['சரி, இப்போ நான் என்ன பண்ணணும்? ஏதாவது பணம் கட்டினா முடிஞ்சிடுமா?', 'எனக்கு எந்த பிரச்சனையும் வேண்டாம். என்ன பண்ணணும்னு சொல்லுங்க, பண்றேன்.'],
    scared: ['சார், நான் வாழ்க்கையில எந்த தப்பும் பண்ணலை. போலீஸ் அனுப்பாதீங்க. நான் என்ன பண்ணணும்?', 'கடவுளே, நெஞ்சு படபடக்குது... எப்படி சரி பண்றதுன்னு சொல்லுங்க.'],
    personal: ['என் பேரு {fullName}. நான் {address}ல இருக்கேன்.'],
    askUpi: ['சரி சரி, பணம் அனுப்பறேன். எங்க அனுப்பணும்? UPI ஐடியை மெதுவா சொல்லுங்க, எழுதிக்கறேன்.'],
    askAccount: ['இந்த UPI ல எரர் வருது. பேங்க் ட்ரான்ஸ்ஃபர் பண்ணட்டுமா? அக்கவுண்ட் நம்பர் சொல்லுங்க.'],
    askIfsc: ['IFSC கோடு? ஃபார்ம்ல அதுவும் கேக்குது.'],
    confirm: {
      upi: ['இருங்க, எழுதறேன்... {spoken}. சரியா?'],
      account: ['அக்கவுண்ட் நம்பர் {spoken}. சரியா? இன்னொரு தடவை படிக்கிறேன்.'],
      ifsc: ['IFSC {spoken}. அது {bank} தானே?'],
      phone: ['உங்க நம்பர் {spoken}? சேவ் பண்ணிக்கறேன்.'],
      url: ['வெப்சைட் {spoken}? என் போன்ல லிங்க் திறக்காது.']
    },
    otp: ['OTP யா? இன்னும் மெசேஜ் வரலை. போன் ரொம்ப ஸ்லோ.'],
    remote: ['எனி என்ன? இதெல்லாம் எனக்குத் தெரியாது. என் பேரன் சாயங்காலம்தான் வருவான்.'],
    stall: ['"பேமெண்ட் ஃபெயில்ட்" னு வருது. இப்போ என்ன பண்றது?', 'என் கண்ணாடி எங்க வச்சேன்... ஒரு நிமிஷம், போனை வைக்காதீங்க.', 'நெட் போயிடுச்சு. அக்கவுண்ட் நம்பர் இன்னொரு தடவை சொல்லுங்க.', 'யாரோ காலிங் பெல் அடிக்கறாங்க, இருங்க வர்றேன்.'],
    filler: ['ம்ம், சொல்லுங்க.', 'சரி... அப்புறம்?'],
    exit: 'என் பையன் வந்துட்டான், அவன் பாத்துக்குவான். அப்புறம் பேசறேன்.'
  }
};

// Least-used variant first, ties broken by the call's seeded randomness, so lines rarely repeat.
function pick(call, list, key, r) {
  if (typeof list === 'string') return list;
  call.used = call.used || {};
  const counts = (call.used[key] = call.used[key] || {});
  const min = Math.min(...list.map((_, i) => counts[i] || 0));
  const options = list.map((_, i) => i).filter((i) => (counts[i] || 0) === min);
  const i = options[Math.floor(r() * options.length)];
  counts[i] = (counts[i] || 0) + 1;
  return list[i];
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export function lines(lang) {
  return L[lang] || L.en;
}

export function openingLine(call) {
  return lines(call.lang).greet[0];
}

const PRIORITY = ['upi', 'account', 'ifsc', 'phone', 'url'];

// One scammer turn in, one decoy turn out. Mutates the call (state, persona, identifiers, memory).
export function decoyTurn(call, scammerText, t) {
  const lang = lines(call.lang);
  const r = turnRandom(call);
  const scammerTurns = call.turns.filter((x) => x.speaker === 'scammer').map((x) => x.text);
  const { identifiers } = extractIdentifiers(scammerText);
  const intents = detectIntents(scammerText);
  const facts = rememberFacts(call, scammerText);
  const fresh = [];
  for (const id of identifiers) {
    const existing = call.identifiers.find((x) => x.type === id.type && x.value === id.value);
    if (existing) existing.mentions = (existing.mentions || 1) + 1;
    else {
      const item = { ...id, firstAt: t, quote: scammerText, mentions: 1 };
      call.identifiers.push(item);
      fresh.push(item);
    }
  }

  const primary = fresh.filter((x) => PRIORITY.includes(x.type)).sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type))[0];
  let switched = false;
  if (call.scamType === 'unknown') {
    const cls = classifyScam(scammerTurns);
    if (cls.type !== 'unknown' && (cls.confidence >= 0.6 || scammerTurns.length >= 3)) {
      Object.assign(call, { scamType: cls.type, scamLabel: cls.label, scamConfidence: cls.confidence });
      const persona = personaForType(cls.type);
      call.persona = { id: persona.id, name: persona.name, age: persona.age, role: persona.role, voice: persona.voice };
      call.honeytoken = makeHoneytoken(persona, call.id);
      switched = true;
    }
  } else {
    const cls = classifyScam(scammerTurns);
    if (cls.type === call.scamType) call.scamConfidence = Math.max(call.scamConfidence, cls.confidence);
    else if (cls.type !== 'unknown' && cls.scores[cls.type] >= (cls.scores[call.scamType] || 0) + 3) {
      // The story escalated (courier parcel -> "digital arrest"): relabel; the persona stays on the line.
      call.relabels = [...(call.relabels || []), { from: call.scamLabel, to: cls.label, t }];
      Object.assign(call, { scamType: cls.type, scamLabel: cls.label, scamConfidence: cls.confidence });
    }
  }

  const has = (type) => call.identifiers.some((x) => x.type === type);
  const P = (list, key) => pick(call, list, key, r);
  const ask = () => (!has('upi') ? P(lang.askUpi, 'askUpi') : !has('account') ? P(lang.askAccount, 'askAccount') : !has('ifsc') ? P(lang.askIfsc, 'askIfsc') : null);
  const stall = (afterReadback = false) => {
    const usable = lang.stall.filter((s) => !(afterReadback && /once more|tell me the account/i.test(s)) && (!s.includes('{accountName}') || call.memory?.accountName) && (!s.includes('{amountWords}') || call.memory?.amount >= 1000));
    return P(usable, 'stall');
  };
  const react = echo(call, facts, r, call.lang);
  const words = scammerText.trim().split(/\s+/).length;
  let reply;
  let stage = call.stage;
  let reason;

  if (switched) {
    reply = [react, P(lang.trust[call.scamType] || lang.steer, 'trust')].filter(Boolean).join(' ');
    stage = 'TRUST';
    reason = `Classified as ${call.scamLabel}; switched to persona ${call.persona.name}`;
    if (intents.payment) reply += ' ' + (ask() || '');
  } else if (intents.otp && !primary) {
    reply = P(lang.otp, 'otp');
    stage = 'STALL';
    reason = 'Asked for OTP: guardrail stalls, never reads one out';
  } else if (intents.remoteApp) {
    reply = P(lang.remote, 'remote');
    stage = 'STALL';
    reason = 'Asked to install a remote-access app: guardrail refuses';
  } else if (primary) {
    reply = fill(P(lang.confirm[primary.type], `confirm-${primary.type}`), { spoken: speakIdentifier(primary), bank: primary.meta?.bank || 'which bank' });
    const next = ask();
    reply += ' ' + (next || stall(true));
    stage = next ? 'EXTRACT' : 'STALL';
    reason = `Captured ${primary.type.toUpperCase()} ${primary.value}; reading it back for confirmation`;
  } else if ((reply = answerQuestion(call, scammerText, r, call.lang))) {
    reason = 'Caller asked a direct question: answer it like a person would';
  } else if (intents.personal && call.honeytoken) {
    reply = fill(P(lang.personal, 'personal'), call.honeytoken);
    reason = 'Asked for personal details: gave the honeytoken identity';
  } else if (!intents.payment && call.stage !== 'EXTRACT' && (reply = mishear(call, scammerText, r))) {
    reason = 'Misheard on purpose: makes the caller repeat and explain, wastes their time';
  } else if (intents.payment) {
    reply = [react, ask() || stall()].filter(Boolean).join(' ');
    stage = has('upi') && has('account') && has('ifsc') ? 'STALL' : 'PAYMENT';
    reason = stage === 'STALL' ? 'All payment details captured; stalling to waste time' : 'Payment step reached; asking for the next missing identifier';
  } else if ((intents.threat || intents.urgency) && !(has('upi') && has('account'))) {
    reply = [react, P(lang.scaredType?.[call.scamType] || lang.scared, 'scared')].filter(Boolean).join(' ');
    stage = 'PRESSURE';
    reason = 'Threat or urgency: sound scared, invite the payment ask';
  } else if (call.scamType === 'unknown') {
    reply = react || P(lang.hook, 'hook');
    stage = 'HOOK';
    reason = 'Still classifying; keep the caller explaining';
  } else if (has('upi') && has('account')) {
    reply = stall();
    stage = 'STALL';
    reason = 'Payment details captured; stalling';
  } else if (words <= 6 && r() < 0.7) {
    reply = backchannel(call, r, call.lang);
    reason = 'Short line from the caller: short reply, keep them talking';
  } else {
    reply = [react, P(lang.steerType?.[call.scamType] || lang.steer, 'steer')].filter(Boolean).join(' ');
    stage = 'TRUST';
    reason = 'Steering toward the payment step';
  }

  // Fill memory-aware placeholders the same way for every line.
  reply = fill(reply, {
    sir: addressee(call, r),
    accountName: call.memory?.accountName || '',
    amountWords: call.memory?.amount ? rupeesInWords(call.memory.amount) : ''
  }).replace(/\s+/g, ' ');

  call.stage = stage;
  call.maxStage = STAGES[Math.max(STAGES.indexOf(call.maxStage || 'HOOK'), STAGES.indexOf(stage))];
  // The reaction and the playbook move separately, so a model can swap in its own reaction.
  const usedReact = react && reply.trim().startsWith(react) ? react : '';
  const core = guard(reply.trim().slice(usedReact.length).trim(), call);
  return { reply: guard(reply.trim(), call), core, react: usedReact, reason, fresh, intents };
}

// Hard guardrail applied to every outgoing line, including any LLM-written one.
export function guard(text, call) {
  const allowed = new Set(call.identifiers.map((x) => speakIdentifier(x)));
  let safe = text.replace(/\b(i have |i've )?(sent|transferred|paid) (the )?(money|amount|payment)\b/gi, 'trying to send it');
  safe = safe.replace(/\b\d{4,8}\b/g, (m) => ([...allowed].some((a) => a.replace(/\D/g, '').includes(m)) || call.honeytoken?.address.includes(m) ? m : '...'));
  return safe;
}
