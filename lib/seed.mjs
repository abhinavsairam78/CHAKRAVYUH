// Synthetic history so the ring graph is not empty on stage, and the two rehearsal calls that
// back up the live demo. Every number, UPI ID and account here is made up.

import { startCall, scammerTurn, decoyReply, endCall } from './calls.mjs';
import { generateHistory } from './simulate.mjs';

function gaussian(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
}

// A "speaker" is a random 32-dim direction; each call adds noise, like a new recording of the same voice.
export function syntheticVoice(speaker, take, noise = 0.25) {
  const base = gaussian(`speaker:${speaker}`);
  const jitter = gaussian(`take:${speaker}:${take}`);
  return { kind: 'synthetic', vector: Array.from({ length: 32 }, () => Number((base() + noise * jitter()).toFixed(4))) };
}

export const REHEARSAL = [
  {
    id: 'call-1',
    title: 'Call 1 · FedEx parcel → digital arrest',
    callerNumber: '+91 98401 23456',
    speaker: 'rehearsal-A',
    lines: [
      'Hello, am I speaking with the owner of this number? This is FedEx international courier, Mumbai branch.',
      'Madam, a parcel booked on your Aadhaar to Taiwan has been seized by customs. It contains five passports and 200 grams of MDMA drugs.',
      'I am transferring your call to Mumbai Cyber Crime. Officer Vikram Singh from CBI will speak to you. This is a digital arrest, you cannot disconnect the call.',
      'Your Aadhaar is linked to a money laundering case. If you do not cooperate, a non-bailable warrant will be issued and police will come to your house in two hours.',
      'To verify your funds, you must transfer the amount to the RBI secure verification account. It will be refunded after investigation.',
      'Send it by UPI to verify dot rbi at the rate okaxis. V E R I F Y dot R B I at okaxis.',
      'Then do NEFT. Account number 5 0 1 0 0 4 4 7 2 1 9 3 8 6, IFSC code H D F C 0 0 0 1 2 3 4. Account name Secure Settlement Services.',
      'Madam, do it fast, the officer is waiting. Transfer 1 lakh 80 thousand rupees now.'
    ]
  },
  {
    id: 'call-2',
    title: 'Call 2 · SBI KYC (new number, same voice)',
    callerNumber: '+91 70100 98765',
    speaker: 'rehearsal-A',
    lines: [
      'Good afternoon sir, I am calling from SBI KYC department. Your account KYC has expired.',
      'If you do not update your PAN card today, your account will be blocked tonight and your pension will stop.',
      'Sir, do not worry, it is a simple process. You have to pay a 10 rupees verification charge.',
      'Pay to kyc dot update at the rate ybl. K Y C dot update at ybl.',
      'Okay, if UPI is not working, do a bank transfer. Account number 50100447219386, IFSC HDFC0001234.',
      'Sir, also tell me the OTP you will receive now.',
      'Fast sir, the system will lock in 10 minutes.'
    ]
  }
];

const DAY = 86400000;

export function runScripted(store, { id, callerNumber, lines, voiceprint, startedAt, channel = 'seed', lang = 'en', source }) {
  const call = startCall(store, { id, callerNumber, lang, channel, startedAt, source });
  let t = 4;
  for (const line of lines) {
    t += Math.max(4, line.split(/\s+/).length / 2.4);
    const { reply } = scammerTurn(call, line, t);
    t += 1.2;
    decoyReply(call, reply, t);
    t += Math.max(3, reply.split(/\s+/).length / 2.2) + 6; // stalls and "one minute" pauses
  }
  endCall(call, { voiceprint, endedAt: startedAt + t * 1000 });
  return call;
}

export function seedHistory(store, now = Date.now()) {
  runScripted(store, {
    id: 'C-0001', callerNumber: '+91 91234 56780', startedAt: now - 6 * DAY + 3.1 * 3600e3, voiceprint: syntheticVoice('ring-a-caller', 1),
    lines: [
      'Hello, this is Blue Dart courier calling from Mumbai hub. A parcel in your name has been held by customs.',
      'The parcel contains illegal items, four fake passports and drugs. Customs has seized it.',
      'Madam, to clear the parcel and avoid a police case you must pay the customs penalty now.',
      'Pay 25000 rupees to customs dot clearance at the rate paytm. C U S T O M S dot clearance at paytm.',
      'Do it fast madam, otherwise the case goes to Mumbai police in one hour.'
    ]
  });
  runScripted(store, {
    id: 'C-0002', callerNumber: '+91 88990 01122', startedAt: now - 4 * DAY + 5.4 * 3600e3, voiceprint: syntheticVoice('ring-a-caller', 2),
    lines: [
      'This is Inspector Rathore from Mumbai Cyber Crime. Your Aadhaar was used to book a parcel with drugs.',
      'You are under digital arrest. Do not disconnect this video call and do not tell anyone.',
      'A non bailable warrant is ready. To prove you are innocent you must transfer your savings for RBI verification.',
      'Send the money to customs dot clearance at paytm first, then the rest by NEFT.',
      'Account number 3 9 8 7 6 5 4 3 2 1 0, IFSC S B I N 0 0 0 4 5 6 7.'
    ]
  });
  runScripted(store, {
    id: 'C-0003', callerNumber: '+91 88990 01122', startedAt: now - 2 * DAY + 2.2 * 3600e3, voiceprint: syntheticVoice('ring-a-second', 1),
    lines: [
      'Sir I am calling from FedEx. Your parcel to Malaysia was stopped at customs.',
      'There are drugs and passports in it. I will connect you to the police officer.',
      'Sir the officer says you must pay a verification fee. Account number 39876543210, IFSC SBIN0004567.'
    ]
  });
  const s4 = runScripted(store, {
    id: 'C-0004', callerNumber: '+91 70012 34567', startedAt: now - 5 * DAY + 7.5 * 3600e3, voiceprint: syntheticVoice('ring-b-priya', 1),
    lines: [
      'Hello, I am Priya from Digital Growth Media. We are offering a part time work from home job.',
      'You just have to like YouTube videos and give hotel reviews. You can earn 3000 to 5000 rupees per day.',
      'First complete three free tasks, then join our Telegram group for prepaid tasks with high commission.',
      'Okay, what is your full name and your address? I need it for registration.',
      'For the prepaid task deposit 1000 rupees to earn dot daily at ibl. E A R N dot daily at ibl.'
    ]
  });
  runScripted(store, {
    id: 'C-0005', callerNumber: '+91 60098 76543', startedAt: now - 1 * DAY + 4.3 * 3600e3, voiceprint: syntheticVoice('ring-b-second', 1),
    lines: [
      `Hello, am I speaking to ${s4.honeytoken.fullName}, ${s4.honeytoken.address}? I am calling from Digital Growth Media.`,
      'We are offering a part time work from home job. You just have to like YouTube videos and give hotel reviews.',
      'You can earn 3000 to 5000 rupees per day. Join our Telegram group for prepaid tasks with high commission.',
      'Deposit 2000 rupees. Account number 921010045678123, IFSC UTIB0000123.'
    ]
  });
  runScripted(store, {
    id: 'C-0006', callerNumber: '+91 99887 76655', startedAt: now - 3 * DAY + 6 * 3600e3, voiceprint: syntheticVoice('electricity', 1),
    lines: [
      'Dear customer, this is from TNEB electricity office. Your power will be disconnected tonight at 9:30.',
      'Your last month bill was not updated. Pay 10 rupees immediately to update.',
      'Pay to powerbill dot update at axl, or open the link tneb-bill-update.online and pay there.'
    ]
  });
  generateHistory(store, now);
  store.save();
}
