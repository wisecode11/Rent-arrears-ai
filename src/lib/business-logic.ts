import { HuggingFaceResponse, ProcessedData, LedgerEntry } from '@/types';
import { classifyDescription } from '@/lib/ledger-parser';

/**
 * Apply core business logic for rental arrears calculation
 * Implements 4-step calculation rules:
 * 1. Find the last zero or negative balance
 * 2. Add up non-rent charges from that point onward
 * 3. Identify the correct latest balance (based on date)
 * 4. Calculate rent arrears = latest balance - total non-rent charges
 */
function pickLatestBalanceByDateRule(
  ledgerEntries: LedgerEntry[],
  asOfDate: Date
): number {
  if (!ledgerEntries.length) return 0;

  // Sort newest first
  const sorted = [...ledgerEntries].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const day = asOfDate.getDate();
  const month = asOfDate.getMonth();
  const year = asOfDate.getFullYear();

  const targetMonth =
    day >= 1 && day <= 5 ? (month === 0 ? 11 : month - 1) : month;
  const targetYear =
    day >= 1 && day <= 5 && month === 0 ? year - 1 : year;

  // Find latest entry within the target month/year
  const inTarget = sorted.find((entry) => {
    const d = new Date(entry.date);
    return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
  });
  if (inTarget) return inTarget.balance;

  // Fallbacks:
  // - If we're 1st-5th and there's no entry in the previous month, use the latest entry before current month.
  if (day >= 1 && day <= 5) {
    const beforeCurrentMonth = sorted.find((entry) => {
      const d = new Date(entry.date);
      return d.getFullYear() < year || (d.getFullYear() === year && d.getMonth() < month);
    });
    if (beforeCurrentMonth) return beforeCurrentMonth.balance;
  }

  // Otherwise, just use the most recent known balance.
  return sorted[0].balance;
}

export function calculateFinalAmount(aiData: HuggingFaceResponse, asOfDate: Date = new Date()): ProcessedData {
  // Calculate total non-rental charges (ALL charges from beginning to end)
  // Example: If there are charges from 2019 to 2025, this sums ALL of them
  // This is the $8,675.00 shown as "Total non-rental charges"
  const totalNonRental = aiData.nonRentalCharges.reduce(
    (sum, charge) => sum + Math.abs(charge.amount), 
    0
  );
  
  // Step 1: Find the last zero or negative balance
  // This finds the most recent date when balance was $0.00 or negative
  // Example: "Last zero/negative balance: 04/06/2024"
  let lastZeroOrNegativeBalanceDate: string | undefined;
  let lastZeroOrNegativeBalance: number | undefined;
  let lastZeroOrNegativeIndex: number | undefined;
  
  if (aiData.ledgerEntries && aiData.ledgerEntries.length > 0) {
    // Sort entries by date (oldest first)
    const sortedEntries = [...aiData.ledgerEntries].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    // Find the most recent entry with zero or negative balance
    for (let i = sortedEntries.length - 1; i >= 0; i--) {
      if (sortedEntries[i].balance <= 0) {
        lastZeroOrNegativeBalanceDate = sortedEntries[i].date;
        lastZeroOrNegativeBalance = sortedEntries[i].balance;
        lastZeroOrNegativeIndex = i;
        break;
      }
    }
  }
  
  // Step 2: Add up non-rent charges from the last zero/negative balance point onward
  // IMPORTANT FORMULA DIFFERENCE:
  // - totalNonRental = ALL non-rental charges (e.g., $8,675.00)
  // - totalNonRentalFromLastZero = ONLY charges AFTER last zero/negative date (e.g., $975.00)
  // Example: If last zero was 04/06/2024, this only counts charges from 04/07/2024 onwards
  let totalNonRentalFromLastZero = 0;
  
  if (lastZeroOrNegativeBalanceDate) {
    // Calculate from nonRentalCharges array (consistent with displayed list)
    // Filter charges that are AFTER the last zero/negative balance date
    const lastZeroDate = new Date(lastZeroOrNegativeBalanceDate);
    
    totalNonRentalFromLastZero = aiData.nonRentalCharges
      .filter(charge => {
        if (!charge.date) return false;
        const chargeDate = new Date(charge.date);
        // Include charges on the same day or after the last zero date
        // Use > instead of >= to exclude the exact day of zero balance
        return chargeDate > lastZeroDate;
      })
      .reduce((sum, charge) => sum + Math.abs(charge.amount), 0);
    
    console.log('📊 Non-rental charges calculation:', {
      lastZeroDate: lastZeroOrNegativeBalanceDate,
      totalNonRentalCharges: aiData.nonRentalCharges.length,
      chargesAfterLastZero: aiData.nonRentalCharges.filter(c => {
        if (!c.date) return false;
        return new Date(c.date) > new Date(lastZeroOrNegativeBalanceDate);
      }).length,
      totalNonRentalFromLastZero
    });
  } else if (typeof lastZeroOrNegativeIndex === 'number' && aiData.ledgerEntries) {
    // Fallback: If no last zero date but we have ledger entries, use ledger entries
    const sortedEntries = [...aiData.ledgerEntries].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Count only entries AFTER the last <= 0 balance row.
    for (let i = lastZeroOrNegativeIndex + 1; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i];
      const debit = entry.debit ?? 0;
      if (debit <= 0) continue;

      // Payments/credits should not be counted here.
      const cls = classifyDescription(entry.description);
      if (cls.isPayment) continue;

      // Only exclude clear rent charges; everything else counts toward non-rent.
      if (cls.isRentalCharge) continue;

      totalNonRentalFromLastZero += Math.abs(debit);
    }
  } else {
    // Fallback: if no ledger entries or last zero date, use all non-rental charges
    totalNonRentalFromLastZero = totalNonRental;
  }
  
  // Step 3: Identify the correct latest balance based on today's date
  // IMPORTANT: Follow the date rule (1st-5th => previous month; 6th+ => current month)
  // Prefer ledgerEntries for this since they contain dated running balances.
  let latestBalance = 0;
  
  console.log('💰 Balance extraction - Input data:', {
    finalBalance: aiData.finalBalance,
    openingBalance: aiData.openingBalance,
    ledgerEntriesCount: aiData.ledgerEntries?.length || 0
  });
  
  if (aiData.ledgerEntries && aiData.ledgerEntries.length > 0) {
    latestBalance = pickLatestBalanceByDateRule(aiData.ledgerEntries, asOfDate);
    console.log('✅ Picked latest balance from ledger entries (date rule applied):', latestBalance);
  } else {
    // If no ledger entries, we can't apply the month rule reliably; use finalBalance if present, else openingBalance.
    if (typeof aiData.finalBalance === 'number' && !isNaN(aiData.finalBalance)) {
      latestBalance = aiData.finalBalance;
      console.log('⚠️ No ledger entries; using finalBalance as latestBalance fallback:', latestBalance);
    } else {
      latestBalance = aiData.openingBalance || 0;
      console.log('⚠️ No ledger entries; using openingBalance as latestBalance fallback:', latestBalance);
    }
  }
  
  // Step 4: Calculate rent arrears
  // Rent Arrears = Latest Balance - Total Non-Rent Charges (from last zero/negative point)
  const rentArrears = latestBalance - totalNonRentalFromLastZero;
  
  // Legacy calculation for backward compatibility
  const finalRentalAmount = aiData.openingBalance - totalNonRental;
  
  // FINAL: Always use the calculated latestBalance (which prioritizes finalBalance)
  const finalLatestBalance = latestBalance;
  
  const finalTotalNonRentalFromLastZero = totalNonRentalFromLastZero > 0 
    ? totalNonRentalFromLastZero 
    : totalNonRental;
  
  return {
    tenantName: aiData.tenantName,
    propertyName: aiData.propertyName,
    period: aiData.period,
    openingBalance: aiData.openingBalance,
    rentalCharges: aiData.rentalCharges,
    nonRentalCharges: aiData.nonRentalCharges,
    totalNonRental,
    finalRentalAmount,
    // New fields
    ledgerEntries: aiData.ledgerEntries,
    lastZeroOrNegativeBalanceDate,
    latestBalance: finalLatestBalance,
    totalNonRentalFromLastZero: finalTotalNonRentalFromLastZero,
    rentArrears: finalLatestBalance - finalTotalNonRentalFromLastZero,
  };
}

/**
 * Validate processed data for completeness and accuracy
 */
export function validateProcessedData(data: ProcessedData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data.tenantName?.trim()) {
    errors.push('Tenant name is required');
  }
  
  if (!data.propertyName?.trim()) {
    errors.push('Property name is required');
  }
  
  if (!data.period?.trim()) {
    errors.push('Period is required');
  }
  
  if (typeof data.openingBalance !== 'number') {
    errors.push('Opening balance must be a number');
  }
  
  if (!Array.isArray(data.rentalCharges)) {
    errors.push('Rental charges must be an array');
  }
  
  if (!Array.isArray(data.nonRentalCharges)) {
    errors.push('Non-rental charges must be an array');
  }
  
  // Validate charge amounts
  data.rentalCharges.forEach((charge, index) => {
    if (typeof charge.amount !== 'number' || charge.amount < 0) {
      errors.push(`Rental charge ${index + 1} has invalid amount`);
    }
    if (!charge.description?.trim()) {
      errors.push(`Rental charge ${index + 1} missing description`);
    }
  });
  
  data.nonRentalCharges.forEach((charge, index) => {
    if (typeof charge.amount !== 'number' || charge.amount < 0) {
      errors.push(`Non-rental charge ${index + 1} has invalid amount`);
    }
    if (!charge.description?.trim()) {
      errors.push(`Non-rental charge ${index + 1} missing description`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
}