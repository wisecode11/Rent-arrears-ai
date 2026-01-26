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
  // Balance-forward / opening-balance rows are NOT charges and must not be counted as non-rent.
  // Examples: "YEAR STARTING BALANCE 2016", "BALANCE FORWARD", "BEGINNING BALANCE".
  isBalanceForward: boolean;
  category?: ChargeCategory;
}

/**
 * Intelligent keyword matching that handles:
 * - Exact matches
 * - Word variations (plural, verb forms)
 * - Abbreviations
 * - Combined/merged text (no spaces)
 * - CamelCase and concatenated words
 */
function intelligentKeywordMatch(text: string, keyword: string): boolean {
  const t = text.toLowerCase();
  const k = keyword.toLowerCase();
  
  // Exact match
  if (t.includes(k)) return true;
  
  // Handle merged text (no spaces): "latecharge" matches "late charge"
  const mergedKeyword = k.replace(/\s+/g, '');
  if (t.includes(mergedKeyword)) return true;
  
  // Handle CamelCase: "LateCharge" matches "late charge"
  const camelKeyword = k.replace(/\s+(\w)/g, (_, c) => c.toUpperCase());
  if (t.includes(camelKeyword.toLowerCase())) return true;
  
  // Handle common abbreviations
  const abbreviations: Record<string, string[]> = {
    'payment': ['pmt', 'pymt', 'pay'],
    'charge': ['chg', 'chrg'],
    'deposit': ['dep', 'dpt'],
    'security': ['sec', 'scty'],
    'maintenance': ['maint', 'mnt'],
    'electric': ['elec', 'elct'],
    'utility': ['util'],
    'water': ['wtr'],
    'internet': ['inet', 'int'],
    'administrative': ['admin', 'adm'],
    'late fee': ['lf', 'latefee', 'latechg', 'late chg'],
    'nsf': ['nsf fee', 'nsffee', 'bounced', 'returned'],
  };
  
  for (const [full, abbrs] of Object.entries(abbreviations)) {
    if (k.includes(full)) {
      for (const abbr of abbrs) {
        if (t.includes(abbr)) return true;
      }
    }
  }
  
  return false;
}

const PAYMENT_KEYWORDS = [
  'payment',
  'paid',
  'receipt',
  'recpt',
  'ach',
  'eft',
  'wire',
  // NOTE: Removed generic 'check' - it caused false positives for 'Returned check charge' (NSF).
  // Keep 'chk' which matches payment references like 'chk#123456'
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

// Comprehensive list of rental-related keywords and synonyms
// These are all classified as RENTAL charges (not non-rental)
const RENT_KEYWORDS = [
  // Standard rent terms
  'base rent',
  'rent',
  'monthly rent',
  'rental charge',
  'rental charges',
  'rent charge',
  'rent charges',
  
  // Affordable/subsidized housing terms
  'affordable rent',
  'affordable housing',
  'affrent',
  'aff rent',
  'subsidized rent',
  'section 8 rent',
  'hud rent',
  'lihtc rent',
  'tax credit rent',
  
  // Use and Occupancy (UAO) - common rental term
  'use of occupancy',
  'use and occupancy',
  'uao',
  'u&o',
  'occupancy charge',
  'occupancy fee',
  
  // Residential/housing rent
  'residential rent',
  'housing rent',
  'dwelling rent',
  'apartment rent',
  'unit rent',
  
  // Legal rent terms
  'legal rent',
  'contract rent',
  'lease rent',
  'tenant rent',
  'gross rent',
  'net rent',
  
  // Prorated rent
  'prorated rent',
  'pro-rated rent',
  'pro rated rent',
  'partial rent',
  
  // Market rent
  'market rent',
  'fair market rent',
  'fmr',
  
  // Other rental variations
  'room rent',
  'bed rent',
  'lodging',
  'tenancy',
  'rent due',
  'rent owed',
  'rent payment',
  'rent for',
  
  // Rent adjustments (only if explicitly about rent)
  'rent adjustment',
  'rent correction',
  'rent updated',
  'renewal presented',
  'updated renewal',
  
  // Common codes
  'resrent',
  'res rent',
  'resident rent',
];

// Rows that represent a carry-forward/opening balance, not an actual charge.
// IMPORTANT: These can appear with a "billed" amount equal to the existing balance due,
// but should never be counted as a non-rental charge.
const BALANCE_FORWARD_KEYWORDS = [
  'year starting balance',
  'starting balance',
  'beginning balance',
  'opening balance',
  'balance forward',
  'balance brought forward',
  'brought forward',
  'carry forward',
  'carried forward',
  'previous balance',
  'prior balance',
  'balance carried forward',
  'balance b/f',
];

const NON_RENT_KEYWORDS: Array<{ keyword: string; category: ChargeCategory }> = [
  { keyword: 'late fee', category: 'late_fee' },
  { keyword: 'late fees', category: 'late_fee' },
  { keyword: 'late charge', category: 'late_fee' },
  { keyword: 'late charges', category: 'late_fee' },
  { keyword: 'latefee', category: 'late_fee' },
  { keyword: 'legal', category: 'legal_fees' },
  { keyword: 'attorney', category: 'legal_fees' },
  { keyword: 'court', category: 'legal_fees' },
  { keyword: 'nsf', category: 'bad_check' },
  { keyword: 'nsf check fee', category: 'bad_check' },
  { keyword: 'nsffee', category: 'bad_check' },
  { keyword: 'bad check', category: 'bad_check' },
  { keyword: 'returned check', category: 'bad_check' },
  { keyword: 'bounced check', category: 'bad_check' },
  { keyword: 'security deposit', category: 'security_deposit' },
  { keyword: 'secdep', category: 'security_deposit' },
  { keyword: 'deposit', category: 'security_deposit' },
  { keyword: 'maintenance', category: 'maintenance' },
  { keyword: 'repair', category: 'maintenance' },
  { keyword: 'work order', category: 'maintenance' },
  // NOTE: Use and Occupancy (UAO) is classified as RENTAL, not non-rental
  // True-up and adjustments for rent are also rental-related
  { keyword: 'water', category: 'utilities' },
  { keyword: 'sewer', category: 'utilities' },
  { keyword: 'trash', category: 'utilities' },
  { keyword: 'electric', category: 'utilities' },
  { keyword: 'gas', category: 'utilities' },
  { keyword: 'utility', category: 'utilities' },
  { keyword: 'utilities', category: 'utilities' },
  // Utility meter reading patterns (common in Resident Ledger format)
  { keyword: 'readings:', category: 'utilities' },
  { keyword: 'meter#', category: 'utilities' },
  { keyword: 'usage=', category: 'utilities' },
  { keyword: 'cost_kwh', category: 'utilities' },
  { keyword: 'salestax=', category: 'utilities' },
  { keyword: 'period:', category: 'utilities' },
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

  // "Legal Rent" is still RENT (common wording in some tenant ledgers).
  // Without this, the generic "legal" keyword would incorrectly classify it as legal fees (non-rental).
  if (/legal\s*rent/.test(d)) {
    return {
      isPayment: false,
      isRentalCharge: true,
      isNonRentalCharge: false,
      isBalanceForward: false,
      category: 'rent',
    };
  }

  // Balance-forward/opening-balance rows are NOT charges.
  // Use intelligent matching for variations like "BalanceForward", "bal fwd", etc.
  if (BALANCE_FORWARD_KEYWORDS.some((k) => intelligentKeywordMatch(d, k))) {
    return {
      isPayment: false,
      isRentalCharge: false,
      isNonRentalCharge: false,
      isBalanceForward: true,
    };
  }

  // IMPORTANT: Check for specific non-rent charge patterns FIRST (like NSF, returned check)
  // before checking payment keywords, to avoid false positives.
  // Example: "Returned check charge" should be NSF (non-rent), not payment.
  const specificNonRentPatterns = [
    { pattern: 'returned check', category: 'bad_check' as ChargeCategory },
    { pattern: 'bounced check', category: 'bad_check' as ChargeCategory },
    { pattern: 'nsf', category: 'bad_check' as ChargeCategory },
    { pattern: 'bad check', category: 'bad_check' as ChargeCategory },
    { pattern: 'uncollected funds', category: 'bad_check' as ChargeCategory },
    { pattern: 'dishonored', category: 'bad_check' as ChargeCategory },
  ];
  for (const { pattern, category } of specificNonRentPatterns) {
    if (intelligentKeywordMatch(d, pattern)) {
      return {
        isPayment: false,
        isRentalCharge: false,
        isNonRentalCharge: true,
        isBalanceForward: false,
        category,
      };
    }
  }

  // Check payment keywords AFTER specific non-rent patterns.
  // Example: "NSF receipt ... Uncollected Funds" is a PAYMENT (bounced check reversal), not a charge.
  // Priority: receipt/reversal/refund indicates payment/credit.
  const isPayment = PAYMENT_KEYWORDS.some((k) => intelligentKeywordMatch(d, k));
  if (isPayment) {
    return {
      isPayment: true,
      isRentalCharge: false,
      isNonRentalCharge: false,
      isBalanceForward: false,
    };
  }

  // Explicit non-rent keywords (after payment check).
  // Use intelligent matching for variations
  for (const { keyword, category } of NON_RENT_KEYWORDS) {
    if (intelligentKeywordMatch(d, keyword)) {
      return {
        isPayment: false,
        isRentalCharge: false,
        isNonRentalCharge: true,
        isBalanceForward: false,
        category,
      };
    }
  }

  // Check rent keywords with intelligent matching
  const hasRent = RENT_KEYWORDS.some((k) => intelligentKeywordMatch(d, k));
  if (hasRent) {
    const overridden = RENT_OVERRIDE_NON_RENT.some((k) => intelligentKeywordMatch(d, k));
    if (overridden) {
      return {
        isPayment: false,
        isRentalCharge: false,
        isNonRentalCharge: true,
        isBalanceForward: false,
        category: 'other',
      };
    }
    return {
      isPayment: false,
      isRentalCharge: true,
      isNonRentalCharge: false,
      isBalanceForward: false,
      category: 'rent',
    };
  }

  // DEFAULT BEHAVIOR: If we can't classify a charge as rental or payment,
  // treat it as NON-RENTAL. This ensures charges like "True up", "adjustment",
  // "renewal presented" etc. are counted as non-rental by default.
  // Better to include uncertain charges in non-rental than to miss them.
  return { 
    isPayment: false, 
    isRentalCharge: false, 
    isNonRentalCharge: true,  // DEFAULT TO NON-RENTAL for unknown charges
    isBalanceForward: false,
    category: 'other',
  };
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
  
  // CRITICAL: Filter out suspiciously small amounts that are likely control numbers or line numbers
  // Real rental amounts are typically > $100 (ignore amounts < 50 that might be control/line numbers)
  // BUT: Allow small amounts if they have .00 (like 10.00 for AC charges)
  // The key is: if it's a very small number (< 50) and doesn't look like a standard charge amount, skip it
  // However, we need to be careful not to filter out legitimate small charges like $10.00 for AC
  // So only filter if it's a whole number or very small
  if (num < 50 && !cleaned.includes('.')) {
    // Small whole numbers without decimals are likely line numbers or control numbers
    return null;
  }

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

// Money tokens in ledgers almost always have cents. We intentionally require a
// decimal part to avoid accidentally treating years (e.g. "2025"), charge codes,
// and control numbers as monetary values.
const MONEY_TOKEN_REGEX =
  /(\(?-?\$?(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}\)?)/g;

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

    // CRITICAL FIX: Remove charge code from line BEFORE extracting amounts
    // Charge codes are 1-2 digit numbers right after the date
    // Example: "07/01/2015 1 BASE RENT : 1525.00 1525.00"
    // We need to remove "1" before extracting amounts, otherwise it will be parsed as an amount
    const dateEnd = line.indexOf(dateToken) + dateToken.length;
    const afterDatePart = line.substring(dateEnd);
    
    // Match charge code pattern: whitespace followed by 1-2 digits followed by whitespace and description
    // Pattern: " 1 BASE RENT" or " 25 AIR CONDITIONER"
    const chargeCodeMatchPattern = afterDatePart.match(/^\s+(\d{1,2})\s+(.+)/);
    let lineWithoutChargeCode = line;
    let extractedChargeCode: string | undefined;
    
    if (chargeCodeMatchPattern) {
      extractedChargeCode = chargeCodeMatchPattern[1];
      // Remove charge code from the line - replace it with whitespace
      const chargeCodePattern = afterDatePart.substring(0, afterDatePart.indexOf(chargeCodeMatchPattern[2]));
      lineWithoutChargeCode = line.substring(0, dateEnd) + ' ' + chargeCodeMatchPattern[2] + line.substring(dateEnd + chargeCodePattern.length + chargeCodeMatchPattern[2].length);
    }

    // Now extract money tokens from the cleaned line (without charge code)
    const moneyTokens = [...lineWithoutChargeCode.matchAll(MONEY_TOKEN_REGEX)].map((m) => m[1]);
    
    const amounts = moneyTokens
      .map(parseMoney)
      .filter((n): n is number => typeof n === 'number' && !Number.isNaN(n));

    // Need at least one amount and a date to be a ledger row
    if (amounts.length < 1) continue;

    // Heuristic: balance is usually the last monetary value (after removing control numbers).
    // But if we have 3+ amounts, it's likely: Charges, Payments, Balance (last one)
    // If we have 2 amounts, it could be: Amount, Balance (last one) or Charges, Balance
    // If we have 1 amount, it's likely just the balance
    let balance = amounts.length >= 2 ? amounts[amounts.length - 1] : amounts[0];
    
    // Note: money tokens are already constrained to values with cents (via MONEY_TOKEN_REGEX),
    // so a balance like "1550.00" will parse to the number 1550 (String() drops trailing zeros).
    // We should NOT treat that as a control number.

    // Determine debit/credit from remaining amounts.
    const nonBalance = amounts.length >= 2 ? amounts.slice(0, -1) : [];

    // Extract description - use the line without charge code
    let description = stripTrailingMoneyTokens(lineWithoutChargeCode)
      .replace(dateToken, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Clean up description - remove trailing colon if present
    description = description.replace(/:\s*$/, '').trim();
    
    // Final cleanup - remove any remaining special characters like // from start/end
    description = description.replace(/^[\/\s]+/, '').replace(/[\/\s]+$/, '').trim();
    
    // Charge code was already extracted above
    const chargeCode = extractedChargeCode;

    const cls = classifyDescription(description);
    
    // Determine if rental based on charge code
    // Code '1' = BASE RENT (rental)
    // Code '25' = AIR CONDITIONER (non-rental)
    // Code '59' = LATE CHARGE (non-rental)
    // Code '51' = LEGAL FEES (non-rental)
    // Code '52' = SECURITY DEPOSIT (non-rental)
    // Code '55' = BAD CHECK CHARGE (non-rental)
    let isRentalByCode: boolean | undefined;
    if (chargeCode) {
      if (chargeCode === '1') {
        isRentalByCode = true; // BASE RENT
      } else if (['25', '59', '51', '52', '55'].includes(chargeCode)) {
        isRentalByCode = false; // Non-rental charges
      }
    }

    let debit = 0;
    let credit = 0;

    // For PDF format: DATE CODE DESCRIPTION BILLED BALANCE
    // Format: "07/01/2015   1 BASE RENT :                            1525.00               1525.00"
    // This has 2 amounts: BILLED (first) and BALANCE (last)
    // So nonBalance contains just [BILLED] = [1525.00]
    
    // For format with 3 amounts: DATE CODE DESCRIPTION BILLED PAID BALANCE
    // nonBalance would be [BILLED, PAID]

    if (nonBalance.length >= 2) {
      // Format: BILLED, PAID, BALANCE (3 amounts total) OR debit, credit, balance
      // Check if this is a payment entry
      if (cls.isPayment) {
        // Payment entry: BILLED might be 0, PAID is the payment amount
        // Set credit = PAID (second amount)
        credit = Math.max(0, nonBalance[1]);
        // If first amount is positive, it might be a partial payment or refund reversal
        if (nonBalance[0] > 0 && nonBalance[0] !== nonBalance[1]) {
          // Could be a reversal or adjustment, but for now treat as credit
        }
      } else {
        // Charge entry: first amount is BILLED (debit), second might be PAID (credit)
      debit = Math.max(0, nonBalance[0]);
        // If second amount is different and positive, it might be a payment amount
        // But for charge entries, we typically only want the debit
        // Only set credit if it's clearly a payment and different from debit
        if (nonBalance[1] > 0 && nonBalance[1] < nonBalance[0]) {
          // This looks like a payment amount (less than the charge)
          // But don't set credit here - payments are usually separate entries
        }
      }
    } else if (nonBalance.length === 1) {
      // Format: BILLED, BALANCE (2 amounts total) OR single amount
      // nonBalance contains just [BILLED]
      const amt = nonBalance[0];
      if (cls.isPayment || amt < 0) {
        credit = Math.abs(amt);
      } else {
        debit = Math.abs(amt);
      }
    } else {
      // Only one monetary token (the balance); can't safely split into debit/credit/balance.
      // Treat it as balance-only row and skip charge extraction.
      debit = 0;
      credit = 0;
    }

    // Balance-forward/opening-balance rows should be balance-only (no debit/credit).
    // Many statements print these with a "billed" amount equal to the existing balance due.
    if (cls.isBalanceForward) {
      debit = 0;
      credit = 0;
    }

    // Determine isRental: prioritize charge code, then classification
    // CRITICAL: If description contains "BASE RENT" or "RENT" (not payment), it's rental
    let isRental: boolean | undefined;
    if (isRentalByCode !== undefined) {
      isRental = isRentalByCode;
    } else if (cls.isRentalCharge) {
      isRental = true;
    } else if (cls.isNonRentalCharge) {
      isRental = false;
    } else {
      // Fallback: Check if description explicitly contains "BASE RENT" or just "RENT" (case-insensitive)
      // and it's not a payment (payment would already be filtered by cls.isPayment)
      const descUpper = description.toUpperCase();
      if ((descUpper.includes('BASE RENT') || descUpper.includes(' RENT') || descUpper === 'RENT') && !cls.isPayment) {
        isRental = true;
      }
    }

    entries.push({
      _idx: idx,
      date,
      description: description || 'Unknown',
      debit: debit > 0 ? debit : 0,
      credit: credit > 0 ? credit : 0,
      balance,
      isRental,
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
    if (cls.isBalanceForward) continue;
    if (cls.isPayment) continue;

    // Check if this is a rental charge
    // IMPORTANT: Prioritize isRental flag from ledger entry (set by charge code detection)
    // Then fall back to classification if isRental is undefined
    // CRITICAL: Also check description directly for "BASE RENT" or "RENT" as final fallback
    const descUpper = e.description.toUpperCase();
    const isBaseRent = descUpper.includes('BASE RENT') || (descUpper.includes(' RENT') && !descUpper.includes('NON-RENTAL'));
    
    const isRental = e.isRental === true || 
                     (e.isRental !== false && cls.isRentalCharge) ||
                     (e.isRental !== false && isBaseRent && !cls.isPayment);
    
    if (isRental) {
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


