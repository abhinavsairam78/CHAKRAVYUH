// The playbook library: for each scam type, how it is recognised, which persona answers, what the
// scammer will ask for, and how the decoy steers each stage toward the payment details.

import { SCAM_TYPES } from './classifier.mjs';
import { personaForType, lines } from './persona.mjs';

const DETAIL = {
  digital_arrest: {
    story: 'Fake police, CBI or narcotics officers claim the victim\'s Aadhaar is linked to a crime and hold them on a "digital arrest" video call.',
    redFlags: ['Claims to be police, CBI, ED or NCB', '"Do not disconnect" and "do not tell anyone"', 'Money "for verification" that will be "refunded"', 'Threat of an arrest warrant within hours'],
    asks: ['Transfer savings to an "RBI verification" account', 'Stay on a video call for hours', 'Aadhaar and bank details'],
    tactics: ['Retired teacher: respectful, frightened, slow with technology', 'Offers to pay early to reach the payment step', 'Reads back every account digit by digit', 'Stalls with failed transfers and lost spectacles']
  },
  courier: {
    story: 'A courier "agent" says a parcel in the victim\'s name was seized with drugs or passports, then hands over to fake customs or police.',
    redFlags: ['Parcel the victim never sent', 'Drugs, passports or SIM cards "found inside"', 'Customs penalty to avoid a police case'],
    asks: ['Customs clearance fee by UPI', 'Transfer to a "customs" account'],
    tactics: ['Confused about the parcel, asks what was inside', 'Accepts the penalty and asks where to pay', 'Mishears the destination country to make them repeat']
  },
  kyc: {
    story: 'A "bank officer" says KYC has expired and the account will be blocked today unless a small fee is paid or an OTP is shared.',
    redFlags: ['Account "blocked today"', 'Small verification charge', 'Asks for OTP or app installation'],
    asks: ['Small UPI payment', 'OTP', 'Remote-access app like AnyDesk'],
    tactics: ['Shop owner worried about supplier payments', 'Never reads an OTP: "message has not come"', 'Refuses app installs: "my grandson does that"']
  },
  task_job: {
    story: 'A recruiter offers paid "tasks" (likes, reviews), pays small amounts first, then demands deposits for "prepaid" or "VIP" tasks.',
    redFlags: ['Easy money for likes or reviews', 'Telegram groups and mentors', 'Deposits to unlock higher levels'],
    asks: ['Deposit for prepaid tasks', 'Transfer to a "company" account'],
    tactics: ['Student who needs fee money: eager and asks how to start', 'Asks where to deposit for the next level', 'Gives a honeytoken name and address when asked']
  },
  loan_app: {
    story: 'An "instant loan" is approved but needs a processing fee first; the loan never arrives.',
    redFlags: ['Loan approved without documents', 'Fee before disbursal'],
    asks: ['Processing fee by UPI'],
    tactics: ['Shop owner who urgently needs the loan', 'Asks how to pay the fee, then hits "UPI limits" to get an account number']
  },
  electricity: {
    story: 'A fake electricity-board message or call says power will be cut tonight unless a small "bill update" is paid.',
    redFlags: ['Disconnection tonight', 'Bill "not updated"', 'Link to pay'],
    asks: ['Small UPI payment', 'Payment through a link'],
    tactics: ['Worried about a family member at home', 'Never opens links, asks for UPI instead']
  },
  sextortion: {
    story: 'A caller threatens to release a morphed or recorded video unless paid.',
    redFlags: ['Threat to share a video', 'Payment to delete it'],
    asks: ['Payment to "delete" the video'],
    tactics: ['Stays confused and does not engage with sexual content', 'Ends the call early if the caller turns abusive']
  }
};

const STAGE_GOALS = [
  ['HOOK', 'Let the caller explain; classify within 3 to 4 turns'],
  ['TRUST', 'Switch to the matching persona and sound like the ideal victim'],
  ['PRESSURE', 'Sound frightened; invite the payment demand'],
  ['PAYMENT', 'Agree to pay and ask where to send it'],
  ['EXTRACT', 'Get UPI ID, then account and IFSC; read each back'],
  ['STALL', 'Keep them on the line with believable failures']
];

export function playbooks() {
  return Object.entries(SCAM_TYPES).map(([type, def]) => {
    const persona = personaForType(type);
    const en = lines('en');
    return {
      type,
      label: def.label,
      persona: { name: persona.name, age: persona.age, role: persona.role },
      cues: def.cues.map(([re, w]) => ({ pattern: re.source.replace(/\\b/g, '').replace(/\|/g, ' · '), weight: w })),
      ...DETAIL[type],
      stages: STAGE_GOALS.map(([id, goal]) => ({ id, goal })),
      sampleLines: [].concat(en.trust[type] || [], (en.scaredType?.[type] || en.scared).slice(0, 1), (en.steerType?.[type] || en.steer).slice(0, 1), en.askUpi.slice(0, 1), en.askAccount.slice(0, 1))
    };
  });
}
