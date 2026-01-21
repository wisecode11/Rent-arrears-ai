// Core data types for rental arrears processing

export interface RentalCharge {
  description: string;
  amount: number;
  date?: string;
}

export interface NonRentalCharge {
  description: string;
  amount: number;
  date?: string;
  category?: string; // e.g., 'maintenance', 'legal', 'insurance'
}

export interface LedgerEntry {
  date: string; // YYYY-MM-DD format
  description: string;
  debit?: number; // Amount charged
  credit?: number; // Amount paid
  balance: number; // Running balance after this entry
  isRental?: boolean; // true if rental charge, false if non-rental
}

export interface CalculationTraceNonRentItem {
  date: string;
  description: string;
  amount: number;
  category?: string;
  ledgerIndex?: number;
}

export interface CalculationTrace {
  asOfDateISO: string; // effective as-of date used for Step 3 (issue date when available; otherwise system date)
  systemAsOfDateISO?: string; // the actual runtime date passed in (usually "today")
  issueDateISO?: string; // extracted from ledger header when available
  step1: {
    lastZeroOrNegative?: {
      date: string;
      balance: number;
      ledgerIndex: number;
      description?: string;
    };
    note?: string;
  };
  step2: {
    method: 'ledger-order' | 'date-only' | 'all-nonrental-fallback';
    includedItemsCount: number;
    includedItems: CalculationTraceNonRentItem[];
    totalNonRent: number;
    note?: string;
  };
  step3: {
    rule: 'prev-month-if-day-1-5' | 'current-month-if-day-6+';
    targetMonthISO: string; // YYYY-MM
    selectedEntry?: {
      date: string;
      balance: number;
      description?: string;
    };
    latestBalance: number;
    note?: string;
  };
  step4: {
    rentArrears: number;
    formulaHuman: string;
  };
}

export interface ProcessedData {
  tenantName: string;
  propertyName: string;
  period: string;
  openingBalance: number;
  rentalCharges: RentalCharge[];
  nonRentalCharges: NonRentalCharge[];
  totalNonRental: number;
  finalRentalAmount: number;
  // New fields for rent arrears calculation
  ledgerEntries?: LedgerEntry[];
  lastZeroOrNegativeBalanceDate?: string;
  latestBalance: number;
  totalNonRentalFromLastZero: number;
  rentArrears: number;
  extractedText?: string;
  calculationTrace?: CalculationTrace;
  issueDate?: string; // YYYY-MM-DD, extracted from ledger header when available
}

export interface APIResponse {
  success: boolean;
  data?: ProcessedData;
  error?: string;
  extractedText?: string;
}

export interface HuggingFaceResponse {
  tenantName: string;
  propertyName: string;
  period: string;
  openingBalance: number;
  finalBalance?: number;
  rentalCharges: RentalCharge[];
  nonRentalCharges: NonRentalCharge[];
  ledgerEntries?: LedgerEntry[];
  issueDate?: string; // YYYY-MM-DD, extracted from ledger header when available
}