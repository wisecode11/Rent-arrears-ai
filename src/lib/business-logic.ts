import { HuggingFaceResponse, ProcessedData, LedgerEntry, CalculationTrace, CalculationTraceNonRentItem } from '@/types';
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

function pickLatestBalanceEntryByDateRule(
  ledgerEntries: LedgerEntry[],
  asOfDate: Date
): { rule: CalculationTrace['step3']['rule']; targetMonthISO: string; selected?: LedgerEntry; note?: string } {
  if (!ledgerEntries.length) {
    const monthISO = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, '0')}`;
    return {
      rule: asOfDate.getDate() >= 1 && asOfDate.getDate() <= 5 ? 'prev-month-if-day-1-5' : 'current-month-if-day-6+',
      targetMonthISO: monthISO,
      selected: undefined,
      note: 'No ledger entries available.',
    };
  }

  const day = asOfDate.getDate();
  const month = asOfDate.getMonth();
  const year = asOfDate.getFullYear();
  const usePrevMonth = day >= 1 && day <= 5;

  const targetMonth = usePrevMonth ? (month === 0 ? 11 : month - 1) : month;
  const targetYear = usePrevMonth && month === 0 ? year - 1 : year;
  const targetMonthISO = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;

  const sortedNewest = [...ledgerEntries].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const inTarget = sortedNewest.find((entry) => {
    const d = new Date(entry.date);
    return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
  });
  if (inTarget) {
    return {
      rule: usePrevMonth ? 'prev-month-if-day-1-5' : 'current-month-if-day-6+',
      targetMonthISO,
      selected: inTarget,
    };
  }

  if (usePrevMonth) {
    const beforeCurrentMonth = sortedNewest.find((entry) => {
      const d = new Date(entry.date);
      return d.getFullYear() < year || (d.getFullYear() === year && d.getMonth() < month);
    });
    return {
      rule: 'prev-month-if-day-1-5',
      targetMonthISO,
      selected: beforeCurrentMonth ?? sortedNewest[0],
      note: 'No entry found in target month; used latest entry before current month.',
    };
  }

  return {
    rule: 'current-month-if-day-6+',
    targetMonthISO,
    selected: sortedNewest[0],
    note: 'No entry found in target month; used most recent known balance.',
  };
}

export function calculateFinalAmount(aiData: HuggingFaceResponse, asOfDate: Date = new Date()): ProcessedData {
  // Calculate total non-rental charges (ALL charges from beginning to end)
  // Example: If there are charges from 2019 to 2025, this sums ALL of them
  // This is the $8,675.00 shown as "Total non-rental charges"
  const totalNonRental = aiData.nonRentalCharges.reduce(
    (sum, charge) => sum + Math.abs(charge.amount), 
    0
  );

  // Stable ledger ordering for "from that point onward" logic
  const sortedLedgerEntries =
    aiData.ledgerEntries && aiData.ledgerEntries.length > 0
      ? [...aiData.ledgerEntries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      : undefined;
  
  // Step 1: Find the last zero or negative balance
  // This finds the most recent date when balance was $0.00 or negative
  // Example: "Last zero/negative balance: 04/06/2024"
  let lastZeroOrNegativeBalanceDate: string | undefined;
  let lastZeroOrNegativeBalance: number | undefined;
  let lastZeroOrNegativeIndex: number | undefined;
  
  if (sortedLedgerEntries && sortedLedgerEntries.length > 0) {
    // Find the most recent entry with zero or negative balance
    for (let i = sortedLedgerEntries.length - 1; i >= 0; i--) {
      if (sortedLedgerEntries[i].balance <= 0) {
        lastZeroOrNegativeBalanceDate = sortedLedgerEntries[i].date;
        lastZeroOrNegativeBalance = sortedLedgerEntries[i].balance;
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
  let nonRentMethod: CalculationTrace['step2']['method'] = 'all-nonrental-fallback';
  let nonRentItems: CalculationTraceNonRentItem[] = [];
  let nonRentNote: string | undefined;
  
  // Preferred: ledger-order calculation (matches "from that point onward" even within the same date)
  if (typeof lastZeroOrNegativeIndex === 'number' && sortedLedgerEntries && sortedLedgerEntries.length > 0) {
    nonRentMethod = 'ledger-order';
    // Count only entries AFTER the last <= 0 balance row.
    for (let i = lastZeroOrNegativeIndex + 1; i < sortedLedgerEntries.length; i++) {
      const entry = sortedLedgerEntries[i];
      const debit = entry.debit ?? 0;
      if (debit <= 0) continue;

      // Payments/credits should not be counted here.
      const cls = classifyDescription(entry.description);
      const isPaymentLike = cls.isPayment || (entry.credit ?? 0) > 0;
      if (isPaymentLike) continue;

      // Only exclude clear rent charges; everything else counts toward non-rent.
      const isRentLike = entry.isRental === true || cls.isRentalCharge;
      if (isRentLike) continue;

      totalNonRentalFromLastZero += Math.abs(debit);
      nonRentItems.push({
        date: entry.date,
        description: entry.description,
        amount: Math.abs(debit),
        category: cls.category && cls.category !== 'rent' ? cls.category : undefined,
        ledgerIndex: i,
      });
    }
  } else if (lastZeroOrNegativeBalanceDate) {
    // Backup: date-only filter (inclusive)
    nonRentMethod = 'date-only';
    nonRentNote = 'Ledger ordering unavailable; used date-only filter (inclusive).';
    const lastZeroDate = new Date(lastZeroOrNegativeBalanceDate);
    const included = aiData.nonRentalCharges.filter((c) => c.date && new Date(c.date) >= lastZeroDate);
    totalNonRentalFromLastZero = included.reduce((sum, c) => sum + Math.abs(c.amount), 0);
    nonRentItems = included.map((c) => ({
      date: c.date ?? lastZeroOrNegativeBalanceDate,
      description: c.description,
      amount: Math.abs(c.amount),
      category: c.category,
    }));
  } else {
    // Fallback: if no ledger entries or last zero date, use all non-rental charges
    nonRentMethod = 'all-nonrental-fallback';
    nonRentNote = 'No ledger entries / no last-zero date; using all non-rental charges.';
    totalNonRentalFromLastZero = totalNonRental;
    nonRentItems = aiData.nonRentalCharges.map((c) => ({
      date: c.date ?? '',
      description: c.description,
      amount: Math.abs(c.amount),
      category: c.category,
    }));
  }
  
  // Step 3: Identify the correct latest balance based on today's date
  // IMPORTANT: Follow the date rule (1st-5th => previous month; 6th+ => current month)
  // Prefer ledgerEntries for this since they contain dated running balances.
  let latestBalance = 0;
  let step3Rule: CalculationTrace['step3']['rule'] =
    asOfDate.getDate() >= 1 && asOfDate.getDate() <= 5 ? 'prev-month-if-day-1-5' : 'current-month-if-day-6+';
  let step3TargetMonthISO = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, '0')}`;
  let step3SelectedEntry: CalculationTrace['step3']['selectedEntry'] | undefined;
  let step3Note: string | undefined;
  
  console.log('💰 Balance extraction - Input data:', {
    finalBalance: aiData.finalBalance,
    openingBalance: aiData.openingBalance,
    ledgerEntriesCount: aiData.ledgerEntries?.length || 0
  });
  
  if (sortedLedgerEntries && sortedLedgerEntries.length > 0) {
    const picked = pickLatestBalanceEntryByDateRule(sortedLedgerEntries, asOfDate);
    step3Rule = picked.rule;
    step3TargetMonthISO = picked.targetMonthISO;
    step3Note = picked.note;
    if (picked.selected) {
      step3SelectedEntry = {
        date: picked.selected.date,
        balance: picked.selected.balance,
        description: picked.selected.description,
      };
      latestBalance = picked.selected.balance;
    } else {
      latestBalance = pickLatestBalanceByDateRule(sortedLedgerEntries, asOfDate);
    }
    console.log('✅ Picked latest balance from ledger entries (date rule applied):', latestBalance);
  } else {
    // If no ledger entries, we can't apply the month rule reliably; use finalBalance if present, else openingBalance.
    if (typeof aiData.finalBalance === 'number' && !isNaN(aiData.finalBalance)) {
      latestBalance = aiData.finalBalance;
      step3Note = 'No ledger entries; using finalBalance as latest balance.';
      console.log('⚠️ No ledger entries; using finalBalance as latestBalance fallback:', latestBalance);
    } else {
      latestBalance = aiData.openingBalance || 0;
      step3Note = 'No ledger entries and no finalBalance; using openingBalance as latest balance.';
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

  const calculationTrace: CalculationTrace = {
    asOfDateISO: asOfDate.toISOString().split('T')[0],
    step1: {
      lastZeroOrNegative:
        typeof lastZeroOrNegativeIndex === 'number' && sortedLedgerEntries
          ? {
              date: lastZeroOrNegativeBalanceDate ?? sortedLedgerEntries[lastZeroOrNegativeIndex]?.date,
              balance: lastZeroOrNegativeBalance ?? sortedLedgerEntries[lastZeroOrNegativeIndex]?.balance ?? 0,
              ledgerIndex: lastZeroOrNegativeIndex,
              description: sortedLedgerEntries[lastZeroOrNegativeIndex]?.description,
            }
          : undefined,
      note: !sortedLedgerEntries
        ? 'Ledger entries were not available.'
        : lastZeroOrNegativeIndex === undefined
          ? 'No zero/negative balance found in ledger.'
          : undefined,
    },
    step2: {
      method: nonRentMethod,
      includedItemsCount: nonRentItems.length,
      includedItems: nonRentItems,
      totalNonRent: finalTotalNonRentalFromLastZero,
      note: nonRentNote,
    },
    step3: {
      rule: step3Rule,
      targetMonthISO: step3TargetMonthISO,
      selectedEntry: step3SelectedEntry,
      latestBalance,
      note: step3Note,
    },
    step4: {
      rentArrears: latestBalance - finalTotalNonRentalFromLastZero,
      formulaHuman: `${latestBalance} - ${finalTotalNonRentalFromLastZero} = ${latestBalance - finalTotalNonRentalFromLastZero}`,
    },
  };
  
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
    calculationTrace,
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