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
  // Extracted text from PDF for Excel report
  extractedText?: string;
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
  finalBalance?: number; // Latest/final balance from the document
  rentalCharges: RentalCharge[];
  nonRentalCharges: NonRentalCharge[];
  ledgerEntries?: LedgerEntry[]; // Optional: full ledger if available
}