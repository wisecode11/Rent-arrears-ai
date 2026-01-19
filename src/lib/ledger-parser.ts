import { LedgerEntry, NonRentalCharge, RentalCharge } from '@/types';

export type ChargeCategory =
  | 'rent'
  | 'late_fee'
  | 'legal_fees'
  | 'bad_check'
  | 'security_deposit'
  | 'maintenance'
  | 'utilities'
  | 'internet'
  | 'air_conditioner'
  | 'parking'
  | 'admin_fee'
  | 'other';

export interface ClassifiedDescription {
  isPayment: boolean;
  isRentalCharge: boolean;
  isNonRentalCharge: boolean;
  category?: ChargeCategory;
}

const PAYMENT_KEYWORDS = [
  'payment',
  'paid',
  'receipt',
  'recpt',
  'ach',
  'eft',
  'wire',
  'check',
  'chk',
  'money order',
  'clickpay',
  'refund',
  'reversal',
  'reversed',
  'void',
];

// If a description contains RENT but also one of these, it is NOT "base rent" (treat as non-rent).
const RENT_OVERRIDE_NON_RENT = [
  'parking',
  'garage',
  'storage',
  'pet',
  'utility',
  'utilities',
  'water',
  'sewer',
  'trash',
  'electric',
  'gas',
  'internet',
  'wifi',
  'cable',
];

const RENT_KEYWORDS = [
  'base rent',
  'rent',
  'monthly rent',
  'rental charge',
  'affrent',
];

const NON_RENT_KEYWORDS: Array<{ keyword: string; category: ChargeCategory }> = [
  { keyword: 'late fee', category: 'late_fee' },
  { keyword: 'late charge', category: 'late_fee' },
  { keyword: 'legal', category: 'legal_fees' },
  { keyword: 'attorney', category: 'legal_fees' },
  { keyword: 'court', category: 'legal_fees' },
  { keyword: 'nsf', category: 'bad_check' },
  { keyword: 'bad check', category: 'bad_check' },
  { keyword: 'returned check', category: 'bad_check' },
  { keyword: 'security deposit', category: 'security_deposit' },
  { keyword: 'deposit', category: 'security_deposit' },
  { keyword: 'maintenance', category: 'maintenance' },
  { keyword: 'repair', category: 'maintenance' },
  { keyword: 'work order', category: 'maintenance' },
  { keyword: 'water', category: 'utilities' },
  { keyword: 'sewer', category: 'utilities' },
  { keyword: 'trash', category: 'utilities' },
  { keyword: 'electric', category: 'utilities' },
  { keyword: 'gas', category: 'utilities' },
  { keyword: 'utility', category: 'utilities' },
  { keyword: 'utilities', category: 'utilities' },
  { keyword: 'internet', category: 'internet' },
  { keyword: 'wifi', category: 'internet' },
  { keyword: 'broadband', category: 'internet' },
  { keyword: 'cable', category: 'internet' },
  { keyword: 'air conditioner', category: 'air_conditioner' },
  { keyword: 'a/c', category: 'air_conditioner' },
  { keyword: 'ac ', category: 'air_conditioner' },
  { keyword: 'parking', category: 'parking' },
  { keyword: 'garage', category: 'parking' },
  { keyword: 'admin', category: 'admin_fee' },
  { keyword: 'administrative', category: 'admin_fee' },
  { keyword: 'service fee', category: 'admin_fee' },
  { keyword: 'processing fee', category: 'admin_fee' },
  { keyword: 'fee', category: 'other' },
];

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyDescription(description: string): ClassifiedDescription {
  const d = normalizeText(description);

  const isPayment = PAYMENT_KEYWORDS.some((k) => d.includes(k));
  if (isPayment) {
    return { isPayment: true, isRentalCharge: false, isNonRentalCharge: false };
  }

  // Explicit non-rent keywords win.
  for (const { keyword, category } of NON_RENT_KEYWORDS) {
    if (d.includes(keyword)) {
      return { isPayment: false, isRentalCharge: false, isNonRentalCharge: true, category };
    }
  }

  const hasRent = RENT_KEYWORDS.some((k) => d.includes(k));
  if (hasRent) {
    const overridden = RENT_OVERRIDE_NON_RENT.some((k) => d.includes(k));
    if (overridden) {
      return { isPayment: false, isRentalCharge: false, isNonRentalCharge: true, category: 'other' };
    }
    return { isPayment: false, isRentalCharge: true, isNonRentalCharge: false, category: 'rent' };
  }

  return { isPayment: false, isRentalCharge: false, isNonRentalCharge: false };
}

export function parseMoney(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // Ignore obvious control numbers (no decimal, large integer)
  const noCurrency = s.replace(/\$/g, '').trim();

  const negativeByParens = noCurrency.startsWith('(') && noCurrency.endsWith(')');
  const cleaned = noCurrency.replace(/[(),]/g, '').trim();

  // If it has no decimal and looks like a control number, ignore it.
  if (!cleaned.includes('.') && /^\d+$/.test(cleaned) && cleaned.length >= 5) return null;

  const num = Number.parseFloat(cleaned);
  if (Number.isNaN(num)) return null;
  return negativeByParens ? -Math.abs(num) : num;
}

export function parseFlexibleDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2].padStart(2, '0');
    const dd = iso[3].padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // MM/DD/YYYY or DD/MM/YYYY (disambiguate using >12 rule)
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slash) {
    let a = Number.parseInt(slash[1], 10);
    let b = Number.parseInt(slash[2], 10);
    const yearPart = Number.parseInt(slash[3], 10);
    const yyyy = yearPart < 100 ? (yearPart >= 70 ? 1900 + yearPart : 2000 + yearPart) : yearPart;

    // If first part > 12, it's almost certainly DD/MM
    let mm = a;
    let dd = b;
    if (a > 12 && b <= 12) {
      dd = a;
      mm = b;
    }

    const mmStr = String(mm).padStart(2, '0');
    const ddStr = String(dd).padStart(2, '0');
    return `${yyyy}-${mmStr}-${ddStr}`;
  }

  // MM-DD-YYYY
  const dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if (dash) {
    const mm = dash[1].padStart(2, '0');
    const dd = dash[2].padStart(2, '0');
    const yearPart = Number.parseInt(dash[3], 10);
    const yyyy = yearPart < 100 ? (yearPart >= 70 ? 1900 + yearPart : 2000 + yearPart) : yearPart;
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

const DATE_TOKEN_REGEX =
  /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/;

const MONEY_TOKEN_REGEX =
  /(\(?-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?|\(?-?\$?\d+(?:\.\d{2})?\)?)/g;

export interface ParsedLedgerResult {
  ledgerEntries: LedgerEntry[];
  // lines that look like ledger rows but couldn't be confidently parsed
  rejectedLines: string[];
}

function stripTrailingMoneyTokens(line: string): string {
  return line.replace(MONEY_TOKEN_REGEX, ' ').replace(/\s+/g, ' ').trim();
}

export function parseLedgerFromText(text: string): ParsedLedgerResult {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rejectedLines: string[] = [];
  const entries: Array<LedgerEntry & { _idx: number }> = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    // Skip obvious non-row lines.
    const upper = line.toUpperCase();
    if (upper.includes('PAGE ') || upper.startsWith('TOTAL')) continue;

    const dateToken = line.match(DATE_TOKEN_REGEX)?.[1];
    if (!dateToken) continue;

    const date = parseFlexibleDate(dateToken);
    if (!date) continue;

    const moneyTokens = [...line.matchAll(MONEY_TOKEN_REGEX)].map((m) => m[1]);
    const amounts = moneyTokens
      .map(parseMoney)
      .filter((n): n is number => typeof n === 'number' && !Number.isNaN(n));

    // Need at least one amount and a date to be a ledger row
    if (amounts.length < 1) continue;

    // Heuristic: balance is usually the last monetary value (after removing control numbers).
    const balance = amounts.length >= 2 ? amounts[amounts.length - 1] : amounts[0];

    // Determine debit/credit from remaining amounts.
    const nonBalance = amounts.length >= 2 ? amounts.slice(0, -1) : [];

    const description = stripTrailingMoneyTokens(line)
      .replace(dateToken, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\d+\s+/, ''); // strip leading charge codes if present

    const cls = classifyDescription(description);

    let debit = 0;
    let credit = 0;

    if (nonBalance.length >= 2) {
      // Common format: debit, credit, balance
      debit = Math.max(0, nonBalance[0]);
      credit = Math.max(0, nonBalance[1]);
    } else if (nonBalance.length === 1) {
      const amt = nonBalance[0];
      if (cls.isPayment || amt < 0) {
        credit = Math.abs(amt);
      } else {
        debit = Math.abs(amt);
      }
    } else {
      // Only one monetary token; can't safely split into debit/credit/balance.
      // Treat it as balance-only row and skip charge extraction.
      debit = 0;
      credit = 0;
    }

    entries.push({
      _idx: idx,
      date,
      description: description || 'Unknown',
      debit: debit > 0 ? debit : 0,
      credit: credit > 0 ? credit : 0,
      balance,
      isRental: cls.isRentalCharge ? true : cls.isNonRentalCharge ? false : undefined,
    });
  }

  // If we got very few entries but we saw lots of date lines, retain a small sample of rejections for debugging.
  if (entries.length < 3) {
    for (const line of lines) {
      if (line.match(DATE_TOKEN_REGEX)) rejectedLines.push(line);
      if (rejectedLines.length >= 20) break;
    }
  }

  // Sort by date ascending; stable by original index for same-day ordering.
  const sorted = entries
    .sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      if (da !== db) return da - db;
      return a._idx - b._idx;
    })
    .map(({ _idx, ...rest }) => rest);

  return { ledgerEntries: sorted, rejectedLines };
}

export function chargesFromLedgerEntries(ledgerEntries: LedgerEntry[]): {
  rentalCharges: RentalCharge[];
  nonRentalCharges: NonRentalCharge[];
} {
  const rentalCharges: RentalCharge[] = [];
  const nonRentalCharges: NonRentalCharge[] = [];

  for (const e of ledgerEntries) {
    const debit = e.debit ?? 0;
    if (debit <= 0) continue;

    const cls = classifyDescription(e.description);
    if (cls.isPayment) continue;

    if (e.isRental === true || cls.isRentalCharge) {
      rentalCharges.push({ description: e.description, amount: debit, date: e.date });
      continue;
    }

    // Default: any non-payment debit that isn't clearly rent is treated as non-rental.
    nonRentalCharges.push({
      description: e.description,
      amount: debit,
      date: e.date,
      category: cls.category && cls.category !== 'rent' ? cls.category : 'other',
    });
  }

  return { rentalCharges, nonRentalCharges };
}


