import { HuggingFaceResponse, ProcessedData, LedgerEntry } from '@/types';

/**
 * Apply core business logic for rental arrears calculation
 * Implements 4-step calculation rules:
 * 1. Find the last zero or negative balance
 * 2. Add up non-rent charges from that point onward
 * 3. Identify the correct latest balance (based on date)
 * 4. Calculate rent arrears = latest balance - total non-rent charges
 */
export function calculateFinalAmount(aiData: HuggingFaceResponse): ProcessedData {
  // Calculate total non-rental charges (all charges)
  const totalNonRental = aiData.nonRentalCharges.reduce(
    (sum, charge) => sum + Math.abs(charge.amount), 
    0
  );
  
  // Step 1: Find the last zero or negative balance
  let lastZeroOrNegativeBalanceDate: string | undefined;
  let lastZeroOrNegativeBalance: number | undefined;
  
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
        break;
      }
    }
  }
  
  // Step 2: Add up non-rent charges from the last zero/negative balance point onward
  let totalNonRentalFromLastZero = 0;
  
  if (lastZeroOrNegativeBalanceDate && aiData.ledgerEntries) {
    const sortedEntries = [...aiData.ledgerEntries].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    const lastZeroDate = new Date(lastZeroOrNegativeBalanceDate);
    let foundLastZero = false;
    
    for (const entry of sortedEntries) {
      const entryDate = new Date(entry.date);
      
      // Start counting from the entry after the last zero/negative balance
      if (foundLastZero || entryDate > lastZeroDate) {
        foundLastZero = true;
        // If this is a non-rental charge, add it
        if (entry.isRental === false || (!entry.isRental && entry.debit && entry.debit > 0)) {
          totalNonRentalFromLastZero += Math.abs(entry.debit || 0);
        }
      }
    }
  } else {
    // Fallback: if no ledger entries, use all non-rental charges
    totalNonRentalFromLastZero = totalNonRental;
  }
  
  // Step 3: Identify the correct latest balance based on today's date
  // PRIORITY: ALWAYS use finalBalance first if available (most accurate from TOTAL line)
  let latestBalance = 0;
  
  console.log('💰 Balance extraction - Input data:', {
    finalBalance: aiData.finalBalance,
    openingBalance: aiData.openingBalance,
    ledgerEntriesCount: aiData.ledgerEntries?.length || 0
  });
  
  // CRITICAL: If finalBalance is available, use it directly (from TOTAL line)
  if (aiData.finalBalance && aiData.finalBalance > 0) {
    latestBalance = aiData.finalBalance;
    console.log('✅ Using finalBalance from TOTAL line:', latestBalance);
  } else if (aiData.ledgerEntries && aiData.ledgerEntries.length > 0) {
    // Only calculate from ledger entries if finalBalance is not available
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    // Sort entries by date (newest first)
    const sortedEntries = [...aiData.ledgerEntries].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    let calculatedLatestBalance = sortedEntries[0]?.balance || aiData.openingBalance;
    
    if (currentDay >= 1 && currentDay <= 5) {
      // Use last balance from previous month
      const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const previousYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      
      for (const entry of sortedEntries) {
        const entryDate = new Date(entry.date);
        if (entryDate.getMonth() === previousMonth && entryDate.getFullYear() === previousYear) {
          calculatedLatestBalance = entry.balance;
          break;
        }
      }
      // If no entry found in previous month, use the most recent entry before current month
      if (calculatedLatestBalance === (sortedEntries[0]?.balance || aiData.openingBalance)) {
        for (const entry of sortedEntries) {
          const entryDate = new Date(entry.date);
          if (entryDate.getMonth() < currentMonth || entryDate.getFullYear() < currentYear) {
            calculatedLatestBalance = entry.balance;
            break;
          }
        }
      }
    } else {
      // Use latest balance from current month (day 6 or later)
      for (const entry of sortedEntries) {
        const entryDate = new Date(entry.date);
        if (entryDate.getMonth() === currentMonth && entryDate.getFullYear() === currentYear) {
          calculatedLatestBalance = entry.balance;
          break;
        }
      }
      // If no entry found in current month, use the most recent entry
      if (calculatedLatestBalance === (sortedEntries[0]?.balance || aiData.openingBalance) && sortedEntries.length > 0) {
        calculatedLatestBalance = sortedEntries[0].balance;
      }
    }
    
    latestBalance = calculatedLatestBalance;
    console.log('Calculated latest balance from ledger entries:', latestBalance);
  } else {
    // Fallback to openingBalance if nothing else available
    latestBalance = aiData.openingBalance || 0;
    console.log('Using openingBalance as fallback:', latestBalance);
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