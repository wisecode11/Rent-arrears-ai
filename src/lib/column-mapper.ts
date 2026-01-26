/**
 * Intelligent Column Mapper
 * 
 * This module provides dynamic column detection and mapping for various ledger formats.
 * It uses synonym matching, fuzzy matching, and pattern recognition to automatically
 * identify column types regardless of naming conventions.
 */

export type ColumnType = 
  | 'date'
  | 'chargeCode'
  | 'description'
  | 'debit'
  | 'credit'
  | 'balance'
  | 'unit'
  | 'fiscalPeriod'
  | 'reference'
  | 'unknown';

export interface ColumnMapping {
  index: number;
  originalName: string;
  normalizedName: string;
  type: ColumnType;
  confidence: number; // 0-1 score
}

export interface HeaderAnalysis {
  columns: ColumnMapping[];
  format: 'standard' | 'bldgUnit' | 'tenantLedger' | 'custom';
  hasAllRequired: boolean;
  missingColumns: ColumnType[];
}

// Comprehensive synonym mappings for each column type
// Includes variations for different property management systems, locales, and naming conventions
const COLUMN_SYNONYMS: Record<ColumnType, string[]> = {
  date: [
    'date', 'transaction date', 'trans date', 'txn date', 'entry date',
    'posting date', 'post date', 'effective date', 'eff date', 'value date',
    'invoice date', 'bill date', 'statement date', 'activity date',
    'ledger date', 'record date', 'trx date', 'tran date', 'dt',
    // Additional variations
    'doc date', 'document date', 'charge date', 'payment date', 'created date',
    'event date', 'applied date', 'as of date', 'gl date', 'accounting date',
    'book date', 'settle date', 'settlement date', 'transaction dt', 'trans dt'
  ],
  chargeCode: [
    'chg code', 'charge code', 'transaction code', 'trans code', 'txn code',
    'type', 'code', 'category', 'trans type', 'transaction type', 'txn type',
    'charge type', 'entry type', 'item code', 'item type', 'acct code',
    'account code', 'gl code', 'ledger code', 'ref code', 'reference code',
    'activity code', 'activity type', 'chgcode', 'chg', 'tcode', 'trx code',
    // Additional variations
    'billing code', 'bill code', 'fee code', 'fee type', 'service code',
    'category code', 'class', 'classification', 'source code', 'source',
    'reason code', 'reason', 'tran code', 'posting code', 'entry code'
  ],
  description: [
    'description', 'desc', 'details', 'memo', 'notes', 'narrative',
    'particulars', 'remarks', 'comment', 'comments', 'explanation',
    'transaction description', 'trans desc', 'item description', 'item desc',
    'charge description', 'payment description', 'reference', 'ref',
    'activity', 'line item', 'detail', 'descr', 'note',
    // Additional variations
    'text', 'message', 'info', 'information', 'narration', 'summary',
    'transaction detail', 'trans detail', 'item', 'charge detail',
    'payment detail', 'line description', 'line desc', 'entry description'
  ],
  debit: [
    'debit', 'charge', 'charges', 'amount due', 'dr', 'debits',
    'charge amount', 'debit amount', 'amount charged', 'billed',
    'billed amount', 'due', 'amount', 'chg amt', 'charge amt',
    'debit amt', 'dr amt', 'increase', 'additions', 'add',
    // Additional variations
    'amount billed', 'billing amount', 'new charges', 'current charges',
    'fee amount', 'fee', 'fees', 'assessment', 'assessments',
    'receivable', 'debit total', 'charge total', 'bill amount'
  ],
  credit: [
    'credit', 'payment', 'payments', 'credits', 'cr', 'amount paid',
    'credit amount', 'payment amount', 'paid', 'received', 'receipts',
    'pmt', 'pmt amt', 'payment amt', 'credit amt', 'cr amt',
    'decrease', 'deductions', 'ded', 'applied',
    // Additional variations
    'amount received', 'receipt amount', 'collected', 'collection',
    'paid amount', 'payment received', 'cash', 'adjustment', 'adjustments',
    'credit total', 'payment total', 'concession', 'discount'
  ],
  balance: [
    'balance', 'running balance', 'bal', 'account balance', 'acct balance',
    'ending balance', 'end balance', 'current balance', 'curr balance',
    'running total', 'total', 'cumulative', 'net balance', 'net',
    'balance due', 'amount owed', 'outstanding', 'remaining',
    // Additional variations
    'total due', 'total balance', 'ledger balance', 'resident balance',
    'tenant balance', 'owing', 'amount due', 'balance forward', 'closing balance',
    'period balance', 'new balance', 'updated balance', 'final balance'
  ],
  unit: [
    'unit', 'bldg/unit', 'building/unit', 'apt', 'apartment', 'suite',
    'space', 'unit #', 'unit no', 'unit number', 'property', 'location',
    'address', 'bldg', 'building',
    // Additional variations
    'room', 'flat', 'residence', 'dwelling', 'unit id', 'property id',
    'space number', 'apt no', 'apartment number', 'suite no', 'bldg unit'
  ],
  fiscalPeriod: [
    'fiscal period', 'period', 'fiscal', 'accounting period', 'acct period',
    'billing period', 'month', 'year', 'fy', 'fiscal year'
  ],
  reference: [
    'ref', 'reference', 'ref #', 'ref no', 'reference number', 'ref number',
    'transaction #', 'trans #', 'txn #', 'invoice #', 'invoice no',
    'receipt #', 'receipt no', 'check #', 'check no', 'ctrl #', 'control #'
  ],
  unknown: []
};

// Patterns that help identify column types from data values
const VALUE_PATTERNS: Record<ColumnType, RegExp[]> = {
  date: [
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,  // MM/DD/YYYY or M/D/YY
    /^\d{4}-\d{2}-\d{2}$/,           // YYYY-MM-DD
    /^\d{1,2}-\d{1,2}-\d{2,4}$/,     // MM-DD-YYYY
    /^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}$/, // Jan 15, 2024
  ],
  chargeCode: [
    /^[A-Z]{2,10}$/i,                // Short uppercase codes like RENT, LATEFEE
    /^[A-Z]+\d*$/i,                  // Codes with optional numbers
    /^PMT[A-Z]*$/i,                  // Payment codes
  ],
  description: [
    /^[A-Za-z\s]{10,}$/,             // Long text descriptions
    /payment|charge|fee|rent/i,       // Common description words
  ],
  debit: [
    /^\$?-?[\d,]+\.\d{2}$/,          // Money format
    /^\([\d,]+\.\d{2}\)$/,           // Negative in parentheses
  ],
  credit: [
    /^\$?-?[\d,]+\.\d{2}$/,          // Money format
    /^\([\d,]+\.\d{2}\)$/,           // Negative in parentheses
  ],
  balance: [
    /^\$?-?[\d,]+\.\d{2}$/,          // Money format
    /^\([\d,]+\.\d{2}\)$/,           // Negative in parentheses
  ],
  unit: [
    /^\d{1,4}-?\d{0,4}[A-Z]?$/i,     // Unit numbers like 101, 14T, 1769-14T
    /^[A-Z]\d{1,4}$/i,               // A101, B202
  ],
  fiscalPeriod: [
    /^\d{6}$/,                        // MMYYYY or YYYYMM
    /^\d{4}-\d{2}$/,                  // YYYY-MM
  ],
  reference: [
    /^\d{5,}$/,                       // Long numeric references
    /^[A-Z0-9]{6,}$/i,               // Alphanumeric references
  ],
  unknown: []
};

/**
 * Normalize a header name for comparison
 */
function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')  // Replace special chars with space
    .replace(/\s+/g, ' ')          // Normalize multiple spaces
    .trim();
}

/**
 * Calculate similarity between two strings (Levenshtein-based)
 */
function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  
  const len1 = s1.length;
  const len2 = s2.length;
  
  if (len1 === 0 || len2 === 0) return 0;
  
  // Simple word overlap score
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const commonWords = words1.filter(w => words2.includes(w));
  
  return commonWords.length / Math.max(words1.length, words2.length);
}

/**
 * Identify the column type based on header name
 */
export function identifyColumnType(headerName: string): { type: ColumnType; confidence: number } {
  const normalized = normalizeHeader(headerName);
  
  let bestMatch: ColumnType = 'unknown';
  let bestConfidence = 0;
  
  for (const [type, synonyms] of Object.entries(COLUMN_SYNONYMS) as [ColumnType, string[]][]) {
    if (type === 'unknown') continue;
    
    for (const synonym of synonyms) {
      const normalizedSynonym = normalizeHeader(synonym);
      
      // Exact match
      if (normalized === normalizedSynonym) {
        return { type, confidence: 1.0 };
      }
      
      // Contains match
      if (normalized.includes(normalizedSynonym) || normalizedSynonym.includes(normalized)) {
        const confidence = 0.85;
        if (confidence > bestConfidence) {
          bestMatch = type;
          bestConfidence = confidence;
        }
      }
      
      // Similarity match
      const similarity = stringSimilarity(normalized, normalizedSynonym);
      if (similarity > 0.7 && similarity > bestConfidence) {
        bestMatch = type;
        bestConfidence = similarity;
      }
    }
  }
  
  return { type: bestMatch, confidence: bestConfidence };
}

/**
 * Identify column type from sample data values
 */
export function identifyColumnTypeFromData(values: string[]): { type: ColumnType; confidence: number } {
  const validValues = values.filter(v => v && v.trim().length > 0);
  if (validValues.length === 0) return { type: 'unknown', confidence: 0 };
  
  const typeScores: Record<ColumnType, number> = {
    date: 0, chargeCode: 0, description: 0, debit: 0,
    credit: 0, balance: 0, unit: 0, fiscalPeriod: 0,
    reference: 0, unknown: 0
  };
  
  for (const value of validValues) {
    const trimmed = value.trim();
    
    for (const [type, patterns] of Object.entries(VALUE_PATTERNS) as [ColumnType, RegExp[]][]) {
      for (const pattern of patterns) {
        if (pattern.test(trimmed)) {
          typeScores[type]++;
          break;
        }
      }
    }
  }
  
  let bestType: ColumnType = 'unknown';
  let bestScore = 0;
  
  for (const [type, score] of Object.entries(typeScores) as [ColumnType, number][]) {
    if (score > bestScore) {
      bestType = type;
      bestScore = score;
    }
  }
  
  const confidence = validValues.length > 0 ? bestScore / validValues.length : 0;
  return { type: bestType, confidence };
}

/**
 * Analyze headers and create column mappings
 */
export function analyzeHeaders(headers: string[], sampleData?: string[][]): HeaderAnalysis {
  const columns: ColumnMapping[] = [];
  const usedTypes = new Set<ColumnType>();
  
  // First pass: identify columns from header names
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const { type, confidence } = identifyColumnType(header);
    
    columns.push({
      index: i,
      originalName: header,
      normalizedName: normalizeHeader(header),
      type: usedTypes.has(type) ? 'unknown' : type,
      confidence
    });
    
    if (type !== 'unknown' && confidence >= 0.7) {
      usedTypes.add(type);
    }
  }
  
  // Second pass: use sample data to identify unknown columns
  if (sampleData && sampleData.length > 0) {
    for (const col of columns) {
      if (col.type === 'unknown' || col.confidence < 0.5) {
        const colValues = sampleData.map(row => row[col.index] || '');
        const dataType = identifyColumnTypeFromData(colValues);
        
        if (dataType.type !== 'unknown' && dataType.confidence > col.confidence) {
          if (!usedTypes.has(dataType.type)) {
            col.type = dataType.type;
            col.confidence = dataType.confidence;
            usedTypes.add(dataType.type);
          }
        }
      }
    }
  }
  
  // Third pass: resolve conflicts and apply heuristics
  resolveColumnConflicts(columns);
  
  // Determine format
  const format = determineFormat(columns, headers);
  
  // Check for required columns
  const requiredColumns: ColumnType[] = ['date', 'balance'];
  const missingColumns = requiredColumns.filter(
    type => !columns.some(c => c.type === type && c.confidence >= 0.5)
  );
  
  return {
    columns,
    format,
    hasAllRequired: missingColumns.length === 0,
    missingColumns
  };
}

/**
 * Resolve conflicts when multiple columns map to the same type
 */
function resolveColumnConflicts(columns: ColumnMapping[]): void {
  const typeGroups = new Map<ColumnType, ColumnMapping[]>();
  
  for (const col of columns) {
    if (col.type === 'unknown') continue;
    
    if (!typeGroups.has(col.type)) {
      typeGroups.set(col.type, []);
    }
    typeGroups.get(col.type)!.push(col);
  }
  
  for (const [type, cols] of typeGroups) {
    if (cols.length <= 1) continue;
    
    // Keep the one with highest confidence, mark others as unknown
    cols.sort((a, b) => b.confidence - a.confidence);
    for (let i = 1; i < cols.length; i++) {
      cols[i].type = 'unknown';
      cols[i].confidence = 0;
    }
  }
  
  // Special handling: if we have debit but no credit (or vice versa), 
  // check if there's a generic "amount" column that could be the other
  const hasDebit = columns.some(c => c.type === 'debit');
  const hasCredit = columns.some(c => c.type === 'credit');
  
  if (hasDebit && !hasCredit) {
    // Look for unknown column that might be credit
    for (const col of columns) {
      if (col.type === 'unknown' && /payment|credit|cr|paid/i.test(col.originalName)) {
        col.type = 'credit';
        col.confidence = 0.7;
        break;
      }
    }
  }
  
  if (hasCredit && !hasDebit) {
    // Look for unknown column that might be debit
    for (const col of columns) {
      if (col.type === 'unknown' && /charge|debit|dr|due|amount/i.test(col.originalName)) {
        col.type = 'debit';
        col.confidence = 0.7;
        break;
      }
    }
  }
}

/**
 * Determine the ledger format based on column analysis
 */
function determineFormat(columns: ColumnMapping[], headers: string[]): HeaderAnalysis['format'] {
  const headerStr = headers.join(' ').toLowerCase();
  
  // Bldg/Unit format detection
  if (headerStr.includes('bldg') || headerStr.includes('unit') || 
      columns.some(c => c.type === 'unit')) {
    return 'bldgUnit';
  }
  
  // Tenant Ledger format
  if (headerStr.includes('tenant ledger') || headerStr.includes('tenant statement')) {
    return 'tenantLedger';
  }
  
  // Standard Resident Ledger
  if (headerStr.includes('resident') || headerStr.includes('ledger')) {
    return 'standard';
  }
  
  return 'custom';
}

/**
 * Get column index by type from analysis
 */
export function getColumnIndex(analysis: HeaderAnalysis, type: ColumnType): number {
  const col = analysis.columns.find(c => c.type === type && c.confidence >= 0.5);
  return col ? col.index : -1;
}

/**
 * Extract value from row by column type
 */
export function getValueByType(
  row: string[], 
  analysis: HeaderAnalysis, 
  type: ColumnType, 
  defaultValue: string = ''
): string {
  const index = getColumnIndex(analysis, type);
  return index >= 0 && index < row.length ? row[index] : defaultValue;
}

/**
 * Smart header detection from raw text lines
 * Identifies the header row from a list of text lines
 */
export function detectHeaderRow(lines: string[]): { headerIndex: number; headers: string[] } | null {
  const headerKeywords = [
    'date', 'description', 'debit', 'credit', 'balance', 'charge', 'payment',
    'amount', 'code', 'type', 'memo', 'reference'
  ];
  
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i].toLowerCase();
    let matchCount = 0;
    
    for (const keyword of headerKeywords) {
      if (line.includes(keyword)) {
        matchCount++;
      }
    }
    
    // If we find at least 3 header keywords, this is likely the header row
    if (matchCount >= 3) {
      // Parse the header - handle various delimiters
      const headers = parseHeaderLine(lines[i]);
      if (headers.length >= 3) {
        return { headerIndex: i, headers };
      }
    }
  }
  
  return null;
}

/**
 * Parse a header line into individual column names
 */
function parseHeaderLine(line: string): string[] {
  // Try tab-separated first
  let headers = line.split('\t').map(h => h.trim()).filter(Boolean);
  if (headers.length >= 3) return headers;
  
  // Try multiple spaces (fixed-width format)
  headers = line.split(/\s{2,}/).map(h => h.trim()).filter(Boolean);
  if (headers.length >= 3) return headers;
  
  // Try comma-separated
  headers = line.split(',').map(h => h.trim()).filter(Boolean);
  if (headers.length >= 3) return headers;
  
  // Try pipe-separated
  headers = line.split('|').map(h => h.trim()).filter(Boolean);
  if (headers.length >= 3) return headers;
  
  // Fallback: intelligent word grouping
  return intelligentHeaderParse(line);
}

/**
 * Intelligently parse headers when no clear delimiter exists
 */
function intelligentHeaderParse(line: string): string[] {
  const headers: string[] = [];
  const knownHeaders = [
    'Date', 'Transaction Date', 'Trans Date', 'Bldg/Unit', 'Building/Unit',
    'Fiscal Period', 'Period', 'Transaction Code', 'Chg Code', 'Charge Code',
    'Description', 'Desc', 'Details', 'Charge', 'Charges', 'Debit', 'Dr',
    'Credit', 'Credits', 'Payment', 'Cr', 'Balance', 'Bal', 'Running Balance',
    'Reference', 'Ref', 'Unit', 'Memo', 'Notes'
  ];
  
  let remaining = line;
  
  // Sort by length (longest first) to match multi-word headers first
  const sortedHeaders = [...knownHeaders].sort((a, b) => b.length - a.length);
  
  for (const header of sortedHeaders) {
    const regex = new RegExp(`\\b${header}\\b`, 'i');
    const match = remaining.match(regex);
    if (match) {
      headers.push(match[0]);
      remaining = remaining.replace(regex, '|||');
    }
  }
  
  return headers;
}

/**
 * Create a dynamic parser configuration based on header analysis
 */
export interface ParserConfig {
  dateIndex: number;
  chargeCodeIndex: number;
  descriptionIndex: number;
  debitIndex: number;
  creditIndex: number;
  balanceIndex: number;
  unitIndex: number;
  format: HeaderAnalysis['format'];
  columnCount: number;
}

export function createParserConfig(analysis: HeaderAnalysis): ParserConfig {
  return {
    dateIndex: getColumnIndex(analysis, 'date'),
    chargeCodeIndex: getColumnIndex(analysis, 'chargeCode'),
    descriptionIndex: getColumnIndex(analysis, 'description'),
    debitIndex: getColumnIndex(analysis, 'debit'),
    creditIndex: getColumnIndex(analysis, 'credit'),
    balanceIndex: getColumnIndex(analysis, 'balance'),
    unitIndex: getColumnIndex(analysis, 'unit'),
    format: analysis.format,
    columnCount: analysis.columns.length
  };
}

/**
 * Log column mapping for debugging
 */
export function logColumnMapping(analysis: HeaderAnalysis): void {
  console.log('📊 Column Mapping Analysis:');
  console.log('  Format:', analysis.format);
  console.log('  Has All Required:', analysis.hasAllRequired);
  if (analysis.missingColumns.length > 0) {
    console.log('  Missing Columns:', analysis.missingColumns.join(', '));
  }
  console.log('  Column Mappings:');
  for (const col of analysis.columns) {
    const status = col.confidence >= 0.7 ? '✓' : col.confidence >= 0.5 ? '~' : '?';
    console.log(`    ${status} [${col.index}] "${col.originalName}" → ${col.type} (${(col.confidence * 100).toFixed(0)}%)`);
  }
}
