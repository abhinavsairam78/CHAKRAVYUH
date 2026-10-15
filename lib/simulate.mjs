// Synthetic scam rings: used for the 14-day history behind the dashboard and for the telco
// diversion simulator ("divert 20 flagged calls"). Every number, UPI ID and account is made up.
// Each simulated ring reuses a small pool of numbers, mule accounts and voices, which is exactly
// the pattern the ring graph is built to expose.

import { runScripted, syntheticVoice } from './seed.mjs';

function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const pickFrom = (r, list) => list[Math.floor(r() * list.length)];

export const SIM_RINGS = [
  {
    key: 'arrest', type: 'digital_arrest', weight: 4, speakers: 2,
    numbers: ['+91 93421 77801', '+91 87542 10933', '+91 70219 44617', '+91 96003 58120'],
    upis: ['cbi.verify@okicici', 'rbi.escrow@ybl'], accounts: [['33219087654', 'PUNB0123400'], ['50200071234567', 'HDFC0004411']]
  },
  {
    key: 'courier', type: 'courier', weight: 3, speakers: 1,
    numbers: ['+91 81234 90876', '+91 99401 22781'],
    upis: ['customs.duty@paytm', 'parcel.release@axl'], accounts: [['33219087654', 'PUNB0123400']]
  },
  {
    key: 'kyc', type: 'kyc', weight: 3, speakers: 1,
    numbers: ['+91 62014 55890', '+91 74390 11872', '+91 90031 64420'],
    upis: ['kyc.helpdesk@ybl', 'sbi.rekyc@ibl'], accounts: [['921020044556677', 'UTIB0002231']]
  },
  {
    key: 'task', type: 'task_job', weight: 3, speakers: 2,
    numbers: ['+91 78100 43219', '+91 63982 70145', '+91 88070 12093'],
    upis: ['earnmore.task@ibl', 'vip.level3@ybl', 'reviews.pay@axl'], accounts: [['10045566778', 'IDFB0080123']]
  },
  {
    key: 'loan', type: 'loan_app', weight: 2, speakers: 1,
    numbers: ['+91 95660 31207', '+91 70451 98634'],
    upis: ['quickloan.fee@okaxis'], accounts: [['9876501234', 'AIRP0000001']]
  },
  {
    key: 'power', type: 'electricity', weight: 2, speakers: 1,
    numbers: ['+91 99620 47713', '+91 80152 66309'],
    upis: ['eb.update@axl'], links: ['tneb-online-pay.site']
  }
];

const SCRIPTS = {
  digital_arrest: [
    'Hello, this is {officer} from {agency}. Your Aadhaar number has been used in a money laundering case.',
    'A parcel with {item} was seized in {place}. You are under digital arrest, do not disconnect the call and do not tell anyone.',
    'To clear your name you must transfer your savings to the RBI verification account. It will be refunded after checking.',
    'Send it by UPI to {upiSpoken}.',
    '{account}',
    'Transfer {amount} rupees within one hour or the police will come to your house.'
  ],
  courier: [
    'Hello, I am calling from {courier} courier. A parcel booked in your name to {place} is held at customs.',
    'It contains {item}. Customs has seized it and a case will be filed.',
    'Madam, you must pay the customs clearance penalty now to avoid a police case.',
    'Pay {amount} rupees to {upiSpoken}.',
    '{account}'
  ],
  kyc: [
    'Good morning, I am calling from {bank} KYC department. Your KYC has expired.',
    'Your account will be blocked today if you do not update your PAN card.',
    'It is a simple process, you only have to pay a {amount} rupees verification charge.',
    'Pay to {upiSpoken}.',
    '{account}',
    'Now tell me the OTP you received.'
  ],
  task_job: [
    'Hello, I am {fname} from {company}. We are offering a part time work from home job.',
    'You just have to like YouTube videos and give hotel reviews. You can earn 3000 rupees per day.',
    'Complete the free tasks and join our Telegram group for prepaid tasks with high commission.',
    'For the prepaid task deposit {amount} rupees to {upiSpoken}.',
    '{account}'
  ],
  loan_app: [
    'Hello sir, your instant loan of 2 lakh rupees is approved from {company}.',
    'You only have to pay the processing fee before disbursement, then the money comes in 10 minutes.',
    'The processing fee is {amount} rupees.',
    'Pay to {upiSpoken}.',
    '{account}'
  ],
  electricity: [
    'Dear customer, this is from {board} electricity office. Your power will be disconnected tonight at 9:30.',
    'Your last month bill is not updated in our system.',
    'Pay {amount} rupees immediately to {upiSpoken}, or open the link {link} and pay there.'
  ]
};

const FILL = {
  officer: ['Inspector Rathore', 'Officer Vikram Singh', 'DCP Sharma', 'Inspector Meena Yadav'],
  agency: ['Mumbai Cyber Crime', 'CBI Delhi', 'Narcotics Control Bureau', 'Crime Branch Kolkata'],
  item: ['drugs and fake passports', 'MDMA and five passports', 'illegal items and fake SIM cards'],
  place: ['Taiwan', 'Cambodia', 'Malaysia', 'Thailand'],
  courier: ['FedEx', 'DHL', 'Blue Dart'],
  bank: ['SBI', 'HDFC', 'Canara Bank'],
  fname: ['Priya', 'Neha', 'Rahul', 'Anjali'],
  company: ['Digital Growth Media', 'StarReview Pvt Ltd', 'CashNow Finance', 'EasyLoan India'],
  board: ['TNEB', 'BESCOM', 'MSEB']
};
const AMOUNTS = { digital_arrest: [95000, 180000, 250000], courier: [12500, 25000, 48000], kyc: [10, 49, 99], task_job: [1000, 2000, 5000], loan_app: [1499, 2999], electricity: [10, 59] };

function spokenUpi(upi, r) {
  const [name, handle] = upi.split('@');
  const said = name.replace(/\./g, ' dot ');
  return r() < 0.5 ? `${said} at the rate ${handle}` : `${said} at the rate ${handle}. ${name.split('.')[0].toUpperCase().split('').join(' ')} ${name.includes('.') ? 'dot ' + name.split('.').slice(1).join(' dot ') : ''} at ${handle}`;
}

function spokenAccount([acct, ifsc], r) {
  const digits = r() < 0.5 ? acct.split('').join(' ') : acct.match(/.{1,4}/g).join(' ');
  const code = r() < 0.5 ? ifsc.split('').join(' ') : ifsc;
  return `If UPI is not working, do NEFT. Account number ${digits}, IFSC ${code}.`;
}

// A first-time scammer: fresh number, UPI ID and account that no ring has used yet.
function freshRing(r) {
  const base = SIM_RINGS[Math.floor(r() * SIM_RINGS.length)];
  const digits = (n) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
  const handle = ['ybl', 'ibl', 'axl', 'paytm', 'okaxis'][Math.floor(r() * 5)];
  const name = ['help', 'verify', 'secure', 'refund', 'support'][Math.floor(r() * 5)] + digits(3);
  const banks = [['SBIN', 11], ['PUNB', 13], ['BARB', 14], ['CNRB', 12], ['UBIN', 15]];
  const [bank, len] = banks[Math.floor(r() * banks.length)];
  return { ...base, key: `fresh-${digits(6)}`, speakers: 1, numbers: [`+91 9${digits(4)} ${digits(5)}`], upis: [`${name}@${handle}`], accounts: base.accounts ? [[`${1 + Math.floor(r() * 8)}${digits(len - 1)}`, `${bank}000${digits(4)}`]] : undefined };
}

export function simulatedCall(store, { ringKey, r, startedAt, channel, id, source, fresh = false }) {
  const ring = fresh ? freshRing(r) : ringKey ? SIM_RINGS.find((x) => x.key === ringKey) : weightedRing(r);
  const vars = Object.fromEntries(Object.entries(FILL).map(([k, list]) => [k, pickFrom(r, list)]));
  vars.amount = pickFrom(r, AMOUNTS[ring.type]);
  vars.upiSpoken = spokenUpi(pickFrom(r, ring.upis), r);
  vars.link = ring.links ? pickFrom(r, ring.links) : '';
  const acct = ring.accounts && r() < 0.75 ? spokenAccount(pickFrom(r, ring.accounts), r) : '';
  const lines = SCRIPTS[ring.type].map((l) => (l === '{account}' ? acct : l.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''))).filter(Boolean);
  const speaker = Math.floor(r() * ring.speakers);
  const call = runScripted(store, {
    id,
    callerNumber: pickFrom(r, ring.numbers),
    lines,
    startedAt,
    channel,
    source,
    voiceprint: syntheticVoice(`sim-${ring.key}-${speaker}`, `${id || store.data.nextId}-${startedAt}`)
  });
  return call;
}

function weightedRing(r) {
  const total = SIM_RINGS.reduce((s, x) => s + x.weight, 0);
  let x = r() * total;
  for (const ring of SIM_RINGS) if ((x -= ring.weight) < 0) return ring;
  return SIM_RINGS[0];
}

const DAY = 86400000;

// Two weeks of synthetic history: calls at plausible hours (9am-9pm IST), ids C-0007 onward.
export function generateHistory(store, now = Date.now(), count = 26) {
  const r = rng('chakravyuh-history');
  const startOfToday = now - (now % DAY);
  for (let i = 0; i < count; i++) {
    const day = 13 - Math.floor((i / count) * 14);
    const startedAt = startOfToday - day * DAY + (3.5 + r() * 12) * 3600e3; // 9:00-21:30 IST in UTC terms
    if (startedAt > now - 3600e3) continue;
    simulatedCall(store, { r, startedAt, channel: 'seed', id: `C-${String(7 + i).padStart(4, '0')}` });
  }
}

const OPERATORS = ['Airtel', 'Jio', 'Vi', 'BSNL'];

// Telco diversion: flagged fraud calls arrive over a SIP trunk and the decoy takes them.
export function simulateTelcoBatch(store, count = 10, now = Date.now()) {
  const r = rng(`telco-${now}`);
  const calls = [];
  for (let i = 0; i < count; i++) {
    const startedAt = now - (count - i) * 25000;
    const operator = pickFrom(r, OPERATORS);
    calls.push(simulatedCall(store, { r, startedAt, channel: 'telco-divert', fresh: r() < 0.25, source: { operator, flag: pickFrom(r, ['spam-score 0.97', 'reported 14 times on Chakshu', 'known fraud series', 'AI spam filter: fraud']) } }));
  }
  return calls;
}
