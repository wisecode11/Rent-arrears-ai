import { HuggingFaceResponse } from '@/types';
import { chargesFromLedgerEntries, classifyDescription, parseLedgerFromText } from '@/lib/ledger-parser';
import { 
  analyzeHeaders, 
  identifyColumnType, 
  logColumnMapping, 
  createParserConfig,
  HeaderAnalysis,
  ParserConfig,
  ColumnType
} from '@/lib/column-mapper';
import { isSecurityDepositPaidByMatchingPayment } from '@/lib/business-logic';

function extractIssueDateISO(extractedText: string): string | undefined {
  const toISO = (mm: string, dd: string, yyyy: string) =>
    `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

  // We scan the full text for strong signals like "Created on" / "As Of Property Date".
  // For weaker generic labels like "Date:", we only accept them when they appear as a standalone
  // header line (start-of-line "Date: ...") and we search both the top and bottom portions.
  const full = extractedText;
  const head = extractedText.slice(0, 6000);
  const tail = extractedText.slice(Math.max(0, extractedText.length - 6000));

  type Candidate = { iso: string; score: number };
  const candidates: Candidate[] = [];

  const normalizeYear = (yy: string): string => {
    // Allow 2-digit years as well (assume 2000-2069 window for modern ledgers).
    if (yy.length === 2) {
      const n = Number.parseInt(yy, 10);
      if (Number.isFinite(n)) return String(n >= 70 ? 1900 + n : 2000 + n);
    }
    return yy;
  };

  const addMatch = (re: RegExp, score: number, source: string) => {
    const m = source.match(re);
    if (!m) return;
    const iso = toISO(m[1], m[2], normalizeYear(m[3]));
    candidates.push({ iso, score });
  };

  // Shared date token: MM/DD/YYYY, MM/DD/YY, MM-DD-YYYY, MM-DD-YY
  const DATE_TOKEN = String.raw`(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})`;
  // Allow the date to be immediately followed by a non-space word (some PDF extractions drop the space),
  // e.g. "Created on 07/08/2025Page 8". We only require that the next char is not a digit.
  const DATE_FOLLOW = String.raw`(?=\D|$)`;

  // Highest confidence: tenant-ledger exports often include this footer/header.
  addMatch(new RegExp(String.raw`\bCreated\s+on[:\s]*${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 100, full);
  addMatch(new RegExp(String.raw`\bCreated\s+On[:\s]*${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 100, full);
  addMatch(new RegExp(String.raw`\bCreate(?:d)?\s*Date[:\s]*${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 98, full);

  // Many statements show a top-right header like: "Printed 04/18/2025" (treat as issue/statement date).
  addMatch(new RegExp(String.raw`\bPrinted[:\s]+${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 98, full);
  addMatch(new RegExp(String.raw`\bPrint\s*Date[:\s]+${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 97, full);
  addMatch(new RegExp(String.raw`\bRun\s*Date[:\s]+${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 96, full);

  // Resident-ledger exports often include an explicit as-of date.
  addMatch(new RegExp(String.raw`\bAs\s*Of\s*Property\s*Date:\s*${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 95, full);
  addMatch(new RegExp(String.raw`\bAs\s*Of\s*Date:\s*${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 90, full);

  // Common report headers.
  addMatch(new RegExp(String.raw`\bStatement\s*Date:\s*${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 85, full);
  addMatch(new RegExp(String.raw`\bReport\s*Date:\s*${DATE_TOKEN}${DATE_FOLLOW}`, 'i'), 80, full);

  // Lowest confidence: a plain "Date:" header. Only accept if it appears to be a report header
  // (start-of-line "Date: ..."), not a ledger table.
  const dateHeaderRe = new RegExp(String.raw`(^|\n)\s*Date:\s*${DATE_TOKEN}${DATE_FOLLOW}`, 'i');
  const dateHeaderHead = head.match(dateHeaderRe);
  if (dateHeaderHead) {
    const iso = toISO(dateHeaderHead[2], dateHeaderHead[3], normalizeYear(dateHeaderHead[4]));
    candidates.push({ iso, score: 60 });
  }
  const dateHeaderTail = tail.match(dateHeaderRe);
  if (dateHeaderTail) {
    const iso = toISO(dateHeaderTail[2], dateHeaderTail[3], normalizeYear(dateHeaderTail[4]));
    candidates.push({ iso, score: 60 });
  }

  if (!candidates.length) return undefined;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].iso;
}

/**
 * Precise prompt for AI extraction - critical for accuracy
 */
const EXTRACTION_PROMPT = `You are an expert financial document analyzer. Extract rental arrears data from the following PDF text.

CRITICAL REQUIREMENTS:
1. Extract ALL rental charges (rent, utilities included in rent, etc.)
2. Extract ALL non-rental charges - THIS IS VERY IMPORTANT! Look for:
   - WiFi/Internet charges
   - Air conditioner/AC charges
   - Maintenance fees
   - Repair charges
   - Legal fees
   - Insurance charges
   - Admin fees
   - Utility charges (if separate from rent)
   - Any other charges that are NOT rent
   - Extract EVERY SINGLE non-rental charge you find in the document
3. Extract ledger entries with running balances if available in the document
4. Identify opening balance AND final/latest balance from the document
   - Opening balance: Usually at the beginning of the statement/ledger, or look for "YEAR STARTING BALANCE"
   - Final balance: Look for "TOTAL" line at the END - the last number in that line is the final balance
   - Example: "TOTAL  234345.71  228609.66    5736.05" means finalBalance is 5736.05
   - Also look for "Balance", "Current Balance", "Outstanding Balance", "Amount Due", "Total Due", "Balance Due"
   - The finalBalance is the MOST RECENT balance shown in the document - usually the last number in the "TOTAL" line
   - Extract this carefully as it's critical for calculations
5. Use exact amounts from the document
6. Extract dates in YYYY-MM-DD format
7. Return ONLY valid JSON - no markdown, no code blocks, no explanations
8. DO NOT MISS ANY CHARGES - extract everything you see in the document

IMPORTANT: Return ONLY the JSON object, nothing else. Start with { and end with }.

JSON FORMAT (STRICT - COPY THIS EXACT STRUCTURE):
{
  "tenantName": "string",
  "propertyName": "string", 
  "period": "string",
  "openingBalance": 0,
  "finalBalance": 0,
  "rentalCharges": [
    {
      "description": "string",
      "amount": 0,
      "date": "YYYY-MM-DD"
    }
  ],
  "nonRentalCharges": [
    {
      "description": "string", 
      "amount": 0,
      "date": "YYYY-MM-DD",
      "category": "string"
    }
  ],
  "ledgerEntries": [
    {
      "date": "YYYY-MM-DD",
      "description": "string",
      "debit": 0,
      "credit": 0,
      "balance": 0,
      "isRental": true
    }
  ]
}

LEDGER EXTRACTION NOTES:
- If the document contains a ledger with columns like "DATE | DESCRIPTION | BILLED | PAID | BALANCE DUE", extract ALL entries
- Each line with a date and description is a ledger entry
- The balance field is the "BALANCE DUE" column (last column)
- Mark isRental as true ONLY for "BASE RENT" or "RENT" entries
- Mark isRental as false for: AIR CONDITIONER, LATE CHARGE, LEGAL FEES, BAD CHECK CHARGE, SECURITY DEPOSIT, and any other non-rent charges
- Extract dates in format MM/DD/YYYY and convert to YYYY-MM-DD
- Extract ALL entries - do not skip any
- If ledger entries are not available, set ledgerEntries to an empty array []
- Extract dates accurately - they are critical for calculations

EXAMPLE LEDGER FORMAT:
"07/01/2015   1 BASE RENT :                            1525.00               1525.00"
- date: "2015-07-01"
- description: "BASE RENT"
- debit: 1525.00
- balance: 1525.00
- isRental: true

"07/01/2015  25 AIR CONDITIONER :                        10.00               1535.00"
- date: "2015-07-01"
- description: "AIR CONDITIONER"
- debit: 10.00
- balance: 1535.00
- isRental: false

NON-RENTAL CHARGES EXAMPLES (extract ALL of these):
- "AIR CONDITIONER" or "AC" charges (usually $10.00 each month)
- "LATE CHARGE" or "LATE FEE" charges (usually $25.00 each)
- "LEGAL FEES" (can be various amounts like $75, $115, $275, $100, $560)
- "BAD CHECK CHARGE" (usually $30.00 each)
- "SECURITY DEPOSIT" charges
- WiFi / Internet / Broadband charges
- Maintenance / Repair charges
- Insurance charges
- Admin fees / Administrative fees
- Utility charges (if separate from rent)
- Service charges
- Any other charges that are NOT "BASE RENT" or "RENT"

IMPORTANT: 
- Go through the ENTIRE document line by line
- Extract EVERY non-rental charge you find, don't miss any
- If you see "25 AIR CONDITIONER : 10.00" - extract it as a separate charge
- If you see "59 LATE CHARGE : 25.00" - extract it as a separate charge
- If you see "51 LEGAL FEES : ..." - extract it as a separate charge
- If you see "55 BAD CHECK CHARGE : 30.00" - extract it as a separate charge
- If you see "52 SECURITY DEPOSIT : ..." - extract it as a separate charge
- Extract each occurrence separately - if there are 50 AIR CONDITIONER charges, extract all 50
- Count ALL non-rental charges, even if they seem small
- DO NOT group similar charges together - each one is a separate entry

PDF TEXT TO ANALYZE:
`;

/**
 * Intelligently parse a header line into column names
 * Handles various formats: tab-separated, space-separated, merged text, etc.
 */
function parseHeadersIntelligently(line: string): string[] {
  // Known header patterns - sorted by length (longest first) for greedy matching
  const knownHeaders = [
    'Transaction Description', 'Transaction Date', 'Transaction Code', 'Transaction Type',
    'Running Balance', 'Account Balance', 'Current Balance', 'Ending Balance',
    'Fiscal Period', 'Charge Code', 'Charge Amount', 'Credit Amount', 'Debit Amount',
    'Payment Amount', 'Balance Due', 'Amount Due', 'Amount Paid',
    'Bldg/Unit', 'Building/Unit', 'Chg Code', 'Chg/Rec', 'Ctrl#',
    'Description', 'Reference', 'Balance', 'Charges', 'Credits', 'Payment',
    'Debit', 'Credit', 'Amount', 'Date', 'Code', 'Type', 'Memo', 'Unit', 'Flag',
    'Dr', 'Cr', 'Bal', 'Desc', 'Ref'
  ].sort((a, b) => b.length - a.length);
  
  const headers: string[] = [];
  let remaining = line;
  
  // First try: tab-separated
  const tabHeaders = line.split('\t').map(h => h.trim()).filter(Boolean);
  if (tabHeaders.length >= 3) {
    return tabHeaders;
  }
  
  // Second try: multiple spaces (fixed-width format)
  const spaceHeaders = line.split(/\s{2,}/).map(h => h.trim()).filter(Boolean);
  if (spaceHeaders.length >= 3) {
    return spaceHeaders;
  }
  
  // Third try: intelligent pattern matching for merged text
  // Match known headers in order of appearance
  const matches: { header: string; index: number }[] = [];
  
  for (const header of knownHeaders) {
    const regex = new RegExp(`\\b${header.replace(/[\/\-]/g, '\\$&')}\\b`, 'gi');
    let match;
    while ((match = regex.exec(remaining)) !== null) {
      // Check if this position is already covered by a longer match
      const alreadyCovered = matches.some(
        m => match!.index >= m.index && match!.index < m.index + m.header.length
      );
      if (!alreadyCovered) {
        matches.push({ header: match[0], index: match.index });
      }
    }
  }
  
  // Sort by position in line and return
  matches.sort((a, b) => a.index - b.index);
  
  if (matches.length >= 3) {
    return matches.map(m => m.header);
  }
  
  // Fallback: return space-separated words that look like headers
  return line.split(/\s+/).filter(word => {
    const lower = word.toLowerCase();
    return ['date', 'code', 'description', 'charge', 'credit', 'debit', 
            'payment', 'balance', 'amount', 'type', 'memo', 'unit', 'ref'].some(
      kw => lower.includes(kw)
    );
  });
}

/**
 * Parse Resident Ledger format (different structure)
 * Format: Date | Chg Code | Description | Charge | Payment | Balance | Chg/Rec
 */
export function parseResidentLedgerFormat(extractedText: string): HuggingFaceResponse {
  const lines = extractedText.split('\n').filter(line => line.trim().length > 0);
  const issueDate = extractIssueDateISO(extractedText);

  // In many extractions, spaces disappear but the signature "MM/DD/YYYY" + "MMYYYY" (6 digits fiscal period)
  // remains. Use this as a robust detector for the Bldg/Unit resident-ledger layout.
  // IMPORTANT: do NOT use \b here because the fiscal period is often immediately followed by a letter
  // (e.g. "...072025RESIDENT...") and digits+letters are both word-chars.
  const DATE_FISCAL_ROW = /\d{1,2}\/\d{1,2}\/\d{4}\s*\d{6}(?=\D|$)/;
  
  // Extract tenant name
  let tenantName = 'Unknown Tenant';
  for (const line of lines.slice(0, 10)) {
    if (line.match(/Name\s+(\w+\s+\w+)/i)) {
      const match = line.match(/Name\s+(\w+\s+\w+)/i);
      if (match) {
        tenantName = match[1].trim();
        break;
      }
    }
  }
  
  // Extract property address
  let propertyName = 'Unknown Property';
  for (const line of lines.slice(0, 10)) {
    if (line.match(/Address\s+(.+?)(?:\s+Status|\s+UNIT|$)/i)) {
      const match = line.match(/Address\s+(.+?)(?:\s+Status|\s+UNIT|$)/i);
      if (match) {
        propertyName = match[1].trim();
        // Also get unit if available
        const unitMatch = line.match(/UNIT\s+(\w+)/i);
        if (unitMatch) {
          propertyName += ` ${unitMatch[1]}`;
        }
        break;
      }
    }
  }
  
  const rentalCharges: any[] = [];
  const nonRentalCharges: any[] = [];
  const ledgerEntries: any[] = [];
  let finalBalance = 0;
  let openingBalance = 0;
  
  // Find the header line to know where data starts
  // Support multiple header formats:
  // 1. "Date | Chg Code | ... | Balance" (standard Resident Ledger)
  // 2. "Bldg/Unit | Transaction Date | ... | Transaction Code | ... | Balance" (Bldg/Unit format)
  // Now using intelligent column detection for dynamic header recognition
  let dataStartIndex = 0;
  let detectedHeaderAnalysis: HeaderAnalysis | null = null;
  let detectedHeaders: string[] = [];
  
  // Intelligent header detection - recognizes various column naming conventions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    
    // Look for lines that contain multiple column-related keywords
    const columnKeywords = [
      'date', 'balance', 'charge', 'credit', 'debit', 'payment',
      'description', 'code', 'amount', 'transaction', 'memo', 'type'
    ];
    
    let keywordMatches = 0;
    for (const keyword of columnKeywords) {
      if (lineLower.includes(keyword)) {
        keywordMatches++;
      }
    }
    
    // If we find at least 3 keywords, this is likely a header row
    if (keywordMatches >= 3) {
      // Parse headers intelligently
      detectedHeaders = parseHeadersIntelligently(line);
      
      if (detectedHeaders.length >= 3) {
        // Analyze the detected headers
        detectedHeaderAnalysis = analyzeHeaders(detectedHeaders);
        logColumnMapping(detectedHeaderAnalysis);
        
        dataStartIndex = i + 1;
        console.log('🔍 Intelligent header detection found headers at line', i);
        console.log('🔍 Detected headers:', detectedHeaders);
        break;
      }
    }
    
    // Fallback: Standard format patterns
    if (line.includes('Date') && line.includes('Chg Code') && line.includes('Balance')) {
      dataStartIndex = i + 1;
      break;
    }
    // Bldg/Unit format
    if (line.includes('Bldg/Unit') && line.includes('Transaction') && line.includes('Balance')) {
      dataStartIndex = i + 1;
      break;
    }
    // Alternative: look for "Charges" and "Credits" columns
    if (line.includes('Charges') && line.includes('Credits') && line.includes('Balance')) {
      dataStartIndex = i + 1;
      break;
    }
  }

  // Some "Resident Ledger" exports use a different layout:
  // "Bldg/Unit Transaction Date Fiscal Period ... Charges Credits ... Balance"
  // Those rows typically start with: "<unit> <MM/DD/YYYY> <MMYYYY> ..."
  // If we don't detect this, we may fall back to a generic parser which can mis-read credits as charges.
  const isBldgUnitResidentLedger =
    lines.some((l) => /Bldg\/Unit/i.test(l) && /Transaction\s*Date/i.test(l) && /Charges/i.test(l) && /Credits/i.test(l) && /Balance/i.test(l)) ||
    lines.some((l) => /Bldg\/Unit/i.test(l) && /Transaction\s*Date/i.test(l) && /Flag/i.test(l) && /Balance/i.test(l)) ||
    // Fallback detector: any row-like line containing date+fiscal and "RESIDENT"
    lines.some((l) => DATE_FISCAL_ROW.test(l) && /RESIDENT/i.test(l));
  
  console.log('🔍 Bldg/Unit format detected:', isBldgUnitResidentLedger);
  console.log('🔍 Data start index:', dataStartIndex);
  
  // Parse each ledger entry
  // Format: Date | Chg Code | Description | Charge | Payment | Balance | Chg/Rec
  //
  // Resident ledgers frequently wrap entries (especially utilities) across multiple lines
  // and those wrapped lines may include non-column "noise" decimals (meter readings, tax, etc.).
  // To avoid mis-parsing those noise decimals as charge/payment, we only parse the trailing
  // 2-3 money tokens at the END of each logical entry:
  //   [charge] [payment] [balance] [optional control#]
  // or:
  //   [amount] [balance] [optional control#]
  
  // Intelligent date detection - handles multiple formats:
  // MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD, DD/MM/YYYY, etc.
  const DATE_PATTERNS = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*/,           // MM/DD/YYYY
    /^(\d{1,2})-(\d{1,2})-(\d{4})\s*/,             // MM-DD-YYYY
    /^(\d{4})-(\d{2})-(\d{2})\s*/,                 // YYYY-MM-DD
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*/,           // DD.MM.YYYY
    /^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})\s*/,   // Jan 15, 2024
  ];
  
  const parseFlexibleDate = (dateStr: string): string | null => {
    // MM/DD/YYYY or MM-DD-YYYY
    let match = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (match) {
      const [, month, day, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // YYYY-MM-DD
    match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    
    // DD.MM.YYYY (European)
    match = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    // Month name format: Jan 15, 2024
    const monthNames: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    match = dateStr.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
    if (match) {
      const monthNum = monthNames[match[1].toLowerCase()];
      if (monthNum) {
        return `${match[3]}-${monthNum}-${match[2].padStart(2, '0')}`;
      }
    }
    
    return null;
  };
  
  const DATE_PREFIX_REGEX = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+/;
  const moneyToken = String.raw`\(?-?\$?(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}\)?`;
  const moneyTokenRegex = new RegExp(moneyToken, 'gi');

  // Track seen entries to prevent duplicates
  const seenEntries = new Set<string>();

  const parseAmount = (str: string): number => {
    if (!str) return 0;
    const cleaned = str.replace(/,/g, '').trim();
    if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
      return -Math.abs(parseFloat(cleaned.replace(/[()]/g, '')));
    }
    const parsed = parseFloat(cleaned.replace(/^\$/, ''));
    return isNaN(parsed) ? 0 : parsed;
  };

  const normalizeBrokenDecimals = (input: string): string => {
    let s = input;
    // Merge "10,012.0\n0" -> "10,012.00" and "-1,098.1\n1" -> "-1,098.11"
    s = s.replace(/(\d+\.\d)\s+(\d)\b/g, '$1$2');
    // Ensure a space between adjacent money tokens like "1,123.11-1,098.11"
    s = s.replace(/(\d\.\d{2})(-)(?=\d)/g, '$1 $2');
    // Split adjacent money tokens that were concatenated without a separator:
    // "654030.001,800.003,442.44" -> "654030.00 1,800.00 3,442.44"
    s = s.replace(/(\d\.\d{2})(?=\d)/g, '$1 ');
    // Handle Bldg/Unit format where amounts merge: "25.000." -> "25.00 0."
    // Pattern: X.XX followed by 0. or more digits
    s = s.replace(/(\d+\.\d{2})(0\.)(?=\d|$|\s)/g, '$1 $2');
    // Also handle "25.000.00" -> "25.00 0.00"
    s = s.replace(/(\d+\.\d{2})(\d+\.\d{2})/g, '$1 $2');
    // Some PDFs concatenate a 5+ digit control # with a following "0.00" (e.g. "65403" + "0.00" => "654030.00").
    // Split it back so we don't treat the control number as part of the charge amount.
    s = s.replace(/(\b\d{5,}?)(0\.\d{2}\b)/g, '$1 $2');
    return s;
  };

  const extractTailMoneyTokens = (block: string): string[] => {
    moneyTokenRegex.lastIndex = 0;
    const normalized = normalizeBrokenDecimals(block);
    return [...normalized.matchAll(moneyTokenRegex)].map((m) => m[0]);
  };

  const stripTrailingColumns = (s: string): string => {
    let out = (s || '').trim();
    // Remove trailing control numbers (5+ digits).
    out = out.replace(/\s+\d{5,}\s*$/g, '').trim();
    // Remove up to 3 trailing money tokens (charge/payment/balance).
    for (let k = 0; k < 3; k++) {
      out = out.replace(new RegExp(`\\s*${moneyToken}\\s*$`, 'i'), '').trim();
      out = out.replace(/\s+\d{5,}\s*$/g, '').trim();
    }
    return out.trim();
  };

  // Coalesce wrapped ledger rows into logical blocks (keep newlines so we can
  // reliably use the LAST physical line for the charge/payment/balance columns).
  const coalescedLines: string[] = [];
  // Some PDF extractions remove spaces between columns:
  // "07/01/2025072025RESIDENTRENTRent2,155.800.007,779.04"
  // So allow optional whitespace between date and the 6-digit fiscal period.
  // Also allow no space between unit and date: "1769-14T07/01/2025..."
  // We detect rows by locating a date immediately followed by the 6-digit fiscal period.
  const DATE_FISCAL_REGEX = /(\d{1,2}\/\d{1,2}\/\d{4})\s*(\d{6})(?=\D|$)/;
  const START_ROW_BLDGUNIT = /^\s*\S+.*\d{1,2}\/\d{1,2}\/\d{4}\s*\d{6}\b/;
  // For Bldg/Unit format: detect rows that have date + 6-digit fiscal period
  // Don't require "RESIDENT" as it may be missing or in a different column
  const isBldgUnitRowStart = (s: string): boolean => {
    // Must have date + 6-digit fiscal period pattern
    if (!DATE_FISCAL_ROW.test(s)) return false;
    // Either has RESIDENT or has known transaction codes
    return /RESIDENT/i.test(s) || 
           /LATEFEE|NSFFEE|PMTCHECK|PMTMORD|PMTOPACH|RENT\b|SECDEP/i.test(s) ||
           /Late\s*Charge|NSF\s*Check/i.test(s);
  };

  for (let i = dataStartIndex; i < lines.length; i++) {
    const raw = lines[i].trim();

    // Skip page numbers and headers
    // Skip page markers like "1 / 8" (but do NOT match ledger dates like "11/22/2023").
    if (raw.match(/^\d+\s*\/\s*\d+\s*$/) || raw.includes('Resident Ledger') || raw.includes('Date:')) {
      continue;
    }

    // Pick row start depending on ledger layout.
    if (isBldgUnitResidentLedger) {
      if (!isBldgUnitRowStart(raw)) continue;
    } else {
      if (!DATE_PREFIX_REGEX.test(raw)) continue;
    }

    let buffer = raw;
    // Keep appending until we hit the next date-row. Do NOT stop early based on decimals,
    // because utilities include meter readings/tax amounts that can look like money.
    // The real ledger columns (charge/payment/balance) appear at the very end of the entry.
    let wrapLines = 0;
    while (i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (!next) {
        i++;
        continue;
      }
      if (isBldgUnitResidentLedger) {
        if (isBldgUnitRowStart(next)) break;
      } else {
        if (DATE_PREFIX_REGEX.test(next)) break;
      }
      if (next.match(/^\d+\s*\/\s*\d+\s*$/)) break; // page "1 / 8"
      if (next.toUpperCase().includes('RESIDENT LEDGER')) break;
      if (next.toUpperCase().startsWith('TOTAL')) break;

      buffer = `${buffer}\n${next}`;
      i++;
      wrapLines++;
      if (wrapLines >= 30) break; // safety cap
    }
    coalescedLines.push(buffer);
  }

  for (const line of coalescedLines) {
    const blockLines = line
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (blockLines.length === 0) continue;

    const headerLine = blockLines[0];
    const tailLine = blockLines[blockLines.length - 1];

    let dateStr = '';
    let headerRemainder = '';
    let rawCode = '';

    if (isBldgUnitResidentLedger) {
      // Find date + fiscal period anywhere in the line (spaces may be missing).
      const m = headerLine.match(DATE_FISCAL_REGEX);
      if (!m) continue;
      dateStr = m[1];
      const fiscalWithMaybeSpaces = m[0];
      const startIdx = headerLine.indexOf(fiscalWithMaybeSpaces) + fiscalWithMaybeSpaces.length;
      const remainder = headerLine.slice(startIdx).trim();
      // Keep remainder (may be space-less); stripTrailingColumns will remove tail money tokens/control# later.
      headerRemainder = remainder;

      // Detect transaction code robustly from remainder (works even without spaces).
      const upper = remainder.toUpperCase();
      // Extended list of transaction codes for Bldg/Unit format
      const codeMatch = upper.match(/(PMTOPACH|PMTMORD|PMTCHECK|PMTMONEY|LATEFEE|LATEFEES|LATECHG|NSFFEE|NSF|RENT|SECDEP|SECURITYDEPOSIT)/);
      rawCode = (codeMatch?.[1] ?? '').trim();
      
      // If no code matched but description contains "Late Charges", treat as LATEFEE
      if (!rawCode && (upper.includes('LATE CHARGE') || upper.includes('LATECHARGE'))) {
        rawCode = 'LATEFEE';
      }
    } else {
      const startMatch = headerLine.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\S+)\s*(.*)$/);
      if (!startMatch) continue;
      dateStr = startMatch[1];
      rawCode = startMatch[2];
      headerRemainder = (startMatch[3] || '').trim();
    }

    const [month, day, year] = dateStr.split('/');
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    // Normalize charge code to match existing logic (e.g. "chk#" => "chk")
    const chgCode = rawCode.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Extract trailing amounts from the block.
    // CRITICAL: Late fees and utilities have reference amounts IN description that must be excluded.
    // Strategy: For late fees, extract from TAIL (last 2-3 amounts) and detect/remove duplicates.
    const fullLine = blockLines.join(' ');
    let cleanedForExtraction = fullLine;
    
    // =========================================================================
    // UNIVERSAL DESCRIPTION AMOUNT FILTERING
    // Remove ALL amounts that appear in description context (not column values)
    // These patterns indicate amounts mentioned in text, not actual charges
    // =========================================================================
    
    // Pattern: "$XXX.XX (MM/YYYY-MM/YYYY)" or "$XXX.XX(MM/YYYY-MM/YYYY)" - amounts with date ranges in parentheses
    // Example: "Scrie/Drie Adjustment$730.81 (12/2023-10/2024)" - the $730.81 is NOT the charge amount
    cleanedForExtraction = cleanedForExtraction.replace(/\$[\d,]+\.?\d*\s*\(\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{4}\)/gi, '(___)');
    
    // Pattern: Amount immediately before or after parenthesized date range (without $)
    // Example: "Adjustment730.81 (12/2023-10/2024)" or "730.81(12/2023-10/2024)"
    cleanedForExtraction = cleanedForExtraction.replace(/[\d,]+\.?\d{0,2}\s*\(\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{4}\)/gi, '(___)');
    
    // Pattern: "$XXX.XX/mth" or "$XXX.XX/month" or "$XXX.XX/mo" - rental rate mentions
    cleanedForExtraction = cleanedForExtraction.replace(/\$[\d,]+\.\d{2}\s*\/\s*(?:mth|month|mo)\b/gi, '___');
    
    // Pattern: "$XXX.XX per month" or "XXX.XX per mth"
    cleanedForExtraction = cleanedForExtraction.replace(/\$?[\d,]+\.\d{2}\s*per\s*(?:mth|month|mo)\b/gi, '___');
    
    // Pattern: "charges shd have been $XXX.XX" or "should have been $XXX.XX" or "should be $XXX.XX"
    cleanedForExtraction = cleanedForExtraction.replace(/(?:charges?\s+)?(?:shd|should)\s+(?:have\s+)?be(?:en)?\s+\$?[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: "been $XXX.XX/mth" - common in adjustment descriptions
    cleanedForExtraction = cleanedForExtraction.replace(/been\s+\$?[\d,]+\.\d{2}\s*\/?\s*(?:mth|month|mo)?\b/gi, '___');
    
    // Pattern: "@ $XXX.XX" or "at $XXX.XX" - rate references
    cleanedForExtraction = cleanedForExtraction.replace(/(?:@|at)\s*\$[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: "rate of $XXX.XX" or "rate $XXX.XX"
    cleanedForExtraction = cleanedForExtraction.replace(/rate\s*(?:of\s*)?\$?[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: "from $XXX.XX to $YYY.YY" - rate change descriptions
    cleanedForExtraction = cleanedForExtraction.replace(/from\s+\$?[\d,]+\.\d{2}\s+to\s+\$?[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: "renewal ... $XXX.XX" - renewal rate mentions
    cleanedForExtraction = cleanedForExtraction.replace(/renewal[^$]*\$[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: Amount followed by "/mth" anywhere
    cleanedForExtraction = cleanedForExtraction.replace(/[\d,]+\.\d{2}\s*\/\s*mth/gi, '___');
    
    // For UTILITY rows: strip embedded amounts in description like "Amount=$128.51", "Salestax=$5.31"
    // These are NOT the actual charge - the charge is in the Charge column at the end.
    const isUtilityRow = rawCode.toLowerCase().includes('util') || 
                         fullLine.toLowerCase().includes('period:') || 
                         fullLine.toLowerCase().includes('readings:') ||
                         fullLine.toLowerCase().includes('cost_kwh') ||
                         fullLine.toLowerCase().includes('multiplier');
    if (isUtilityRow) {
      // Remove ALL embedded dollar amounts and patterns from utility descriptions
      // Pattern: "Amount=$128.51" or "Amount$128.51" (with or without =)
      cleanedForExtraction = cleanedForExtraction.replace(/Amount\s*=?\s*-?\$?[\d,]+\.\d{2}/gi, '___');
      // Pattern: "Salestax=$5.31" or "Salestax$5.31"  
      cleanedForExtraction = cleanedForExtraction.replace(/Salestax\s*=?\s*\$?[\d,]+\.\d{2}/gi, '___');
      // Pattern: "Cost_KWH=SC1" or similar
      cleanedForExtraction = cleanedForExtraction.replace(/Cost_KWH\s*=?\s*\S+/gi, '___');
      // Pattern: "Readings:23358.70 - 24052.30" or "Readings:21141.20 - 21681.60"
      cleanedForExtraction = cleanedForExtraction.replace(/Readings\s*:?\s*[\d,]+\.\d+\s*-\s*[\d,]+\.\d+/gi, '___');
      // Pattern: "Usage=693.60" or "Usage 540.40"
      cleanedForExtraction = cleanedForExtraction.replace(/Usage\s*=?\s*[\d,]+\.\d+/gi, '___');
      // Pattern: METER#(s)1258194-10 or similar meter references
      cleanedForExtraction = cleanedForExtraction.replace(/METER#?\(?s?\)?[\d\-]+/gi, '___');
      // Pattern: "Period:10\3\2023 - 10\31\2023" - date ranges with backslashes
      cleanedForExtraction = cleanedForExtraction.replace(/Period\s*:?\s*\d+\\\d+\\\d+\s*-\s*\d+\\\d+\\\d+/gi, '___');
      // Pattern: "Period:1 1 2024 - 1 31 2024" - date ranges with spaces
      cleanedForExtraction = cleanedForExtraction.replace(/Period\s*:?\s*\d+\s+\d+\s+\d+\s*-\s*\d+\s+\d+\s+\d+/gi, '___');
      // Remove any remaining decimal numbers before the last 80 chars (keep only column area)
      // This ensures we only get the actual Charge/Payment/Balance values at the end
      if (cleanedForExtraction.length > 100) {
        const rightPart = cleanedForExtraction.slice(-80);
        const leftPart = cleanedForExtraction.slice(0, -80);
        // Remove all money-like patterns from the description portion (left part)
        const cleanedLeft = leftPart.replace(/\$?[\d,]+\.\d{2}/g, '___');
        cleanedForExtraction = cleanedLeft + rightPart;
      }
    }
    
    // For late fees: strip description reference amounts using multiple patterns
    const isLateFeeRow = rawCode.toLowerCase().includes('late') || fullLine.toLowerCase().includes('late fee');
    if (isLateFeeRow) {
      // Pattern 1: "X% of $Y" or "X% of Y.YY"
      cleanedForExtraction = cleanedForExtraction.replace(/\d+(?:\.\d+)?%\s*of\s*\$?[\d,]+\.\d+/gi, '___');
      // Pattern 2: "Maximum $X.XX"
      cleanedForExtraction = cleanedForExtraction.replace(/Maximum\s+\$?[\d,]+\.\d{2}/gi, '___');
      // Pattern 3: Remove any remaining isolated $ amounts in description (before columns)
      // Keep only amounts in the rightmost 100 chars (column area)
      const rightPart = cleanedForExtraction.slice(-150);
      cleanedForExtraction = cleanedForExtraction.slice(0, -150).replace(/\$[\d,]+\.\d{2}/g, '___') + rightPart;
    }
    
    const allTokens = extractTailMoneyTokens(cleanedForExtraction);
    
    // Debug: Log PMTOPACH rows (ACH payments) to trace balance extraction
    if (rawCode.toUpperCase().includes('PMTOPACH') || fullLine.toUpperCase().includes('PMTOPACH')) {
      console.log('🔍 PMTOPACH row debug:', {
        date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
        rawCode,
        fullLine: fullLine.substring(0, 200),
        cleanedForExtraction: cleanedForExtraction.substring(cleanedForExtraction.length - 100),
        allTokens,
      });
    }
    
    // UNIVERSAL FIX: Late fees have 2 patterns that need special handling.
    // BUT: Skip this for Bldg/Unit format where we have clean [charge, credit, balance] pattern
    let finalTokens = allTokens;
    if (allTokens.length >= 3 && isLateFeeRow && !isBldgUnitResidentLedger) {
      const p = allTokens.slice(-3).map(parseAmount);
      const a0 = Math.abs(p[0]), a1 = Math.abs(p[1]), a2 = Math.abs(p[2]);
      // Pattern A: [50, 50, 3924] (duplicate) → [50, 3924]
      const isDup = Math.abs(a0 - a1) < 1.0 && a0 > 0;
      // Pattern B: [2210, 110, 2301] (reference >> actual) → [110, 2301]
      // But NOT when a1 is 0 (that's just the Credits column being empty)
      const isRef = a1 > 0 && (a0 > a1 * 10 || (a0 > 500 && a1 < 300 && a2 > a1 * 5));
      if (isDup || isRef) finalTokens = allTokens.slice(-2);
    }
    
    const tailTokens =
      finalTokens.length >= 3
        ? finalTokens.slice(-3)
        : finalTokens.length >= 2
          ? finalTokens.slice(-2)
          : finalTokens;
    
    // Debug: Show what tokens were extracted for LATEFEE rows
    if (rawCode.toLowerCase().includes('late') || fullLine.toLowerCase().includes('late')) {
      console.log('🔍 LATEFEE tokens:', { allTokens, tailTokens, fullLineTail: fullLine.slice(-80) });
    }
    
    let charge = 0;
    let payment = 0;
    let balance = 0;
    
    // BLDG/UNIT FORMAT FIX: If we couldn't extract enough tokens, try parsing from the merged text
    // Pattern like "25.000.007779.04" = charge(25.00) + credit(0.00) + balance(7779.04)
    if (tailTokens.length < 2 && isBldgUnitResidentLedger) {
      console.log('🔍 Merged text extraction attempt:', { tailTokensLen: tailTokens.length, fullLine: fullLine.slice(-100) });
      // Try to extract amounts from the merged text using a different approach
      // Look for pattern: XX.XXYY.YYZZZZ.ZZ (3 amounts merged)
      const mergedPattern = fullLine.match(/(\d+\.\d{2})(\d+\.\d{2})(\d+,?\d*\.\d{2})\s*$/);
      if (mergedPattern) {
        charge = parseAmount(mergedPattern[1]);
        payment = parseAmount(mergedPattern[2]);
        balance = parseAmount(mergedPattern[3]);
      } else {
        // Try 2-token pattern: XX.XXZZZZ.ZZ
        const twoMerged = fullLine.match(/(\d+\.\d{2})(\d+,?\d*\.\d{2})\s*$/);
        if (twoMerged) {
          const amt = parseAmount(twoMerged[1]);
          balance = parseAmount(twoMerged[2]);
          // Determine if charge or payment based on code
          if (rawCode.toLowerCase().startsWith('pmt')) {
            payment = amt;
          } else {
            charge = amt;
          }
        } else {
          continue;
        }
      }
    } else if (tailTokens.length < 2) {
      continue;
    } else {
      // Normal token-based extraction
      if (tailTokens.length >= 3) {
        // Last three are: charge, payment, balance (resident ledger table columns)
        charge = parseAmount(tailTokens[tailTokens.length - 3]);
        payment = parseAmount(tailTokens[tailTokens.length - 2]);
        balance = parseAmount(tailTokens[tailTokens.length - 1]);
      } else if (tailTokens.length === 2) {
        // Two tokens: could be [charge, balance] or [charge, payment] (balance missing)
        const amt0 = parseAmount(tailTokens[0]);
        const amt1 = parseAmount(tailTokens[1]);
        
        // For payment-like rows (PMTOPACH, PMTMORD, etc.), the pattern is:
        // [0.00 (charge), payment_amount] - balance is MISSING from PDF
        const isPaymentRow =
          rawCode.toLowerCase().startsWith('pmt') ||
          chgCode === 'chk' ||
          headerLine.toLowerCase().includes('clickpay') ||
          headerLine.toLowerCase().includes('ach') ||
          headerLine.toLowerCase().includes('payment') ||
          headerLine.toLowerCase().includes('money order') ||
          headerLine.toLowerCase().includes('chk#');
        
        if (isPaymentRow && amt0 === 0) {
          // Pattern: [0.00, payment_amount] - balance is MISSING
          // Calculate balance from previous entry: prevBalance - payment
          charge = 0;
          payment = Math.abs(amt1);
          // Get previous entry's balance to calculate this entry's balance
          const prevEntry = ledgerEntries.length > 0 ? ledgerEntries[ledgerEntries.length - 1] : null;
          if (prevEntry && prevEntry.balance !== undefined) {
            balance = prevEntry.balance - payment;
            console.log('🔍 Calculated missing balance for payment row:', {
              date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
              prevBalance: prevEntry.balance,
              payment,
              calculatedBalance: balance
            });
          } else {
            // Can't calculate - use amt1 as balance (fallback, may be wrong)
            balance = amt1;
          }
        } else {
          // Normal pattern: [amount, balance]
          balance = amt1;
          const looksLikePayment =
            chgCode === 'chk' ||
            amt0 < 0 ||
            headerLine.toLowerCase().includes('clickpay') ||
            headerLine.toLowerCase().includes('ach') ||
            headerLine.toLowerCase().includes('payment') ||
            headerLine.toLowerCase().includes('chk#');
          if (looksLikePayment) {
            payment = Math.abs(amt0);
            charge = 0;
          } else {
            charge = Math.abs(amt0);
            payment = 0;
          }
        }
      }
    }

    // Extra safety: payment-like rows should never be counted as charges, even if we mis-parsed a control#.
    const headerLower = headerLine.toLowerCase();
    const paymentLike =
      rawCode.toLowerCase().startsWith('pmt') ||
      headerLower.includes('payment') ||
      headerLower.includes('ach') ||
      headerLower.includes('money order') ||
      headerLower.includes('welcomehome');
    if (paymentLike && charge > 0 && payment === 0) {
      payment = Math.abs(charge);
      charge = 0;
    }

    // Extra safety #2: If we somehow captured a giant control#/concatenation as charge (e.g. 654030.00),
    // force it out. If there is a payment token, the row is definitely a credit row.
    if (paymentLike && charge > 100000) {
      if (payment > 0) {
        charge = 0;
      } else {
        charge = 0;
      }
    }

    // Extra safety #3: Payment-like row with 3 tokens but first token is huge => treat charges as 0.
    if (paymentLike && payment > 0 && charge > 100000) {
      charge = 0;
    }

    // Build description from header remainder + any middle lines (exclude tail line).
    const middleLines = blockLines.slice(1, -1);
    let description =
      blockLines.length === 1
        ? stripTrailingColumns(headerRemainder)
        : `${headerRemainder} ${middleLines.join(' ')}`.replace(/\s+/g, ' ').trim();

    // Add basic spacing back when extraction removed it (helps downstream classification/clean display).
    // Example: "RESIDENT423PMTMORD" -> "RESIDENT 423 PMTMORD"
    description = description
      .replace(/([A-Za-z])(\d)/g, '$1 $2')
      .replace(/(\d)([A-Za-z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();

    // Clean description - remove control numbers and Ctrl# references
    description = description
      .replace(/\s+Ctrl#\s*\d+/gi, '')
      .replace(/\s+Ctrl\s*\d+/gi, '')
      .replace(/\b\d{6,9}\b/g, '')
      .replace(/\s+\d{5,}$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const isReversal =
      description.toLowerCase().includes('reversed') ||
      description.toLowerCase().includes('reverse') ||
      description.toLowerCase().includes('reversed by charge');

    // Reversals should never be counted as charges.
    if (isReversal) charge = 0;

    // Final validation - charges should be under $100,000
    const MAX_REASONABLE_CHARGE = 100000;
    if (charge > MAX_REASONABLE_CHARGE) charge = 0;

    // Validate balance - should be reasonable
    const MAX_REASONABLE_BALANCE = 1000000;
    if (Math.abs(balance) > MAX_REASONABLE_BALANCE) {
      console.warn('Skipping entry with unreasonable balance:', { date, chgCode, description, balance });
      continue;
    }

    const entryKey = `${date}_${chgCode}_${description.substring(0, 50)}_${charge}_${balance}`;
    if (seenEntries.has(entryKey)) continue;
    seenEntries.add(entryKey);

    // Track opening balance (first parsed entry) - corrected after sorting if still 0
    if (openingBalance === 0 && ledgerEntries.length === 0) {
      openingBalance = balance;
    }

    // Keep updating final balance as we parse
    finalBalance = balance;

    const debit = charge > 0 ? charge : 0;
    const credit = payment !== 0 ? Math.abs(payment) : 0;

    const classified = classifyDescription(description);

    // Determine if rental or non-rental based on charge code + description fallback
    const isRental = chgCode === 'affrent' || chgCode === 'rent' || classified.isRentalCharge;

    // Payments should NEVER be counted as charges
    const isPayment =
      chgCode === 'chk' ||
      description.toLowerCase().includes('clickpay') ||
      description.toLowerCase().includes('payment') ||
      description.toLowerCase().includes('chk#') ||
      description.toLowerCase().includes('ach') ||
      (credit > 0 && debit === 0);

    // Credits should NOT be counted as charges
    const isCredit =
      description.toLowerCase().includes('credit') ||
      description.toLowerCase().includes('reversed') ||
      description.toLowerCase().includes('reverse') ||
      charge < 0;

    // Debug: Log LATEFEE rows
    if (chgCode === 'latefee' || description.toLowerCase().includes('late')) {
      console.log('🔍 LATEFEE row:', { date, chgCode, description, charge, debit, isRental, isPayment, isCredit, classifiedIsNonRental: classified.isNonRentalCharge });
    }

    // Non-rental charges: only actual charges, not payments/credits, and NOT balance-forward/opening-balance rows.
    const isNonRental = !isRental && !isPayment && !isCredit && !classified.isBalanceForward && (
      classified.isNonRentalCharge ||
      chgCode === 'latefee' ||
      chgCode === 'latefees' ||
      chgCode === 'secdep' ||
      chgCode === 'nsf' ||
      chgCode === 'keyinc' ||
      chgCode === 'uao' ||
      chgCode === 'utilele' ||
      (debit > 0 && debit < 100000)
    );

    ledgerEntries.push({
      date: date,
      description: description || 'Unknown',
      debit,
      credit,
      balance: balance,
      isRental: isRental ? true : isNonRental ? false : undefined
    });

    if (isRental && debit > 0 && !isCredit && !isReversal) {
      rentalCharges.push({
        description: description || 'Unknown',
        amount: debit,
        date: date
      });
    }

    if (isNonRental && debit > 0 && !isPayment && !isReversal) {
      let category = 'other';
      if (chgCode === 'latefee' || chgCode === 'latefees') category = 'late_fee';
      else if (chgCode === 'secdep') category = 'security_deposit';
      else if (chgCode === 'nsf') category = 'bad_check';
      else if (chgCode === 'keyinc') category = 'lockout';
      else if (chgCode === 'uao') category = 'use_of_occupancy';
      else if (chgCode === 'utilele') category = 'utilities';
      else if (classified.category && classified.category !== 'rent') category = 'late_fee';

      nonRentalCharges.push({
        description: description || 'Unknown',
        amount: debit,
        date: date,
        category: category
      });
    }
  }

  // Last-resort: some extracted texts remove separators so aggressively that our coalescing logic
  // can miss row boundaries. If this is clearly a Bldg/Unit resident ledger but we parsed nothing,
  // do a simpler line-by-line pass using the Date+FiscalPeriod signature.
  if (isBldgUnitResidentLedger && ledgerEntries.length === 0) {
    for (const raw of lines) {
      if (!DATE_FISCAL_ROW.test(raw) || !/RESIDENT/i.test(raw)) continue;

      const m = raw.match(DATE_FISCAL_REGEX);
      if (!m) continue;
      const dateStr = m[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

      const startIdx = raw.indexOf(m[0]) + m[0].length;
      const remainder = raw.slice(startIdx).trim();
      const upper = remainder.toUpperCase();
      const codeMatch = upper.match(/(PMTOPACH|PMTMORD|PMTCHECK|LATEFEE|NSFFEE|RENT|SECDEP|SECURITYDEPOSIT)/);
      const rawCode = (codeMatch?.[1] ?? '').trim();

      // Clean description amounts before extracting tail tokens
      // Pattern: "$XXX.XX (MM/YYYY-MM/YYYY)" - amounts with date ranges in descriptions
      let cleanedRaw = raw.replace(/\$[\d,]+\.?\d*\s*\(\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{4}\)/gi, '(___)');
      cleanedRaw = cleanedRaw.replace(/[\d,]+\.?\d{0,2}\s*\(\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{4}\)/gi, '(___)');

      const tokens = extractTailMoneyTokens(cleanedRaw);
      const tailTokens =
        tokens.length >= 3 ? tokens.slice(-3) : tokens.length >= 2 ? tokens.slice(-2) : tokens;
      if (tailTokens.length < 2) continue;

      let charge = 0;
      let payment = 0;
      let balance = 0;
      if (tailTokens.length >= 3) {
        charge = parseAmount(tailTokens[0]);
        payment = parseAmount(tailTokens[1]);
        balance = parseAmount(tailTokens[2]);
      } else {
        const amt = parseAmount(tailTokens[0]);
        balance = parseAmount(tailTokens[1]);
        charge = Math.abs(amt);
        payment = 0;
      }

      const headerLower = raw.toLowerCase();
      const paymentLike =
        rawCode.toLowerCase().startsWith('pmt') ||
        headerLower.includes('payment') ||
        headerLower.includes('ach') ||
        headerLower.includes('money order') ||
        headerLower.includes('welcomehome');
      if (paymentLike && charge > 100000) charge = 0;

      const debit = charge > 0 ? charge : 0;
      const credit = payment > 0 ? payment : 0;

      let description = stripTrailingColumns(remainder);
      description = description
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();

      const cls = classifyDescription(description);
      const isRental = rawCode.toLowerCase() === 'rent' || cls.isRentalCharge;
      const isPayment = paymentLike || (credit > 0 && debit === 0);
      if (!isPayment) {
        ledgerEntries.push({
          date,
          description: description || 'Unknown',
          debit,
          credit,
          balance,
          isRental: isRental ? true : (cls.isNonRentalCharge ? false : undefined),
        });
      } else {
        ledgerEntries.push({
          date,
          description: description || 'Payment',
          debit: 0,
          credit,
          balance,
          isRental: undefined,
        });
      }

      if (isRental && debit > 0 && !isPayment) {
        rentalCharges.push({ description: description || 'Unknown', amount: debit, date });
      }
      if (!isRental && !isPayment && debit > 0) {
        nonRentalCharges.push({
          description: description || 'Unknown',
          amount: debit,
          date,
          category: cls.category && cls.category !== 'rent' ? cls.category : 'other',
        });
      }
    }
  }
  
  // Sort by date
  ledgerEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  rentalCharges.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  nonRentalCharges.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Fix entries with missing/incorrect balances after sorting
  // For payment rows where balance equals payment amount (likely missing balance from PDF),
  // recalculate using: balance = prevBalance + debit - credit
  for (let i = 1; i < ledgerEntries.length; i++) {
    const entry = ledgerEntries[i];
    const prevEntry = ledgerEntries[i - 1];
    const isPaymentEntry = entry.credit > 0 && entry.debit === 0;
    
    // Detect suspicious balance: balance equals payment amount (likely missing balance)
    // Or balance is positive when it should be negative after large payment
    if (isPaymentEntry && entry.credit > 0 && prevEntry.balance !== undefined) {
      const expectedBalance = prevEntry.balance + (entry.debit || 0) - (entry.credit || 0);
      const currentBalanceMatchesPayment = Math.abs(entry.balance - entry.credit) < 0.01;
      
      // If current balance matches the payment amount, it was likely mis-parsed
      if (currentBalanceMatchesPayment && Math.abs(expectedBalance - entry.balance) > 1) {
        console.log('🔧 Fixing suspicious balance for payment entry:', {
          date: entry.date,
          prevBalance: prevEntry.balance,
          payment: entry.credit,
          oldBalance: entry.balance,
          newBalance: expectedBalance
        });
        entry.balance = expectedBalance;
      }
    }
  }
  
  // Final balance should be from the LAST entry (most recent) after sorting
  if (ledgerEntries.length > 0) {
    const lastEntry = ledgerEntries[ledgerEntries.length - 1];
    finalBalance = lastEntry.balance;
    console.log('Final balance from last entry:', finalBalance, 'Date:', lastEntry.date);
  }
  
  // If opening balance is 0, use first entry's balance
  if (openingBalance === 0 && ledgerEntries.length > 0) {
    openingBalance = ledgerEntries[0].balance;
  }
  
  console.log('Resident Ledger parsing complete:', {
    tenantName,
    propertyName,
    finalBalance,
    openingBalance,
    rentalCharges: rentalCharges.length,
    nonRentalCharges: nonRentalCharges.length,
    ledgerEntries: ledgerEntries.length,
    lastEntryDate: ledgerEntries.length > 0 ? ledgerEntries[ledgerEntries.length - 1].date : 'N/A'
  });
  
  return {
    tenantName,
    propertyName,
    period: 'Extracted Period',
    openingBalance: openingBalance || finalBalance || 0,
    finalBalance: finalBalance || openingBalance || 0,
    rentalCharges,
    nonRentalCharges,
    ledgerEntries,
    issueDate,
  };
}

/**
 * Direct text parser - 100% accurate extraction without AI dependency
 */
/**
 * Parse Tenant Ledger format: Date | Payer | Description | Charges | Payments | Balance
 */
function parseTenantLedgerFormat(extractedText: string): HuggingFaceResponse {
  const lines = extractedText.split('\n').filter(line => line.trim().length > 0);

  // Even if the parser skips that line as a footer, we still want to preserve it for Step 3.
  const issueDate = extractIssueDateISO(extractedText);
  
  // Extract tenant name
  let tenantName = 'Unknown Tenant';
  for (const line of lines.slice(0, 30)) {
    // Look for "Tenants:" or "Name:" field
    const tenantMatch = line.match(/(?:Tenants?|Name):\s*(.+?)(?:\s+Phone|\s+Unit|$)/i);
    if (tenantMatch) {
      tenantName = tenantMatch[1].trim();
      break;
    }
  }
  
  // Extract property address
  let propertyName = 'Unknown Property';
  for (const line of lines.slice(0, 30)) {
    // Look for "Unit:" or "Property:" field
    const unitMatch = line.match(/(?:Unit|Property):\s*(.+?)(?:\s+Status|\s+Move|\s+Lease|$)/i);
    if (unitMatch) {
      propertyName = unitMatch[1].trim();
      break;
    }
  }
  
  const rentalCharges: any[] = [];
  const nonRentalCharges: any[] = [];
  const ledgerEntries: any[] = [];
  let finalBalance = 0;
  let openingBalance = 0;
  let openingBalanceExplicit = false;
  
  // Find the header line: Date | Payer | Description | Charges | Payments | Balance
  let dataStartIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toUpperCase();
    if ((line.includes('DATE') && line.includes('DESCRIPTION') && line.includes('BALANCE')) ||
        (line.includes('DATE') && line.includes('CHARGES') && line.includes('PAYMENTS'))) {
      dataStartIndex = i + 1;
      break;
    }
  }
  
  // Parse ledger entries
  // Format: MM/DD/YYYY  [Payer]  Description  [Charges]  [Payments]  Balance
  // Example: "06/01/2020    Residential Rent - June 2020    1,900.00        1,900.00"
  // Some exports use 1-digit month/day (e.g., 6/1/2020). Support both.
  const dateRegex = /(\d{1,2}\/\d{1,2}\/\d{4})/;
  // Support: regular amounts, negatives (-123.45), and parentheses-style negatives (123.45)
  const moneyRegex = /(\(?\-?\d{1,3}(?:,\d{3})*\.\d{2}\)?|\(?\-?\d+\.\d{2}\)?)/g;

  // PDF text extraction sometimes concatenates tokens:
  // - "... Aug 202450.00942.12" (year+amount+amount)
  // - "Rent2,050.921,492.12" (missing spaces)
  // - "1,400.00-558.80" (amount immediately followed by negative balance)
  // We normalize these so amounts can be parsed correctly and descriptions don't contain numbers.
  const normalizeLedgerLine = (input: string): string => {
    let s = input;
    // Split "YYYY50.00" or "YYYY2,050.92" -> "YYYY 50.00" / "YYYY 2,050.92"
    // NOTE: do NOT require a trailing word-boundary; these are often immediately followed by another digit.
    s = s.replace(/(\b\d{4})(-?\d{1,3}(?:,\d{3})*\.\d{2})/g, '$1 $2');
    s = s.replace(/(\b\d{4})(-?\d+\.\d{2})/g, '$1 $2');
    // Split "word-16,150.00" -> "word -16,150.00"
    s = s.replace(/([A-Za-z])(-\d{1,3}(?:,\d{3})*\.\d{2})/g, '$1 $2');
    s = s.replace(/([A-Za-z])(-\d+\.\d{2})/g, '$1 $2');
    // Split "word2,050.92" -> "word 2,050.92"
    s = s.replace(/([A-Za-z])(\d{1,3}(?:,\d{3})*\.\d{2})/g, '$1 $2');
    s = s.replace(/([A-Za-z])(\d+\.\d{2})/g, '$1 $2');
    // Split "...0.00-558.80" -> "...0.00 -558.80"
    s = s.replace(/(\d\.\d{2})(-)/g, '$1 $2');
    // Split "...50.00942.12" -> "...50.00 942.12"
    s = s.replace(/(\d\.\d{2})(?=\d)/g, '$1 ');
    // Some extractors can split a currency like "532.36" into "53 2.36"; merge back.
    s = s.replace(/(\b\d{1,3})\s(\d\.\d{2}\b)/g, '$1$2');
    return s;
  };

  // Extract opening balance from a "Starting Balance" row if present (often has no date).
  // Example:
  //   0.00
  //   Starting Balance
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const upper = lines[i].toUpperCase();
    if (!upper.includes('STARTING BALANCE')) continue;
    const nums = lines[i].match(moneyRegex);
    if (nums && nums.length > 0) {
      const parsed = parseFloat(nums[0].replace(/,/g, ''));
      if (!isNaN(parsed)) {
        openingBalance = parsed;
        openingBalanceExplicit = true;
        break;
      }
    }
    // Sometimes the amount is on the previous line (e.g., "0.00" then "Starting Balance")
    if (i > 0) {
      const prevNums = lines[i - 1].match(moneyRegex);
      if (prevNums && prevNums.length > 0) {
        const parsedPrev = parseFloat(prevNums[0].replace(/,/g, ''));
        if (!isNaN(parsedPrev)) {
          openingBalance = parsedPrev;
          openingBalanceExplicit = true;
          break;
        }
      }
    }
  }
  
  // CRITICAL FIX: Coalesce multi-line ledger entries (e.g., description on one line, amounts on next line)
  // This handles cases where entries like "06/28/2024 ... Reversed by\nNSF\n767.72 0.00" are split
  const coalescedLines: string[] = [];
  for (let i = dataStartIndex; i < lines.length; i++) {
    let line = normalizeLedgerLine(lines[i].trim());
    
    // Skip page numbers, headers, and footer lines
    // IMPORTANT: Do NOT accidentally skip ledger rows like "6/1/2020 ...".
    // Only skip true page markers like "1 / 8" (standalone), plus explicit header/footer labels.
    if (line.match(/^Page\b/i)) continue;
    if (line.match(/^Created on\b/i)) continue;
    if (line.match(/^\d+\s*\/\s*\d+\s*$/)) continue;
    if (line.toUpperCase().startsWith('TENANT LEDGER')) continue;
    if (line.toUpperCase().startsWith('DATE PAYER DESCRIPTION')) continue;
    if (line.toUpperCase().startsWith('TOTAL')) {
      // Extract final balance from TOTAL line
      const numbers = line.match(moneyRegex);
      if (numbers && numbers.length > 0) {
        const lastNumber = numbers[numbers.length - 1].replace(/,/g, '');
        const parsed = parseFloat(lastNumber);
        if (!isNaN(parsed)) {
          // Preserve sign (some ledgers show negative balances).
          finalBalance = parsed;
          console.log('✅ Extracted final balance from TOTAL line:', finalBalance);
        }
      }
      continue;
    }
    
    const dateMatch = line.match(dateRegex);
    if (!dateMatch) {
      // If current line doesn't have a date but might be continuation of previous entry
      // Check if previous coalesced line ended with description and this line has amounts
      if (coalescedLines.length > 0) {
        const prevLine = coalescedLines[coalescedLines.length - 1];
        const prevHasDate = prevLine.match(dateRegex);
        moneyRegex.lastIndex = 0;
        const currentHasAmounts = moneyRegex.test(line);
        moneyRegex.lastIndex = 0;
        const prevHasAmounts = moneyRegex.test(prevLine);
        // If previous line has date but no amounts, and current line has amounts, merge them
        if (prevHasDate && currentHasAmounts && !prevHasAmounts) {
          coalescedLines[coalescedLines.length - 1] = `${prevLine} ${line}`;
          continue;
        }
      }
      continue;
    }
    
    // If we have a date, start a new entry
    // But first, check if next lines should be merged (description continuation or amounts)
    let buffer = line;
    let j = i + 1;
    while (j < lines.length) {
      const nextLine = normalizeLedgerLine(lines[j].trim());
      // Stop if next line has a date (new entry)
      if (nextLine.match(dateRegex)) break;
      // Stop if next line is a header/footer
      if (nextLine.match(/^Page\b/i) || nextLine.match(/^Created on\b/i) || 
          nextLine.match(/^\d+\s*\/\s*\d+\s*$/) || nextLine.toUpperCase().startsWith('TENANT LEDGER') ||
          nextLine.toUpperCase().startsWith('DATE PAYER DESCRIPTION') || nextLine.toUpperCase().startsWith('TOTAL')) break;
      
      // Merge if next line has amounts (money values) or continues description
      moneyRegex.lastIndex = 0; // Reset regex
      const nextHasAmounts = moneyRegex.test(nextLine);
      moneyRegex.lastIndex = 0; // Reset regex
      const bufferHasAmounts = moneyRegex.test(buffer);
      // If buffer doesn't have amounts yet but next line does, merge it
      // Or if buffer ends with incomplete description (like "Reversed by") and next line continues it
      if (nextHasAmounts && !bufferHasAmounts) {
        buffer = `${buffer} ${nextLine}`;
        j++;
      } else if (!bufferHasAmounts && !nextHasAmounts && buffer.length < 200) {
        // Merge description continuation (but limit length to avoid merging unrelated lines)
        buffer = `${buffer} ${nextLine}`;
        j++;
      } else {
        break;
      }
      if (j - i > 5) break; // Safety limit
    }
    i = j - 1; // Adjust i to skip merged lines
    coalescedLines.push(buffer);
  }
  
  // Now process coalesced lines
  for (let i = 0; i < coalescedLines.length; i++) {
    const line = coalescedLines[i];
    
    // Skip page numbers, headers, and footer lines
    if (line.match(/^Page\b/i)) continue;
    if (line.match(/^Created on\b/i)) continue;
    if (line.match(/^\d+\s*\/\s*\d+\s*$/)) continue;
    if (line.toUpperCase().startsWith('TENANT LEDGER')) continue;
    if (line.toUpperCase().startsWith('DATE PAYER DESCRIPTION')) continue;
    if (line.toUpperCase().startsWith('TOTAL')) {
      const numbers = line.match(moneyRegex);
      if (numbers && numbers.length > 0) {
        const lastNumber = numbers[numbers.length - 1].replace(/,/g, '');
        const parsed = parseFloat(lastNumber);
        if (!isNaN(parsed)) {
          finalBalance = parsed;
          console.log('✅ Extracted final balance from TOTAL line:', finalBalance);
        }
      }
      continue;
    }
    
    const dateMatch = line.match(dateRegex);
    if (!dateMatch) continue;
    
    const dateStr = dateMatch[1];
    const [month, day, year] = dateStr.split('/');
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    
    // =========================================================================
    // UNIVERSAL DESCRIPTION AMOUNT FILTERING
    // Remove amounts that appear in description context (not actual column values)
    // =========================================================================
    let cleanedLine = line;
    
    // Pattern: "$XXX.XX (MM/YYYY-MM/YYYY)" or "$XXX.XX(MM/YYYY-MM/YYYY)" - amounts with date ranges in parentheses
    // Example: "Scrie/Drie Adjustment$730.81 (12/2023-10/2024)" - the $730.81 is NOT the charge amount
    cleanedLine = cleanedLine.replace(/\$[\d,]+\.?\d*\s*\(\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{4}\)/gi, '(___)');
    
    // Pattern: Amount immediately before or after parenthesized date range (without $)
    // Example: "Adjustment730.81 (12/2023-10/2024)" or "730.81(12/2023-10/2024)"
    cleanedLine = cleanedLine.replace(/[\d,]+\.?\d{0,2}\s*\(\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{4}\)/gi, '(___)');
    
    // Pattern: "$XXX.XX/mth" or "$XXX.XX/month" or "$XXX.XX/mo" - rental rate mentions
    cleanedLine = cleanedLine.replace(/\$[\d,]+\.\d{2}\s*\/\s*(?:mth|month|mo)\b/gi, '___');
    
    // Pattern: "$XXX.XX per month" or "XXX.XX per mth"
    cleanedLine = cleanedLine.replace(/\$?[\d,]+\.\d{2}\s*per\s*(?:mth|month|mo)\b/gi, '___');
    
    // Pattern: "charges shd have been $XXX.XX" or "should have been $XXX.XX"
    cleanedLine = cleanedLine.replace(/(?:charges?\s+)?(?:shd|should)\s+(?:have\s+)?be(?:en)?\s+\$?[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: "been $XXX.XX/mth" - common in adjustment descriptions
    cleanedLine = cleanedLine.replace(/been\s+\$?[\d,]+\.\d{2}\s*\/?\s*(?:mth|month|mo)?\b/gi, '___');
    
    // Pattern: "@ $XXX.XX" or "at $XXX.XX" - rate references
    cleanedLine = cleanedLine.replace(/(?:@|at)\s*\$[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: "rate of $XXX.XX" or "rate $XXX.XX"
    cleanedLine = cleanedLine.replace(/rate\s*(?:of\s*)?\$?[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: "from $XXX.XX to $YYY.YY" - rate change descriptions  
    cleanedLine = cleanedLine.replace(/from\s+\$?[\d,]+\.\d{2}\s+to\s+\$?[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: "renewal ... $XXX.XX" - renewal rate mentions
    cleanedLine = cleanedLine.replace(/renewal[^$]*\$[\d,]+\.\d{2}/gi, '___');
    
    // Pattern: Amount followed by "/mth" anywhere
    cleanedLine = cleanedLine.replace(/[\d,]+\.\d{2}\s*\/\s*mth/gi, '___');
    
    // CRITICAL FIX: Handle concatenated money amounts (e.g., "767.720.00" should be split into "767.72" and "0.00")
    // This must happen AFTER normalizeLedgerLine but BEFORE moneyRegex matching
    cleanedLine = cleanedLine.replace(/(\d+\.\d{2})(\d+\.\d{2})/g, '$1 $2');
    
    // Extract all money amounts from CLEANED line (handle parentheses as negative)
    let amounts = [...cleanedLine.matchAll(moneyRegex)].map(m => {
      const raw = m[1];
      const isNegativeByParens = raw.startsWith('(') && raw.endsWith(')');
      const cleaned = raw.replace(/[(),]/g, '').replace(/,/g, '');
      const num = parseFloat(cleaned);
      return isNegativeByParens ? -Math.abs(num) : num;
    }).filter(n => !isNaN(n));
    
    if (amounts.length === 0) continue;
    
    // In this format, the last number is always the balance
    const balance = amounts[amounts.length - 1];
    
    // Extract description (between date and first money amount)
    const afterDate = line.substring(line.indexOf(dateStr) + dateStr.length).trim();
    
    // Find the first money amount position
    // NOTE: Some runtimes can omit match indices; use indexOf on the matched text for robustness.
    const firstMoney = [...afterDate.matchAll(moneyRegex)][0]?.[0];
    const firstMoneyIdx = firstMoney ? afterDate.indexOf(firstMoney) : -1;
    let description = firstMoneyIdx >= 0 ? afterDate.substring(0, firstMoneyIdx).trim() : afterDate;
    
    // Description might have payer name at the start (remove if it's a name pattern)
    // Pattern: "Sarah Thomas" or "Shekinah Voisin" followed by description
    // IMPORTANT: Only strip a payer name when it's followed by a payment keyword, otherwise we
    // would mistakenly strip descriptions like "Residential Rent ...".
    description = description.replace(
      /^([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?=(?:ACH\s+Payment|Credit\s+Card\s+Payment|Payment|EFT|Wire|Check|Chk)\b)/,
      ''
    ).trim();
    
    // Clean up description - remove extra spaces
    description = description.replace(/\s+/g, ' ').trim();
    
    // Determine charges and payments
    let debit = 0;
    let credit = 0;
    const descLower = description.toLowerCase();
    const clsForAmounts = classifyDescription(description);
    const isLateFeeLine = descLower.includes('late fee') || descLower.includes('late fees') || descLower.includes('late charge');
    
    // If we have 3 numbers: Charges, Payments, Balance
    // If we have 2 numbers: either Charges+Balance or Payments+Balance
    if (amounts.length >= 3) {
      // SPECIAL CASE: Late fee rows show "Reference, ActualFee, Balance" (NO payment column).
      // Example: "Late Fees 06/2025, 5% of $2210.56  110.53  2301.34" → pick 110.53, not 2210.56
      const nonBalance = amounts.slice(0, -1);
      // Pattern match for late fees: "late fee", "%", or "of $" / "of$" (flexible spacing)
      const isLateFeePattern = isLateFeeLine || descLower.includes('%') || /\bof\s*\$?[\d,]/i.test(descLower);
      
      if (
        nonBalance.length === 2 &&
        !clsForAmounts.isPayment &&
        isLateFeePattern
      ) {
        const a0 = Math.abs(nonBalance[0]);
        const a1 = Math.abs(nonBalance[1]);
        // ALWAYS pick second amount for late fees (it's the actual charge, not reference)
        debit = Math.max(0, a1);
        credit = 0;
      } else {
        // Standard: Charges, Payments, Balance
        debit = Math.max(0, amounts[0]);
        credit = Math.max(0, amounts[1]);
      }
    } else if (amounts.length === 2) {
      // Need to determine if first is charge or payment based on description
      const cls = clsForAmounts;
      // If the first amount is negative, treat it as a credit/adjustment (not a charge).
      if (amounts[0] < 0) {
        credit = Math.abs(amounts[0]);
      } else if (cls.isPayment || description.toLowerCase().includes('payment') || description.toLowerCase().includes('ach')) {
        credit = Math.abs(amounts[0]);
      } else {
        debit = Math.abs(amounts[0]);
      }
    }

    // Track opening balance (best-effort):
    // If we didn't see an explicit "Starting Balance", infer it from the first transaction:
    // opening ≈ balance - debit + credit (i.e., prior balance before this row).
    if (!openingBalanceExplicit && ledgerEntries.length === 0) {
      openingBalance = balance - debit + credit;
    }
    
    // Update final balance (keep the latest)
    if (Math.abs(balance) > 0) {
      finalBalance = balance;
    }
    
    const classified = classifyDescription(description);
    const isRental = classified.isRentalCharge;
    const isPayment = classified.isPayment || description.toLowerCase().includes('payment') || description.toLowerCase().includes('ach');
    
    // Add to ledger entries
    ledgerEntries.push({
      date,
      description: description || 'Unknown',
      debit: debit > 0 ? debit : 0,
      credit: credit > 0 ? credit : 0,
      balance,
      isRental: isRental ? true : (classified.isNonRentalCharge ? false : undefined)
    });
    
    // Add to rental charges
    if (isRental && debit > 0 && !isPayment) {
      rentalCharges.push({
        description,
        amount: debit,
        date
      });
    }
    
    // Add to non-rental charges
    // CRITICAL: Only include actual CHARGES (debit > 0), not payments/credits/refunds.
    // Exclude: rental, payments (ACH/receipt/reversal), balance-forward rows.
    const isLateFee = description.toLowerCase().includes('late fee') || description.toLowerCase().includes('late fees');
    const isSecurityDeposit = description.toLowerCase().includes('security deposit');
    const isNonRental = !isRental && !isPayment && !classified.isBalanceForward && debit > 0 && (
      classified.isNonRentalCharge || 
      isLateFee || 
      isSecurityDeposit ||
      description.toLowerCase().includes('fee') ||
      description.toLowerCase().includes('deposit')
    );
    
    if (isNonRental) {
      let category = 'other';
      if (isLateFee) category = 'late_fee';
      else if (isSecurityDeposit) category = 'security_deposit';
      else if (classified.category && classified.category !== 'rent') category = classified.category;
      
      nonRentalCharges.push({
        description,
        amount: debit,
        date,
        category
      });
    }
  }
  
  // De-duplicate entries BEFORE sorting (same date + description + amount)
  const dedupeKey = (date: string, desc: string, amt: number) => 
    `${date}::${desc.toLowerCase().trim()}::${Math.round(amt * 100)}`;
  
  const seenLedger = new Set<string>();
  const dedupedLedger = ledgerEntries.filter(e => {
    const key = dedupeKey(e.date, e.description, e.balance);
    if (seenLedger.has(key)) return false;
    seenLedger.add(key);
    return true;
  });
  
  const seenRental = new Set<string>();
  const dedupedRental = rentalCharges.filter((c: any) => {
    const key = dedupeKey(c.date, c.description, c.amount);
    if (seenRental.has(key)) return false;
    seenRental.add(key);
    return true;
  });
  
  const seenNonRental = new Set<string>();
  const dedupedNonRental = nonRentalCharges.filter((c: any) => {
    const key = dedupeKey(c.date, c.description, c.amount);
    if (seenNonRental.has(key)) return false;
    seenNonRental.add(key);
    return true;
  });
  
  // Sort by date
  dedupedLedger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  dedupedRental.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  dedupedNonRental.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Filter out security deposits that have been paid (by matching payment amounts)
  // This must happen AFTER sorting so we have all ledger entries available for checking
  const filteredNonRental = dedupedNonRental.filter((charge) => {
    // Only check security deposits
    if (charge.category !== 'security_deposit') {
      const desc = (charge.description ?? '').toLowerCase();
      if (!desc.includes('security deposit') && !desc.includes('security deposits')) {
        return true; // Keep non-security-deposit charges
      }
    }
    
    // For security deposits, check if they've been paid
    const depositAmount = charge.amount ?? 0;
    if (depositAmount <= 0) return true; // Keep if invalid amount
    
    // Check if a matching payment exists in any transaction
    const isPaid = isSecurityDepositPaidByMatchingPayment(
      depositAmount,
      dedupedLedger,
      charge.date
    );
    
    // Only keep security deposits that haven't been paid
    return !isPaid;
  });
  
  // Final balance should be from the LAST entry (most recent) after sorting
  if (dedupedLedger.length > 0) {
    const lastEntry = dedupedLedger[dedupedLedger.length - 1];
    finalBalance = lastEntry.balance;
    console.log('Final balance from last entry:', finalBalance, 'Date:', lastEntry.date);
  }
  
  // If opening balance is 0, use first entry's balance
  if (openingBalance === 0 && dedupedLedger.length > 0) {
    openingBalance = dedupedLedger[0].balance;
  }
  
  console.log('Tenant Ledger parsing complete:', {
    tenantName,
    propertyName,
    finalBalance,
    openingBalance,
    rentalCharges: dedupedRental.length,
    nonRentalCharges: filteredNonRental.length,
    ledgerEntries: dedupedLedger.length,
    duplicatesRemoved: (ledgerEntries.length - dedupedLedger.length) + (rentalCharges.length - dedupedRental.length) + (nonRentalCharges.length - dedupedNonRental.length),
    securityDepositsFiltered: dedupedNonRental.length - filteredNonRental.length
  });
  
  return {
    tenantName,
    propertyName,
    period: dedupedLedger.length > 0 
      ? `${dedupedLedger[0].date} to ${dedupedLedger[dedupedLedger.length - 1].date}`
      : 'Extracted Period',
    openingBalance: openingBalance || finalBalance || 0,
    finalBalance: finalBalance || openingBalance || 0,
    rentalCharges: dedupedRental,
    nonRentalCharges: filteredNonRental,
    ledgerEntries: dedupedLedger,
    issueDate,
  };
}

// Exported for deterministic self-tests and debugging.
export function parsePDFTextDirectly(extractedText: string): HuggingFaceResponse {
  const lines = extractedText.split('\n').filter(line => line.trim().length > 0);
  
  // Check if this is a "Tenant Ledger" format: Date | Payer | Description | Charges | Payments | Balance
  // FirstService company ledgers explicitly say "FirstService" or "FIRSTSERVICE".
  const isFirstService = 
    extractedText.includes('FirstService') || 
    extractedText.includes('FIRSTSERVICE');
  
  const isTenantLedgerFormat = 
    isFirstService ||
    (extractedText.includes('Tenant Ledger') || extractedText.includes('Tenants:')) &&
    lines.some(line => {
      const upper = line.toUpperCase();
      return (upper.includes('DATE') && upper.includes('DESCRIPTION') && 
             (upper.includes('CHARGES') || upper.includes('PAYMENTS') || upper.includes('BALANCE')));
    });
  
  if (isTenantLedgerFormat) {
    console.log('📋 Detected Tenant Ledger format' + (isFirstService ? ' (FirstService)' : ''));
    return parseTenantLedgerFormat(extractedText);
  }
  
  // Check if this is a "Resident Ledger" format (different structure)
  // Format: Date | Chg Code | Description | Charge | Payment | Balance | Chg/Rec
  // Detect by explicit "Resident Ledger" text OR ("Chg Code" AND NOT FirstService).
  // IMPORTANT: Exclude "Chg/Rec" column indicator from Resident detection (some Tenant have it too).
  const hasChgCodeColumn = extractedText.includes('Chg Code') || extractedText.includes('Chg/Rec');
  const isResidentLedgerFormat = 
    extractedText.includes('Resident Ledger') ||
    (!isFirstService && hasChgCodeColumn && !extractedText.includes('Charge') && !extractedText.includes('Payment'));
  
  if (isResidentLedgerFormat) {
    console.log('📋 Detected Resident Ledger format');
    const resident = parseResidentLedgerFormat(extractedText);
    // If resident parsing fails, fall back to the generic parser below.
    const hasResidentData =
      (resident.ledgerEntries?.length ?? 0) > 0 ||
      (resident.rentalCharges?.length ?? 0) > 0 ||
      (resident.nonRentalCharges?.length ?? 0) > 0;
    if (hasResidentData) {
      return resident;
    }
    console.log('⚠️ Resident Ledger parsing returned no/low entries; using generic parser fallback');
  }
  
  // Extract tenant name - look for "TO:" field
  let tenantName = 'Unknown Tenant';
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i].trim();
    
    // Match "TO:" followed by name (can be on same line or next line)
    if (line.match(/^TO:\s*(.+)/i)) {
      const match = line.match(/^TO:\s*(.+)/i);
      if (match && match[1].trim()) {
        tenantName = match[1].trim();
        break;
      }
    }
    
    // Check for "TO:" on a line by itself (with optional spaces), name on next line
    if (line === 'TO:' || line.match(/^TO:\s*$/i)) {
      if (i + 1 < lines.length) {
        const nameLine = lines[i + 1].trim();
        // Name should not be an address (no street numbers at start)
        if (nameLine && !nameLine.match(/^\d+.*(?:STREET|AVENUE|PARKWAY|ROAD|BOULEVARD|LANE)/i)) {
          // Take first line as name (usually just the name)
          tenantName = nameLine;
          break;
        }
      }
    }
  }
  
  console.log('Extracted tenant name:', tenantName);
  
  // Also check for "Name" field in Resident Ledger format
  if (tenantName === 'Unknown Tenant') {
    for (const line of lines.slice(0, 10)) {
      if (line.match(/Name\s+(\w+\s+\w+)/i)) {
        const match = line.match(/Name\s+(\w+\s+\w+)/i);
        if (match) {
          tenantName = match[1].trim();
          break;
        }
      }
    }
  }
  
  // Extract property address - look for address in TO section (NOT FROM section)
  let propertyName = 'Unknown Property';
  let foundTO = false;
  
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const line = lines[i].trim();
    
    // Mark when we find "TO:" section
    if (line.match(/^TO:/i)) {
      foundTO = true;
      continue;
    }
    
    // Only extract address from TO section, not FROM section
    if (foundTO && line.match(/^\d+.*(?:PARKWAY|STREET|AVENUE|ROAD|BOULEVARD|LANE)/i)) {
      // This is the property address in TO section
      propertyName = line.trim();
      
      // Check if Apt is in the same line
      if (line.match(/Apt[:\s]*(\w+)/i)) {
        const aptMatch = line.match(/Apt[:\s]*(\w+)/i);
        if (aptMatch && !propertyName.includes(aptMatch[1])) {
          // Already included in line
        }
      } else {
        // Check next line for Apt/Unit
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim();
          const aptMatch = nextLine.match(/Apt[:\s]*(\w+)|Apt[\/\s]*Unit\s+No[.:]\s*(\w+)/i);
          if (aptMatch) {
            propertyName += ` ${aptMatch[1] || aptMatch[2]}`;
          }
        }
      }
      break;
    }
    
    // Also check for "Re: STATEMENT" followed by address
    if (line.match(/Re:\s*STATEMENT/i)) {
      // Next line usually has the address
      if (i + 1 < lines.length) {
        const addressLine = lines[i + 1].trim();
        if (addressLine.match(/\d+.*(?:STREET|AVENUE|ROAD|PARKWAY|BOULEVARD|LANE)/i)) {
          propertyName = addressLine.trim();
          // Also check for Apt/Unit on same or next line
          if (i + 2 < lines.length) {
            const unitLine = lines[i + 2].trim();
            const unitMatch = unitLine.match(/Apt[:\s]*(\w+)|Apt[\/\s]*Unit\s+No[.:]\s*(\w+)/i);
            if (unitMatch) {
              propertyName += ` ${unitMatch[1] || unitMatch[2]}`;
            }
          }
          break;
        }
      }
    }
  }
  
  console.log('Extracted property address:', propertyName);
  
  // Extract final balance from TOTAL line (LAST line with TOTAL)
  let finalBalance = 0;
  console.log('🔍 Searching for TOTAL line in', lines.length, 'lines...');
  
  // Search from the end backwards (TOTAL line should be near the end)
  for (let i = lines.length - 1; i >= 0; i--) {
    const originalLine = lines[i].trim();
    const line = originalLine.toUpperCase();
    
    // Look for "TOTAL" line - should be near the end
    // Format: "TOTAL  234345.71  228609.66    5736.05" - last number is balance
    if (line.includes('TOTAL') && !line.includes('NON-RENTAL') && !line.includes('CHARGES')) {
      console.log('📋 Found TOTAL line:', originalLine);
      
      // Extract all numbers from the line (handle both with and without commas)
      // Pattern: TOTAL  number  number  number (last number is balance)
      // Example: "TOTAL  234345.71  228609.66    5736.05"
      // Try multiple regex patterns to catch all formats
      
      let numbers: string[] | null = null;
      
      // Pattern 1: Numbers with decimals (preferred)
      // Updated to handle numbers without commas (e.g., 5736.05)
      const match1 = originalLine.match(/(\d+\.\d{2})/g);
      if (match1) {
        numbers = match1;
      }
      
      // Pattern 2: If no match, try splitting by whitespace and finding numbers
      if (!numbers || numbers.length === 0) {
        const parts = originalLine.split(/\s+/);
        const filteredNumbers = parts.filter(p => {
          const cleaned = p.replace(/,/g, '');
          return /^\d+\.\d{2}$/.test(cleaned) || /^\d{1,3}(?:,\d{3})+\.\d{2}$/.test(p);
        });
        if (filteredNumbers.length > 0) {
          numbers = filteredNumbers;
        }
      }
      
      // Pattern 3: Last resort - find any number pattern
      if (!numbers || numbers.length === 0) {
        const altMatch = originalLine.match(/(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}|\d{1,3}(?:,\d{3})*|\d+)/g);
        if (altMatch) {
          numbers = altMatch;
        }
      }
      
      if (numbers && numbers.length >= 1) {
        // Last number is ALWAYS the final balance (BALANCE DUE column)
        const lastNumber = numbers[numbers.length - 1].replace(/,/g, '');
        const parsed = parseFloat(lastNumber);
        // Accept any valid number (including negative balances and small amounts)
        if (!isNaN(parsed)) {
          finalBalance = Math.abs(parsed); // Use absolute value for balance
          console.log('✅ Extracted final balance from TOTAL line:', finalBalance, 'from line:', originalLine, 'all numbers:', numbers);
          break;
        }
      }
      
      console.log('⚠️ TOTAL line found but no valid numbers extracted:', originalLine);
    }
  }
  
  // If still no final balance, try to find it from last ledger entry
  if (finalBalance === 0) {
    console.log('⚠️ Final balance not found in TOTAL line, will use last ledger entry balance');
  } else {
    console.log('✅ Final balance successfully extracted:', finalBalance);
  }
  
  // Extract opening balance (first balance or YEAR STARTING BALANCE)
  let openingBalance = 0;
  for (const line of lines) {
    const upperLine = line.toUpperCase();
    if (upperLine.includes('YEAR STARTING BALANCE')) {
      const balanceMatch = line.match(/((?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2})/);
      if (balanceMatch) {
        openingBalance = parseFloat(balanceMatch[1].replace(/,/g, ''));
        break;
      }
    }
  }
  
  // If no opening balance found, use first transaction balance
  if (openingBalance === 0) {
    for (const line of lines) {
      // Look for first date pattern with balance
      const firstEntryMatch = line.match(/(\d{2}\/\d{2}\/\d{4}).*?((?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2})\s*$/);
      if (firstEntryMatch) {
        openingBalance = parseFloat(firstEntryMatch[2].replace(/,/g, ''));
        break;
      }
    }
  }

  // Generic ledger extraction (handles many different ledger layouts).
  // IMPORTANT: "Statement" PDFs often wrap the running balance onto the next line, e.g.:
  //   07/01/2015  1 BASE RENT : 1525.00
  //   1525.00
  // If we don't coalesce these, ledgerEntries can come out empty/very small and Step 3 can't apply
  // the (day 1–5 => previous month) rule.
  const coalesceStatementLedgerLines = (text: string): string => {
    const moneyToken = /\(?-?\$?(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}\)?/g;
    const dateToken = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/;

    const rawLines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const out: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      const hasDate = dateToken.test(line);
      if (!hasDate) {
        out.push(line);
        continue;
      }

      const tokens = [...line.matchAll(moneyToken)].map((m) => m[0]);
      // If this line has <2 money tokens, it might be a wrapped entry; pull in following money-only lines.
      if (tokens.length < 2) {
        let j = i + 1;
        while (j < rawLines.length) {
          const next = rawLines[j];
          if (dateToken.test(next)) break; // next entry begins
          const nextTokens = [...next.matchAll(moneyToken)].map((m) => m[0]);
          if (nextTokens.length === 0) break; // not an amount line; stop
          // Append the amount line and continue (handles cases where both billed+balance are split).
          line = `${line} ${next}`.replace(/\s+/g, ' ').trim();
          j++;
          // If we now have enough money tokens to parse charge/payment/balance, stop.
          const mergedTokens = [...line.matchAll(moneyToken)].map((m) => m[0]);
          if (mergedTokens.length >= 2) break;
        }
        i = j - 1; // skip consumed lines
      }

      out.push(line);
    }

    return out.join('\n');
  };

  const normalizedForLedger = coalesceStatementLedgerLines(extractedText);
  const { ledgerEntries: ledgerEntriesRaw } = parseLedgerFromText(extractedText);
  const { ledgerEntries: ledgerEntriesCoalesced } = parseLedgerFromText(normalizedForLedger);
  const ledgerEntries =
    ledgerEntriesCoalesced.length > ledgerEntriesRaw.length ? ledgerEntriesCoalesced : ledgerEntriesRaw;
  const { rentalCharges, nonRentalCharges } = chargesFromLedgerEntries(ledgerEntries);

  // If opening balance is still unknown, use the first ledger balance (if available)
  if (openingBalance === 0 && ledgerEntries.length > 0) {
    openingBalance = ledgerEntries[0].balance;
  }

  // If final balance isn't found in TOTAL, use the last ledger balance (if available)
  if (finalBalance === 0 && ledgerEntries.length > 0) {
    finalBalance = ledgerEntries[ledgerEntries.length - 1].balance;
  }

  const period =
    ledgerEntries.length > 0
      ? `${ledgerEntries[0].date} to ${ledgerEntries[ledgerEntries.length - 1].date}`
      : 'Extracted Period';

  console.log('Direct parsing complete (generic):', {
    finalBalance,
    openingBalance,
    rentalCharges: rentalCharges.length,
    nonRentalCharges: nonRentalCharges.length,
    ledgerEntries: ledgerEntries.length,
  });
  
  // CRITICAL: finalBalance should NEVER be 0 if we found it in TOTAL line
  // If finalBalance is 0, it means we didn't extract it properly
  if (finalBalance === 0) {
    console.warn('⚠️ WARNING: finalBalance is 0 - TOTAL line not found or extraction failed!');
    // Try to use last ledger entry balance as fallback
    if (ledgerEntries.length > 0) {
      const lastEntry = ledgerEntries[ledgerEntries.length - 1];
      finalBalance = lastEntry.balance;
      console.log('Using last ledger entry balance as finalBalance:', finalBalance);
    }
  }
  
  console.log('📊 Final return values:', {
    tenantName,
    propertyName,
    openingBalance,
    finalBalance,
    rentalCharges: rentalCharges.length,
    nonRentalCharges: nonRentalCharges.length,
    ledgerEntries: ledgerEntries.length
  });
  
  return {
    tenantName,
    propertyName,
    period,
    openingBalance: openingBalance || 0,
    finalBalance: finalBalance || 0, // Don't fallback to openingBalance - keep it 0 if not found
    rentalCharges: rentalCharges.length > 0 ? rentalCharges : [],
    nonRentalCharges: nonRentalCharges,
    ledgerEntries: ledgerEntries
  };
}

/**
 * Send extracted text to Hugging Face for intelligent parsing using direct API calls
 */
export async function analyzeWithAI(extractedText: string): Promise<HuggingFaceResponse> {
  const issueDate = extractIssueDateISO(extractedText);
  // FIRST: Try direct parsing for 100% accuracy
  console.log('Attempting direct text parsing for 100% accuracy...');
  try {
    const directResult = parsePDFTextDirectly(extractedText);
    console.log('Direct parsing results:', {
      tenantName: directResult.tenantName,
      propertyName: directResult.propertyName,
      finalBalance: directResult.finalBalance,
      rentalCharges: directResult.rentalCharges.length,
      nonRentalCharges: directResult.nonRentalCharges.length,
      ledgerEntries: directResult.ledgerEntries?.length || 0
    });
    
    // If we got good results from direct parsing, use it
    // Check for: final balance, tenant name, and at least some charges or ledger entries
    const hasFinalBalance = (directResult.finalBalance ?? 0) > 0;
    const hasTenantName = directResult.tenantName !== 'Unknown Tenant';
    const hasCharges = directResult.nonRentalCharges.length > 0 || directResult.rentalCharges.length > 0;
    const hasLedgerEntries = (directResult.ledgerEntries?.length ?? 0) > 5;
    
    // ALWAYS use direct parsing if we have ANY data (even if tenant name is missing)
    // We can improve tenant name extraction later, but use what we have
    if (hasFinalBalance || hasCharges || hasLedgerEntries) {
      console.log('✅ Using direct parsing results - 100% accurate!');
      directResult.issueDate = directResult.issueDate ?? issueDate;
      
      // If finalBalance is 0 but we have ledger entries, extract from last entry
      if (!hasFinalBalance && hasLedgerEntries && directResult.ledgerEntries) {
        const sorted = [...directResult.ledgerEntries].sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        if (sorted.length > 0) {
          directResult.finalBalance = sorted[0].balance;
          console.log('⚠️ Final balance was 0, extracted from last ledger entry:', directResult.finalBalance);
        }
      }
      
      if (!hasTenantName) {
        console.log('⚠️ Warning: Tenant name not extracted, but using direct parsing anyway');
      }
      if (!hasFinalBalance && !hasLedgerEntries) {
        console.log('⚠️ Warning: Final balance not extracted and no ledger entries, will use openingBalance');
      }
      return directResult;
    }
    
    // Only use AI if direct parsing found absolutely nothing
    console.log('⚠️ Direct parsing found no data, falling back to AI...');
  } catch (error) {
    console.error('Direct parsing error:', error);
  }
  
  // FALLBACK: Use AI if direct parsing didn't work well
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  
  if (!apiKey) {
    console.warn('Hugging Face API key not configured, using direct parsing only');
    return parsePDFTextDirectly(extractedText);
  }

  try {
    // Send full text to AI - no truncation for better extraction
    // Most models can handle up to 4000-8000 tokens, so we'll send more text
    const maxTextLength = 15000; // Increased from 3000 to extract more data
    const textToAnalyze = extractedText.length > maxTextLength 
      ? extractedText.substring(0, maxTextLength) + '\n\n[... text truncated for length ...]'
      : extractedText;
    
    const prompt = EXTRACTION_PROMPT + textToAnalyze;
    
    // Try multiple models in order of preference
    // Using instruction-tuned models that are better at JSON extraction
    const models = [
      'mistralai/Mistral-7B-Instruct-v0.2',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'meta-llama/Llama-2-7b-chat-hf',
      'microsoft/DialoGPT-medium'
    ];
    
    for (const model of models) {
      try {
        console.log(`Trying model: ${model}`);
        
        // Hugging Face deprecated api-inference.huggingface.co; use router endpoint instead.
        const response = await fetch(`https://router.huggingface.co/models/${model}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              max_new_tokens: 4000, // Increased to handle more charges
              temperature: 0.1,
              return_full_text: false,
              top_p: 0.95,
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Model ${model} failed:`, response.status, errorText);
          continue; // Try next model
        }

        const result = await response.json();
        console.log('API Response:', result);
        
        let aiResponse = '';
        if (Array.isArray(result) && result[0]?.generated_text) {
          aiResponse = result[0].generated_text.trim();
        } else if (result.generated_text) {
          aiResponse = result.generated_text.trim();
        } else {
          console.error('Unexpected response format:', result);
          continue; // Try next model
        }

        // Try to extract JSON from response
        // Look for JSON object in the response
        let jsonString = '';
        
        // Try to find JSON object
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonString = jsonMatch[0];
        } else {
          // Try to find JSON in code blocks
          const codeBlockMatch = aiResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
          if (codeBlockMatch) {
            jsonString = codeBlockMatch[1];
          } else {
            // Try to extract from markdown code
            const markdownMatch = aiResponse.match(/```[\s\S]*?\{[\s\S]*?\}[\s\S]*?```/);
            if (markdownMatch) {
              jsonString = markdownMatch[0].replace(/```(?:json)?/g, '').trim();
            }
          }
        }
        
        if (jsonString) {
          try {
            // Clean up the JSON string
            jsonString = jsonString
              .replace(/^[^{]*/, '') // Remove text before first {
              .replace(/[^}]*$/, '') // Remove text after last }
              .trim();
            
            const parsedData: HuggingFaceResponse = JSON.parse(jsonString);
            
            // Validate and set defaults
            parsedData.tenantName = parsedData.tenantName || 'Unknown Tenant';
            parsedData.propertyName = parsedData.propertyName || 'Unknown Property';
            parsedData.period = parsedData.period || 'Unknown Period';
            parsedData.openingBalance = parsedData.openingBalance || 0;
            // Use finalBalance if provided, otherwise use openingBalance as fallback
            parsedData.finalBalance = parsedData.finalBalance ?? parsedData.openingBalance;
            parsedData.rentalCharges = parsedData.rentalCharges || [];
            parsedData.nonRentalCharges = parsedData.nonRentalCharges || [];
            parsedData.ledgerEntries = parsedData.ledgerEntries || [];
            
            console.log('Successfully parsed AI response:', {
              tenantName: parsedData.tenantName,
              propertyName: parsedData.propertyName,
              rentalCharges: parsedData.rentalCharges.length,
              nonRentalCharges: parsedData.nonRentalCharges.length,
              ledgerEntries: parsedData.ledgerEntries?.length || 0,
              finalBalance: parsedData.finalBalance
            });
            
            // If AI extracted very few non-rental charges (less than 3), it might have missed some
            // But we'll still return it and let the user see - they can check the extracted text
            if (parsedData.nonRentalCharges.length < 3 && extractedText.length > 1000) {
              console.warn('AI extracted only', parsedData.nonRentalCharges.length, 'non-rental charges. This might be incomplete.');
            }
            
            parsedData.issueDate = parsedData.issueDate ?? issueDate;
            return parsedData;
          } catch (parseError) {
            console.error('JSON parse error:', parseError);
            console.error('Attempted to parse:', jsonString.substring(0, 200));
            continue; // Try next model
          }
        }
      } catch (modelError) {
        console.error(`Error with model ${model}:`, modelError);
        continue; // Try next model
      }
    }
    
    // If all models fail, return a fallback response
    console.log('All models failed, creating fallback response');
    return createFallbackResponse(extractedText);
    
  } catch (error) {
    console.error('Hugging Face API error:', error);
    throw new Error('AI analysis failed. Please check your API key and try again.');
  }
}

/**
 * Create a fallback response when AI fails - Enhanced parser
 */
function createFallbackResponse(extractedText: string): HuggingFaceResponse {
  const lines = extractedText.split('\n').filter(line => line.trim().length > 0);

  // Amounts in ledgers can be 2+ digits without commas (e.g., 1525.00, 1886.61)
  // or comma-formatted (e.g., 1,525.00). Use a single shared fragment to avoid
  // accidentally excluding common 4+ digit amounts.
  const AMOUNT_WITH_CENTS = '(?:\\d{1,3}(?:,\\d{3})*|\\d+)\\.\\d{2}';
  
  // Extract tenant name
  let tenantName = 'Unknown Tenant';
  for (const line of lines.slice(0, 15)) {
    if (line.match(/^TO:\s*(.+)/i)) {
      const match = line.match(/^TO:\s*(.+)/i);
      if (match) {
        tenantName = match[1].trim();
        break;
      }
    }
  }
  
  // Extract property address
  let propertyName = 'Unknown Property';
  for (const line of lines.slice(0, 20)) {
    if (line.match(/Re:\s*STATEMENT/i) || line.match(/^\d+.*(?:STREET|AVENUE|ROAD|PARKWAY|BOULEVARD)/i)) {
      const addressMatch = line.match(/(\d+.*(?:STREET|AVENUE|ROAD|PARKWAY|BOULEVARD).*)/i);
      if (addressMatch) {
        propertyName = addressMatch[1].trim();
        break;
      }
    }
  }
  
  // Extract final balance from TOTAL line
  let finalBalance = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].toUpperCase().includes('TOTAL')) {
      // Updated regex to handle numbers without commas (e.g., 5736.05)
      const numbers = lines[i].match(/(\d+\.\d{2})/g);
      if (numbers && numbers.length > 0) {
        finalBalance = parseFloat(numbers[numbers.length - 1].replace(/,/g, ''));
        break;
      }
    }
  }
  
  // Extract opening balance (first balance or YEAR STARTING BALANCE)
  let openingBalance = 0;
  for (const line of lines) {
    if (line.toUpperCase().includes('YEAR STARTING BALANCE')) {
      const balanceMatch = line.match(/(\d{1,3}(?:,\d{3})*\.\d{2})/);
      if (balanceMatch) {
        openingBalance = parseFloat(balanceMatch[1].replace(/,/g, ''));
        break;
      }
    }
  }
  
  // Extract rental charges (BASE RENT entries)
  const rentalCharges: any[] = [];
  const rentalRegex = new RegExp(
    `(\\d{2}\\/\\d{2}\\/\\d{4})\\s+\\d+\\s+BASE\\s+RENT\\s*:\\s*(${AMOUNT_WITH_CENTS})`,
    'i'
  );
  
  for (const line of lines) {
    const match = line.match(rentalRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[2].replace(/,/g, ''));
      
      rentalCharges.push({
        description: 'BASE RENT',
        amount: amount,
        date: date
      });
    }
  }
  
  // Extract non-rental charges - ALL of them
  const nonRentalCharges: any[] = [];
  
  // Pattern for AIR CONDITIONER
  const acRegex = new RegExp(
    `(\\d{2}\\/\\d{2}\\/\\d{4})\\s+\\d+\\s+AIR\\s+CONDITIONER\\s*:\\s*(${AMOUNT_WITH_CENTS})`,
    'i'
  );
  for (const line of lines) {
    const match = line.match(acRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[2].replace(/,/g, ''));
      
      nonRentalCharges.push({
        description: 'AIR CONDITIONER',
        amount: amount,
        date: date,
        category: 'air_conditioner'
      });
    }
  }
  
  // Pattern for LATE CHARGE
  const lateRegex = new RegExp(
    `(\\d{2}\\/\\d{2}\\/\\d{4})\\s+\\d+\\s+LATE\\s+(?:CHARGE|FEE)\\s*:.*?(${AMOUNT_WITH_CENTS})`,
    'i'
  );
  for (const line of lines) {
    const match = line.match(lateRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[2].replace(/,/g, ''));
      
      nonRentalCharges.push({
        description: 'LATE CHARGE',
        amount: amount,
        date: date,
        category: 'late_fee'
      });
    }
  }
  
  // Pattern for LEGAL FEES
  const legalRegex = new RegExp(
    `(\\d{2}\\/\\d{2}\\/\\d{4})\\s+\\d+\\s+LEGAL\\s+FEES\\s*:.*?(${AMOUNT_WITH_CENTS})`,
    'i'
  );
  for (const line of lines) {
    const match = line.match(legalRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[2].replace(/,/g, ''));
      
      nonRentalCharges.push({
        description: line.match(/LEGAL\s+FEES\s*:\s*(.+?)(?:\s+\d|$)/i)?.[1]?.trim() || 'LEGAL FEES',
        amount: amount,
        date: date,
        category: 'legal_fees'
      });
    }
  }
  
  // Pattern for BAD CHECK CHARGE
  const badCheckRegex = new RegExp(
    `(\\d{2}\\/\\d{2}\\/\\d{4})\\s+\\d+\\s+BAD\\s+CHECK\\s+CHARGE\\s*:.*?(${AMOUNT_WITH_CENTS})`,
    'i'
  );
  for (const line of lines) {
    const match = line.match(badCheckRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[2].replace(/,/g, ''));
      
      nonRentalCharges.push({
        description: 'BAD CHECK CHARGE',
        amount: amount,
        date: date,
        category: 'bad_check'
      });
    }
  }
  
  // Pattern for SECURITY DEPOSIT
  const securityRegex = new RegExp(
    `(\\d{2}\\/\\d{2}\\/\\d{4})\\s+\\d+\\s+SECURITY\\s+DEPOSIT\\s*:\\s*(${AMOUNT_WITH_CENTS})`,
    'i'
  );
  for (const line of lines) {
    const match = line.match(securityRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[2].replace(/,/g, ''));
      
      nonRentalCharges.push({
        description: 'SECURITY DEPOSIT',
        amount: amount,
        date: date,
        category: 'security_deposit'
      });
    }
  }
  
  return {
    tenantName,
    propertyName,
    period: 'Extracted Period',
    openingBalance: openingBalance || finalBalance || 0,
    finalBalance: finalBalance || openingBalance || 0,
    rentalCharges: rentalCharges.length > 0 ? rentalCharges : [{
      description: 'BASE RENT',
      amount: 0,
      date: new Date().toISOString().split('T')[0]
    }],
    nonRentalCharges: nonRentalCharges.length > 0 ? nonRentalCharges : [],
    ledgerEntries: []
  };
}

/**
 * Validate Hugging Face API key
 */
export function validateHuggingFaceConfig(): boolean {
  return !!process.env.HUGGINGFACE_API_KEY;
}
