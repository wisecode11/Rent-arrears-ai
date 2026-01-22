import * as XLSX from 'xlsx';
import { HuggingFaceResponse, LedgerEntry } from '@/types';
import { chargesFromLedgerEntries, classifyDescription, parseFlexibleDate, parseMoney } from '@/lib/ledger-parser';

const HEADER_SYNONYMS: Record<string, string[]> = {
  date: ['date', 'trans date', 'transaction date', 'posting date', 'posted', 'post date'],
  description: ['description', 'details', 'memo', 'narrative', 'item', 'type', 'charge description', 'transaction'],
  debit: ['debit', 'charge', 'charges', 'billed', 'bill', 'amount billed', 'amount', 'debits'],
  credit: ['credit', 'payment', 'payments', 'paid', 'amount paid', 'credits'],
  balance: ['balance', 'balance due', 'running balance', 'current balance', 'amount due', 'ending balance'],
};

function normalizeCell(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof value === 'number') {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts && parts.y && parts.m && parts.d) {
      const yyyy = String(parts.y).padStart(4, '0');
      const mm = String(parts.m).padStart(2, '0');
      const dd = String(parts.d).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  const asString = normalizeCell(value);
  return parseFlexibleDate(asString);
}

function findHeaderRow(rows: unknown[][], maxScan = 25): number {
  let bestRow = 0;
  let bestScore = -1;

  for (let r = 0; r < Math.min(maxScan, rows.length); r++) {
    const row = rows[r] || [];
    const cells = row.map(normalizeCell).filter(Boolean);
    if (cells.length < 2) continue;

    let score = 0;
    for (const cell of cells) {
      for (const synonyms of Object.values(HEADER_SYNONYMS)) {
        if (synonyms.some((s) => cell === s || cell.includes(s))) {
          score += 1;
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  return bestRow;
}

function mapColumns(header: unknown[]): {
  date?: number;
  description?: number;
  debit?: number;
  credit?: number;
  balance?: number;
  amount?: number;
} {
  const mapped: Record<string, number | undefined> = {};
  const normalized = header.map(normalizeCell);

  const findCol = (keys: string[]) => {
    for (let i = 0; i < normalized.length; i++) {
      const cell = normalized[i];
      if (!cell) continue;
      if (keys.some((k) => cell === k || cell.includes(k))) return i;
    }
    return undefined;
  };

  mapped.date = findCol(HEADER_SYNONYMS.date);
  mapped.description = findCol(HEADER_SYNONYMS.description);
  mapped.debit = findCol(HEADER_SYNONYMS.debit.filter((s) => s !== 'amount'));
  mapped.credit = findCol(HEADER_SYNONYMS.credit);
  mapped.balance = findCol(HEADER_SYNONYMS.balance);
  mapped.amount = findCol(['amount']);

  return mapped;
}

function guessLedgerSheet(workbook: XLSX.WorkBook): { sheetName: string; rows: unknown[][] } {
  let best: { sheetName: string; rows: unknown[][]; score: number } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][];
    if (!rows.length) continue;

    const headerRowIndex = findHeaderRow(rows);
    const header = rows[headerRowIndex] || [];
    const cols = mapColumns(header);

    const score =
      (cols.date !== undefined ? 2 : 0) +
      (cols.description !== undefined ? 2 : 0) +
      (cols.balance !== undefined ? 2 : 0) +
      (cols.debit !== undefined ? 1 : 0) +
      (cols.credit !== undefined ? 1 : 0) +
      (cols.amount !== undefined ? 1 : 0);

    if (!best || score > best.score) {
      best = { sheetName, rows, score };
    }
  }

  if (best) return { sheetName: best.sheetName, rows: best.rows };

  // Fallback to first sheet.
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return {
    sheetName,
    rows: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }) as unknown[][],
  };
}

function findOpeningBalanceFromRows(rows: unknown[][], maxScan = 25): number | null {
  for (let r = 0; r < Math.min(maxScan, rows.length); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = normalizeCell(row[c]);
      if (!cell) continue;
      if (cell.includes('opening balance') || cell.includes('beginning balance') || cell.includes('year starting balance')) {
        // Try same row next cells
        for (let k = 1; k <= 3; k++) {
          const candidate = row[c + k];
          const parsed = typeof candidate === 'number' ? candidate : parseMoney(String(candidate ?? ''));
          if (typeof parsed === 'number' && !Number.isNaN(parsed)) return parsed;
        }
      }
    }
  }
  return null;
}

export function analyzeSpreadsheet(buffer: Buffer): HuggingFaceResponse {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const { rows } = guessLedgerSheet(workbook);

  const headerRowIndex = findHeaderRow(rows);
  const header = rows[headerRowIndex] || [];
  const cols = mapColumns(header);

  const openingBalanceFromHeader = findOpeningBalanceFromRows(rows);

  const ledgerEntries: LedgerEntry[] = [];
  let running = openingBalanceFromHeader ?? 0;
  let hasAnyBalance = false;

  // Parse rows after the header
  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dateVal = cols.date !== undefined ? row[cols.date] : undefined;
    const date = parseExcelDate(dateVal);
    if (!date) continue;

    const descriptionVal =
      cols.description !== undefined ? row[cols.description] : '';
    const description = String(descriptionVal ?? '').toString().trim() || 'Unknown';

    const rawDebit = cols.debit !== undefined ? row[cols.debit] : undefined;
    const rawCredit = cols.credit !== undefined ? row[cols.credit] : undefined;
    const rawAmount = cols.amount !== undefined ? row[cols.amount] : undefined;
    const rawBalance = cols.balance !== undefined ? row[cols.balance] : undefined;

    const debitParsed =
      typeof rawDebit === 'number'
        ? rawDebit
        : parseMoney(String(rawDebit ?? '')) ?? 0;
    const creditParsed =
      typeof rawCredit === 'number'
        ? rawCredit
        : parseMoney(String(rawCredit ?? '')) ?? 0;
    const amountParsed =
      typeof rawAmount === 'number'
        ? rawAmount
        : parseMoney(String(rawAmount ?? '')) ?? 0;

    let debit = 0;
    let credit = 0;

    // Prefer explicit debit/credit columns; otherwise use amount with sign/keywords.
    if ((debitParsed ?? 0) !== 0 || (creditParsed ?? 0) !== 0) {
      debit = Math.max(0, debitParsed ?? 0);
      credit = Math.max(0, creditParsed ?? 0);
    } else if ((amountParsed ?? 0) !== 0) {
      const cls = classifyDescription(description);
      if (cls.isPayment || amountParsed < 0) credit = Math.abs(amountParsed);
      else debit = Math.abs(amountParsed);
    }

    let balance = 0;
    const balanceParsed =
      typeof rawBalance === 'number'
        ? rawBalance
        : parseMoney(String(rawBalance ?? ''));
    if (typeof balanceParsed === 'number' && !Number.isNaN(balanceParsed)) {
      hasAnyBalance = true;
      balance = balanceParsed;
    } else {
      // If balance isn't provided, compute a running estimate.
      running = running + debit - credit;
      balance = running;
    }

    const cls = classifyDescription(description);
    ledgerEntries.push({
      date,
      description,
      debit: debit > 0 ? debit : 0,
      credit: credit > 0 ? credit : 0,
      balance,
      isRental: cls.isRentalCharge ? true : cls.isNonRentalCharge ? false : undefined,
    });
  }

  // Sort by date ascending.
  ledgerEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const { rentalCharges, nonRentalCharges } = chargesFromLedgerEntries(ledgerEntries);

  const openingBalance = openingBalanceFromHeader ?? (ledgerEntries[0]?.balance ?? 0);
  const finalBalance = ledgerEntries.length ? ledgerEntries[ledgerEntries.length - 1].balance : openingBalance;
  const period =
    ledgerEntries.length > 0
      ? `${ledgerEntries[0].date} to ${ledgerEntries[ledgerEntries.length - 1].date}`
      : 'Extracted Period';

  return {
    tenantName: 'Unknown Tenant',
    propertyName: 'Unknown Property',
    period,
    openingBalance: openingBalance || 0,
    finalBalance: hasAnyBalance ? finalBalance : finalBalance,
    rentalCharges,
    nonRentalCharges,
    ledgerEntries,
  };
}













