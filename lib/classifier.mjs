// Scam-type classifier over the scammer's turns so far. Weighted cue phrases, no training needed.
// Production path: an LLM few-shot label or a small fine-tuned classifier on collected calls.

import { normalizeSpoken } from './extract.mjs';

export const SCAM_TYPES = {
  digital_arrest: {
    label: 'Digital arrest',
    cues: [[/போலீஸ்|கைது|சிபிஐ|வாரண்ட்/, 3], [/\bcbi\b|crime branch|narcotics|\bncb\b|enforcement directorate/, 3], [/digital arrest|arrest warrant|non.?bailable|warrant/, 3],
      [/money laundering|drugs|mdma|passports/, 2], [/police|cyber ?crime|officer|court|case/, 1], [/video call|skype|cannot disconnect|do not disconnect/, 2],
      [/गिरफ्तार|पुलिस|सीबीआई/, 3]]
  },
  courier: {
    label: 'Courier / parcel',
    cues: [[/பார்சல்|கூரியர்/, 3], [/fedex|fed ex|dhl|blue ?dart|courier/, 3], [/parcel|package|shipment|consignment/, 2], [/customs|seized|taiwan|illegal items/, 1], [/पार्सल|कूरियर/, 3]]
  },
  kyc: {
    label: 'KYC / account block',
    cues: [[/கேஒய்சி|பிளாக் ஆகும்/, 3], [/\bkyc\b|re-?kyc/, 3], [/pan card|aadhaar link|update your/, 2], [/blocked|suspended|deactivated|will be closed|expired/, 2],
      [/sbi|bank (?:department|manager|officer)|customer care/, 1], [/केवाईसी|ब्लॉक/, 3]]
  },
  task_job: {
    label: 'Task / part-time job',
    cues: [[/பார்ட் டைம்|டாஸ்க்/, 3], [/part.?time|work from home|task|prepaid task/, 3], [/youtube|like (?:the )?videos|ratings?|reviews?|hotel reviews/, 2],
      [/commission|earn|per day|daily income|salary/, 2], [/telegram|mentor|vip level/, 2]]
  },
  loan_app: {
    label: 'Instant loan app',
    cues: [[/லோன்|கடன்/, 3], [/\bloan\b|instant cash/, 3], [/processing fee|approval|sanction|disburse/, 2], [/cibil|credit score|emi/, 2], [/लोन/, 3]]
  },
  electricity: {
    label: 'Electricity bill',
    cues: [[/கரண்ட்|மின்சார/, 3], [/electricity|power (?:cut|supply)|tneb|bescom|eb bill|current bill/, 3], [/disconnect|tonight|9 ?(?:pm|o.?clock)|last bill/, 2], [/बिजली/, 3]]
  },
  sextortion: {
    label: 'Sextortion',
    cues: [[/nude|obscene|private video|viral|morphed/, 3], [/video call recording|your video/, 2]]
  }
};

export function classifyScam(scammerTexts) {
  const text = normalizeSpoken(scammerTexts.join(' '));
  const scores = {};
  for (const [type, def] of Object.entries(SCAM_TYPES)) {
    scores[type] = def.cues.reduce((sum, [re, w]) => sum + (re.test(text) ? w : 0), 0);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, topScore] = ranked[0];
  const second = ranked[1][1];
  if (topScore < 2) return { type: 'unknown', label: 'Not yet classified', confidence: 0, scores };
  // Confidence grows with the absolute score and the margin over the runner-up.
  const confidence = Math.min(0.97, 0.35 + 0.08 * topScore + 0.06 * (topScore - second));
  return { type: top, label: SCAM_TYPES[top].label, confidence: Number(confidence.toFixed(2)), scores };
}
