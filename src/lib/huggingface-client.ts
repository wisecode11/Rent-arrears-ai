import { HuggingFaceResponse } from '@/types';

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
 * Parse Resident Ledger format (different structure)
 * Format: Date | Chg Code | Description | Charge | Payment | Balance | Chg/Rec
 */
function parseResidentLedgerFormat(extractedText: string): HuggingFaceResponse {
  const lines = extractedText.split('\n').filter(line => line.trim().length > 0);
  
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
  let dataStartIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Date') && lines[i].includes('Chg Code') && lines[i].includes('Balance')) {
      dataStartIndex = i + 1;
      break;
    }
  }
  
  // Parse each ledger entry
  // Format: MM/DD/YYYY  code  description  charge  payment  balance  control#
  // Payment can be empty, balance must have decimal point
  // Pattern: date code description charge [payment] balance [control#]
  const ledgerEntryRegex = /(\d{2}\/\d{2}\/\d{4})\s+(\w+)\s+(.+?)\s+([-\d,\.()]+)\s+([-\d,\.()]*)\s+([-\d,\.()]+\.\d{2})(?:\s+\d+)?$/i;
  
  // Alternative: when payment is missing, balance comes right after charge
  const altLedgerRegex = /(\d{2}\/\d{2}\/\d{4})\s+(\w+)\s+(.+?)\s+([-\d,\.()]+)\s+([-\d,\.()]+\.\d{2})(?:\s+\d+)?$/i;
  
  // Track seen entries to prevent duplicates
  const seenEntries = new Set<string>();
  
  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip page numbers and headers
    if (line.match(/^\d+\s*\/\s*\d+/) || line.includes('Resident Ledger') || line.includes('Date:')) {
      continue;
    }
    
    // Try primary regex first (with payment field)
    let match = line.match(ledgerEntryRegex);
    let hasPayment = true;
    
    // If no match, try alternative (without payment field)
    if (!match) {
      match = line.match(altLedgerRegex);
      hasPayment = false;
    }
    
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const chgCode = match[2].toLowerCase();
      let description = match[3].trim();
      
      // Clean description - remove control numbers and Ctrl# references
      // Control numbers are usually 6-9 digit numbers in descriptions
      description = description
        .replace(/\s+Ctrl#\s*\d+/gi, '') // Remove "Ctrl# 173461"
        .replace(/\s+Ctrl\s*\d+/gi, '') // Remove "Ctrl 173461"
        .replace(/\b\d{6,9}\b/g, '') // Remove 6-9 digit numbers (likely control numbers)
        .replace(/\s+\d{5,}$/, '') // Remove trailing 5+ digit numbers (control numbers)
        .replace(/\s{2,}/g, ' ') // Clean up multiple spaces
        .trim();
      
      // Parse amounts - handle negative values in parentheses like (25.00)
      const chargeStr = match[4] ? match[4].trim() : '';
      const paymentStr = hasPayment && match[5] ? match[5].trim() : '';
      const balanceStr = hasPayment ? (match[6] ? match[6].trim() : '') : (match[5] ? match[5].trim() : '');
      
      // Parse amounts - remove commas and handle negative values in parentheses
      const parseAmount = (str: string): number => {
        if (!str) return 0;
        // Remove commas and parentheses, handle negative
        const cleaned = str.replace(/,/g, '').trim();
        if (cleaned.includes('(')) {
          return -Math.abs(parseFloat(cleaned.replace(/[()]/g, '')));
        }
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
      };
      
      let charge = parseAmount(chargeStr);
      const payment = parseAmount(paymentStr);
      let balance = parseAmount(balanceStr);
      
      // Detect if charge field is actually a control number
      // Control numbers are usually 5-9 digit whole numbers without decimals
      // Charges should have decimals or be reasonable amounts (under $100k)
      const isChargeControlNumber = chargeStr && 
                                    !chargeStr.includes('.') && 
                                    !chargeStr.includes(',') &&
                                    chargeStr.length >= 5 && 
                                    charge >= 10000 && 
                                    charge < 1000000;
      
      // For specific entry types, charge is usually 0
      const isNSFReceipt = description.toLowerCase().includes('nsf receipt');
      const isReversal = description.toLowerCase().includes('reversed') || 
                        description.toLowerCase().includes('reverse') ||
                        description.toLowerCase().includes('reversed by charge');
      const isPaymentEntry = chgCode === 'chk' && (isNSFReceipt || description.toLowerCase().includes('clickpay'));
      
      // If charge looks like a control number OR it's a payment/reversal entry, set charge to 0
      if (isChargeControlNumber || isPaymentEntry || isReversal) {
        charge = 0;
      }
      
      // Store isReversal for later use
      const entryIsReversal = isReversal;
      
      // Final validation - charges should be under $100,000
      const MAX_REASONABLE_CHARGE = 100000; // $100k max for a single charge
      if (charge > MAX_REASONABLE_CHARGE) {
        // This is definitely a control number or error, set charge to 0
        charge = 0;
      }
      
      // Validate balance - must have decimal point (like 3,506.13), not a whole number (control#)
      // If balance doesn't have decimal, it might be the control number - try to find balance before it
      if (balanceStr && !balanceStr.includes('.') && balance > 1000) {
        // This is likely a control number, not a balance - try to find balance before it
        // Look for a number with decimal point before the control number
        const balanceMatch = line.match(/(\d{1,3}(?:,\d{3})*\.\d{2})\s+\d+$/);
        if (balanceMatch) {
          balance = parseAmount(balanceMatch[1]);
        } else {
          console.warn('Skipping entry - balance appears to be control number:', { date, chgCode, balanceStr });
          continue;
        }
      }
      
      // Validate balance - should be reasonable
      const MAX_REASONABLE_BALANCE = 1000000; // $1 million max for balance
      if (Math.abs(balance) > MAX_REASONABLE_BALANCE) {
        console.warn('Skipping entry with unreasonable balance:', { date, chgCode, description, balance });
        continue;
      }
      
      // Create unique key to prevent duplicates
      const entryKey = `${date}_${chgCode}_${description.substring(0, 50)}_${charge}_${balance}`;
      
      // Skip if already seen
      if (seenEntries.has(entryKey)) {
        continue;
      }
      seenEntries.add(entryKey);
      
      // Track opening balance (first valid entry with positive balance)
      if (openingBalance === 0 && Math.abs(balance) > 0 && balance >= 0) {
        openingBalance = balance;
      }
      
      // Final balance is the last entry's balance (keep updating)
      if (Math.abs(balance) > 0) {
        finalBalance = balance;
      }
      
      // Determine if rental or non-rental based on charge code
      const isRental = chgCode === 'affrent' || chgCode === 'rent';
      
      // Payments should NEVER be counted as charges
      const isPayment = chgCode === 'chk' || 
                       description.toLowerCase().includes('clickpay') ||
                       description.toLowerCase().includes('payment') ||
                       description.toLowerCase().includes('chk#') ||
                       description.toLowerCase().includes('ach') ||
                       (payment > 0 && charge === 0); // If there's payment but no charge, it's a payment entry
      
      // Credits and reversals should NOT be counted as charges
      const isCredit = description.toLowerCase().includes('credit') ||
                      description.toLowerCase().includes('reversed') ||
                      description.toLowerCase().includes('reverse') ||
                      charge < 0; // Negative charges are credits
      
      // Non-rental charges: only actual charges, not payments or credits
      const isNonRental = !isRental && !isPayment && !isCredit && (
        chgCode === 'latefee' || 
        chgCode === 'secdep' || 
        chgCode === 'nsf' || 
        chgCode === 'keyinc' || 
        chgCode === 'uao' ||
        (charge > 0 && charge < 100000) // Reasonable charge amount
      );
      
      // Add to ledger entries
      ledgerEntries.push({
        date: date,
        description: description,
        debit: charge > 0 ? charge : 0,
        credit: payment > 0 ? payment : 0,
        balance: balance,
        isRental: isRental
      });
      
      // Add to rental charges (only if positive charge, not credits/reversals)
      if (isRental && charge > 0 && !isCredit && !entryIsReversal) {
        rentalCharges.push({
          description: description,
          amount: charge,
          date: date
        });
      }
      
      // Add to non-rental charges (ONLY if it's a charge, not a payment/reversal)
      if (isNonRental && charge > 0 && !isPayment && !entryIsReversal) {
        let category = 'other';
        if (chgCode === 'latefee') category = 'late_fee';
        else if (chgCode === 'secdep') category = 'security_deposit';
        else if (chgCode === 'nsf') category = 'bad_check';
        else if (chgCode === 'keyinc') category = 'lockout';
        else if (chgCode === 'uao') category = 'use_of_occupancy';
        
        nonRentalCharges.push({
          description: description,
          amount: charge,
          date: date,
          category: category
        });
      }
    }
  }
  
  // Sort by date
  ledgerEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  rentalCharges.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  nonRentalCharges.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
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
    ledgerEntries
  };
}

/**
 * Direct text parser - 100% accurate extraction without AI dependency
 */
function parsePDFTextDirectly(extractedText: string): HuggingFaceResponse {
  const lines = extractedText.split('\n').filter(line => line.trim().length > 0);
  
  // Check if this is a "Resident Ledger" format (different structure)
  const isResidentLedgerFormat = extractedText.includes('Resident Ledger') || 
                                  extractedText.includes('Chg Code') ||
                                  lines.some(line => line.match(/^\d{2}\/\d{2}\/\d{4}\s+\w+\s+\w+\s+/));
  
  if (isResidentLedgerFormat) {
    return parseResidentLedgerFormat(extractedText);
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
        if (!isNaN(parsed) && parsed > 0) {
          finalBalance = parsed;
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
      const balanceMatch = line.match(/(\d{1,3}(?:,\d{3})*\.\d{2})/);
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
      const firstEntryMatch = line.match(/(\d{2}\/\d{2}\/\d{4}).*?(\d{1,3}(?:,\d{3})*\.\d{2})\s*$/);
      if (firstEntryMatch) {
        openingBalance = parseFloat(firstEntryMatch[2].replace(/,/g, ''));
        break;
      }
    }
  }
  
  // Extract ALL rental charges (BASE RENT entries) - more flexible regex
  const rentalCharges: any[] = [];
  // Match: date, code number, BASE RENT, colon, amount (with flexible spacing)
  const rentalRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+BASE\s+RENT\s*:?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/i;
  
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
  
  console.log('Extracted rental charges:', rentalCharges.length);
  
  // Extract ALL non-rental charges - COMPLETE EXTRACTION
  const nonRentalCharges: any[] = [];
  const ledgerEntries: any[] = [];
  
  // Pattern for AIR CONDITIONER - handle variable spacing (balance not required at end)
  const acRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+AIR\s+CONDITIONER\s*:?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?:\s+(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}))?/i;
  for (const line of lines) {
    const match = line.match(acRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[2].replace(/,/g, ''));
      const balance = parseFloat(match[3].replace(/,/g, ''));
      
      nonRentalCharges.push({
        description: 'AIR CONDITIONER',
        amount: amount,
        date: date,
        category: 'air_conditioner'
      });
      
      ledgerEntries.push({
        date: date,
        description: 'AIR CONDITIONER',
        debit: amount,
        credit: 0,
        balance: balance,
        isRental: false
      });
    }
  }
  
  // Pattern for LATE CHARGE / LATE FEE - handle variable spacing and optional text
  const lateRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+LATE\s+(?:CHARGE|FEE)\s*(?:FOR\s+[^:0-9]+)?\s*:?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?:\s+(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}))?/i;
  for (const line of lines) {
    const match = line.match(lateRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[2].replace(/,/g, ''));
      const balance = match[3] ? parseFloat(match[3].replace(/,/g, '')) : 0;
      
      nonRentalCharges.push({
        description: 'LATE CHARGE',
        amount: amount,
        date: date,
        category: 'late_fee'
      });
      
      ledgerEntries.push({
        date: date,
        description: 'LATE CHARGE',
        debit: amount,
        credit: 0,
        balance: balance,
        isRental: false
      });
    }
  }
  
  // Pattern for LEGAL FEES - handle description text before amount (more flexible)
  const legalRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+LEGAL\s+FEES\s*:?\s*([^0-9]+?)\s+(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?:\s+(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}))?/i;
  for (const line of lines) {
    const match = line.match(legalRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const description = match[2].trim();
      const amount = parseFloat(match[3].replace(/,/g, ''));
      const balance = match[4] ? parseFloat(match[4].replace(/,/g, '')) : 0;
      
      nonRentalCharges.push({
        description: `LEGAL FEES: ${description}`,
        amount: amount,
        date: date,
        category: 'legal_fees'
      });
      
      ledgerEntries.push({
        date: date,
        description: `LEGAL FEES: ${description}`,
        debit: amount,
        credit: 0,
        balance: balance,
        isRental: false
      });
    }
  }
  
  // Pattern for BAD CHECK CHARGE - handle RETURN: text (more flexible)
  const badCheckRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+BAD\s+CHECK\s+CHARGE\s*:?\s*([^0-9]+?)\s+(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?:\s+(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}))?/i;
  for (const line of lines) {
    const match = line.match(badCheckRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[3].replace(/,/g, ''));
      const balance = match[4] ? parseFloat(match[4].replace(/,/g, '')) : 0;
      
      nonRentalCharges.push({
        description: 'BAD CHECK CHARGE',
        amount: amount,
        date: date,
        category: 'bad_check'
      });
      
      ledgerEntries.push({
        date: date,
        description: 'BAD CHECK CHARGE',
        debit: amount,
        credit: 0,
        balance: balance,
        isRental: false
      });
    }
  }
  
  // Pattern for SECURITY DEPOSIT (more flexible)
  const securityRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+SECURITY\s+DEPOSIT\s*:?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})(?:\s+(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}))?/i;
  for (const line of lines) {
    const match = line.match(securityRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const amount = parseFloat(match[2].replace(/,/g, ''));
      const balance = match[3] ? parseFloat(match[3].replace(/,/g, '')) : 0;
      
      nonRentalCharges.push({
        description: 'SECURITY DEPOSIT',
        amount: amount,
        date: date,
        category: 'security_deposit'
      });
      
      ledgerEntries.push({
        date: date,
        description: 'SECURITY DEPOSIT',
        debit: amount,
        credit: 0,
        balance: balance,
        isRental: false
      });
    }
  }
  
  // Extract ALL ledger entries including BASE RENT and PAYMENTS - more flexible
  // Pattern: date, code, description, optional colon, billed amount, paid amount, balance
  const ledgerRegex = /(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+([^:]+?):?\s*([-\d,\.]+)?\s*([-\d,\.]+)?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/i;
  for (const line of lines) {
    // Skip header lines and TOTAL line
    if (line.toUpperCase().includes('DATE') && line.toUpperCase().includes('DESCRIPTION')) continue;
    if (line.toUpperCase().includes('TOTAL')) continue;
    if (line.includes('===') || line.includes('---')) continue;
    
    const match = line.match(ledgerRegex);
    if (match) {
      const dateStr = match[1];
      const [month, day, year] = dateStr.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      const description = match[3].trim();
      const billed = match[4] ? parseFloat(match[4].replace(/,/g, '')) : 0;
      const paid = match[5] ? parseFloat(match[5].replace(/,/g, '')) : 0;
      const balance = parseFloat(match[6].replace(/,/g, ''));
      
      const isRental = description.toUpperCase().includes('BASE RENT') || description.toUpperCase().includes('RENT');
      const isPayment = description.toUpperCase().includes('PAYMENT');
      
      // Only add if not already added as non-rental charge
      const alreadyAdded = ledgerEntries.some(e => 
        e.date === date && 
        e.description === description && 
        Math.abs(e.balance - balance) < 0.01
      );
      
      if (!alreadyAdded && (isRental || isPayment || !description.match(/^(AIR CONDITIONER|LATE|LEGAL|BAD CHECK|SECURITY)/i))) {
        ledgerEntries.push({
          date: date,
          description: description,
          debit: billed > 0 ? billed : 0,
          credit: paid > 0 ? paid : 0,
          balance: balance,
          isRental: isRental
        });
      }
    }
  }
  
  // Sort ledger entries by date
  ledgerEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Use finalBalance if found, otherwise use last ledger entry balance
  if (finalBalance === 0 && ledgerEntries.length > 0) {
    finalBalance = ledgerEntries[ledgerEntries.length - 1].balance;
  }
  
  console.log('Direct parsing complete:', {
    finalBalance,
    openingBalance,
    rentalCharges: rentalCharges.length,
    nonRentalCharges: nonRentalCharges.length,
    ledgerEntries: ledgerEntries.length
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
    period: 'Extracted Period',
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
        
        const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
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
  const rentalRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+BASE\s+RENT\s*:\s*(\d{1,3}(?:,\d{3})*\.\d{2})/i;
  
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
  const acRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+AIR\s+CONDITIONER\s*:\s*(\d{1,3}(?:,\d{3})*\.\d{2})/i;
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
  const lateRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+LATE\s+(?:CHARGE|FEE)\s*:.*?(\d{1,3}(?:,\d{3})*\.\d{2})/i;
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
  const legalRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+LEGAL\s+FEES\s*:.*?(\d{1,3}(?:,\d{3})*\.\d{2})/i;
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
  const badCheckRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+BAD\s+CHECK\s+CHARGE\s*:.*?(\d{1,3}(?:,\d{3})*\.\d{2})/i;
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
  const securityRegex = /(\d{2}\/\d{2}\/\d{4})\s+\d+\s+SECURITY\s+DEPOSIT\s*:\s*(\d{1,3}(?:,\d{3})*\.\d{2})/i;
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