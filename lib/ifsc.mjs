// Offline IFSC check: format plus the bank-code prefix (first 4 letters).
// Optional live branch lookup against Razorpay's free public IFSC API when IFSC_LIVE=1.

export const BANKS = {
  SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank',
  PUNB: 'Punjab National Bank', BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India',
  KKBK: 'Kotak Mahindra Bank', YESB: 'Yes Bank', IDIB: 'Indian Bank', IOBA: 'Indian Overseas Bank',
  BKID: 'Bank of India', MAHB: 'Bank of Maharashtra', CBIN: 'Central Bank of India', IDFB: 'IDFC First Bank',
  INDB: 'IndusInd Bank', FDRL: 'Federal Bank', AIRP: 'Airtel Payments Bank', PYTM: 'Paytm Payments Bank',
  FINO: 'Fino Payments Bank', KVBL: 'Karur Vysya Bank', CIUB: 'City Union Bank', TMBL: 'Tamilnad Mercantile Bank',
  KARB: 'Karnataka Bank', SIBL: 'South Indian Bank', UCBA: 'UCO Bank', PSIB: 'Punjab & Sind Bank',
  JAKA: 'Jammu & Kashmir Bank', RATN: 'RBL Bank', AUBL: 'AU Small Finance Bank', ESFB: 'Equitas Small Finance Bank',
  UJVN: 'Ujjivan Small Finance Bank', DBSS: 'DBS Bank India', BDBL: 'Bandhan Bank', IPOS: 'India Post Payments Bank',
  CSBK: 'CSB Bank', DLXB: 'Dhanlaxmi Bank', NSPB: 'NSDL Payments Bank', JIOP: 'Jio Payments Bank'
};

const FORMAT = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function checkIfsc(code) {
  const ifsc = String(code || '').toUpperCase();
  if (!FORMAT.test(ifsc)) return { ifsc, valid: false, reason: 'Format must be 4 letters, 0, then 6 characters' };
  const bank = BANKS[ifsc.slice(0, 4)];
  if (!bank) return { ifsc, valid: false, reason: `Unknown bank code ${ifsc.slice(0, 4)}` };
  return { ifsc, valid: true, bank, source: 'offline bank-code table' };
}

export async function checkIfscLive(code) {
  const offline = checkIfsc(code);
  if (!offline.valid || process.env.IFSC_LIVE !== '1') return offline;
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${offline.ifsc}`, { signal: AbortSignal.timeout(2500) });
    if (res.status === 404) return { ...offline, valid: false, reason: 'No such branch (Razorpay IFSC lookup)' };
    const data = await res.json();
    return { ...offline, branch: data.BRANCH, city: data.CITY, state: data.STATE, source: 'Razorpay IFSC API' };
  } catch {
    return offline;
  }
}
