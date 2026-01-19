import * as XLSX from 'xlsx';
import { ProcessedData } from '@/types';

/**
 * Filter non-rental charges that occurred after the last zero/negative balance date
 */
function filterNonRentalChargesFromLastZero(
  nonRentalCharges: ProcessedData['nonRentalCharges'],
  lastZeroDate?: string,
  ledgerEntries?: ProcessedData['ledgerEntries']
): ProcessedData['nonRentalCharges'] {
  if (!lastZeroDate) {
    // If no last zero date, return all charges
    return nonRentalCharges;
  }

  // If we have ledger entries, use them to identify charges after last zero date
  if (ledgerEntries && ledgerEntries.length > 0) {
    const lastZeroDateObj = new Date(lastZeroDate);
    const sortedEntries = [...ledgerEntries].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    // Find index of last zero/negative balance
    let lastZeroIndex = -1;
    for (let i = sortedEntries.length - 1; i >= 0; i--) {
      if (sortedEntries[i].balance <= 0) {
        lastZeroIndex = i;
        break;
      }
    }
    
    if (lastZeroIndex >= 0) {
      // Collect non-rental descriptions from entries after last zero date
      const nonRentalDescriptionsAfterZero = new Set<string>();
      for (let i = lastZeroIndex + 1; i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        if (entry.debit && entry.debit > 0 && entry.isRental === false) {
          // Normalize description for matching
          const desc = entry.description.trim().toLowerCase();
          nonRentalDescriptionsAfterZero.add(desc);
        }
      }
      
      // Filter non-rental charges that match descriptions from after zero date
      return nonRentalCharges.filter(charge => {
        const chargeDesc = charge.description.trim().toLowerCase();
        const chargeDate = charge.date ? new Date(charge.date) : null;
        
        // Check if description matches or date is after last zero date
        return nonRentalDescriptionsAfterZero.has(chargeDesc) ||
               (chargeDate && chargeDate > lastZeroDateObj);
      });
    }
  }

  // Fallback: Filter by date if available
  const lastZeroDateObj = new Date(lastZeroDate);
  return nonRentalCharges.filter(charge => {
    if (!charge.date) return false;
    const chargeDate = new Date(charge.date);
    return chargeDate > lastZeroDateObj;
  });
}

/**
 * Generate Excel file with structured rental arrears data
 * Creates 4 sheets: Summary, Rental Charges, Non-Rental Charges (From Last Zero), Document Text Preview
 */
export function generateExcelFile(data: ProcessedData): Buffer {
  // Create new workbook
  const workbook = XLSX.utils.book_new();
  
  // Sheet 1: Summary (TOP PRIORITY - Shows Latest Balance and Rent Arrears at top)
  const summaryData = [
    ['RENTAL ARREARS REPORT', ''],
    ['', ''],
    ['Financial Summary', ''],
    ['Latest Balance', `$${data.latestBalance.toFixed(2)}`],
    ['Total Rent Arrears', `$${data.rentArrears.toFixed(2)}`],
    ['', ''],
    ['Property Information', ''],
    ['Tenant Name', data.tenantName],
    ['Property Name', data.propertyName],
    ['Period', data.period],
    ['', ''],
    ['Additional Details', ''],
    ['Opening Balance', `$${data.openingBalance.toFixed(2)}`],
    ['Last Zero/Negative Balance Date', data.lastZeroOrNegativeBalanceDate || 'N/A'],
    ['Total Non-Rental Charges (all)', `$${data.totalNonRental.toFixed(2)}`],
    ['Total Non-Rental Charges (from last zero/negative)', `$${data.totalNonRentalFromLastZero.toFixed(2)}`],
    ['', ''],
    ['Calculation Formula', ''],
    ['Rent Arrears = Latest Balance - Non-Rental Charges (from last zero/negative)', ''],
    [`$${data.rentArrears.toFixed(2)} = $${data.latestBalance.toFixed(2)} - $${data.totalNonRentalFromLastZero.toFixed(2)}`, ''],
    ['', ''],
    ['Breakdown', ''],
    [`Total Rental Charges: ${data.rentalCharges.length}`, ''],
    [`Total Non-Rental Charges (all): ${data.nonRentalCharges.length}`, ''],
    ['', ''],
    ['Generated On', new Date().toISOString().split('T')[0]]
  ];
  
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  
  // Format summary sheet
  summarySheet['!cols'] = [
    { width: 50 }, // Label
    { width: 30 }  // Value
  ];
  
  // Style important cells
  // Latest Balance (row 4, column B)
  const latestBalanceCell = summarySheet['B4'];
  if (latestBalanceCell) {
    latestBalanceCell.s = {
      font: { bold: true, size: 14, color: { rgb: "0000FF" } }
    };
  }
  
  // Total Rent Arrears (row 5, column B)
  const rentArrearsCell = summarySheet['B5'];
  if (rentArrearsCell) {
    rentArrearsCell.s = {
      font: { bold: true, size: 16, color: { rgb: "FF0000" } },
      fill: { fgColor: { rgb: "FFFF00" } }
    };
  }
  
  // Title cell
  const titleCell = summarySheet['A1'];
  if (titleCell) {
    titleCell.s = {
      font: { bold: true, size: 18, color: { rgb: "000000" } }
    };
  }
  
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  
  // Sheet 2: Rental Charges
  const rentalChargesData = [
    ['Description', 'Amount', 'Date'],
    ...data.rentalCharges.map(charge => [
      charge.description,
      charge.amount,
      charge.date || 'N/A'
    ])
  ];
  
  const rentalSheet = XLSX.utils.aoa_to_sheet(rentalChargesData);
  
  // Format rental charges sheet
  rentalSheet['!cols'] = [
    { width: 40 }, // Description
    { width: 15 }, // Amount
    { width: 15 }  // Date
  ];
  
  XLSX.utils.book_append_sheet(workbook, rentalSheet, 'Rental Charges');
  
  // Sheet 3: Non-Rental Charges FROM LAST ZERO/NEGATIVE BALANCE (ONLY)
  // Filter to show only charges after last zero/negative balance date
  const filteredNonRentalCharges = filterNonRentalChargesFromLastZero(
    data.nonRentalCharges,
    data.lastZeroOrNegativeBalanceDate,
    data.ledgerEntries
  );
  
  const nonRentalChargesData = [
    ['Description', 'Amount', 'Date', 'Category'],
    ...filteredNonRentalCharges.map(charge => [
      charge.description,
      charge.amount,
      charge.date || 'N/A',
      charge.category || 'Other'
    ])
  ];
  
  // Add header note if filtered
  if (data.lastZeroOrNegativeBalanceDate) {
    nonRentalChargesData.unshift(
      [`Note: Showing only non-rental charges from last zero/negative balance date (${data.lastZeroOrNegativeBalanceDate})`, '', '', '']
    );
    nonRentalChargesData.unshift(['NON-RENTAL CHARGES (FROM LAST ZERO/NEGATIVE BALANCE)', '', '', '']);
  } else {
    nonRentalChargesData.unshift(['NON-RENTAL CHARGES (ALL)', '', '', '']);
  }
  
  const nonRentalSheet = XLSX.utils.aoa_to_sheet(nonRentalChargesData);
  
  // Format non-rental charges sheet
  nonRentalSheet['!cols'] = [
    { width: 50 }, // Description
    { width: 15 }, // Amount
    { width: 15 }, // Date
    { width: 20 }  // Category
  ];
  
  // Style header row
  const headerRow1 = nonRentalSheet['A1'];
  if (headerRow1) {
    headerRow1.s = {
      font: { bold: true, size: 12, color: { rgb: "FF0000" } }
    };
  }
  
  XLSX.utils.book_append_sheet(workbook, nonRentalSheet, 'Non-Rental Charges');
  
  // Sheet 4: Document Text Preview (at the end)
  if (data.extractedText) {
    // Split text into lines and create rows
    const textLines = data.extractedText.split('\n').filter(line => line.trim().length > 0);
    const textPreviewData = [
      ['DOCUMENT TEXT PREVIEW'],
      ['This is the raw text extracted from the PDF document.'],
      [''],
      ...textLines.map(line => [line])
    ];
    
    const textPreviewSheet = XLSX.utils.aoa_to_sheet(textPreviewData);
    
    // Format text preview sheet
    textPreviewSheet['!cols'] = [
      { width: 100 } // Wide column for text
    ];
    
    // Style header
    const textHeaderCell = textPreviewSheet['A1'];
    if (textHeaderCell) {
      textHeaderCell.s = {
        font: { bold: true, size: 14, color: { rgb: "000000" } }
      };
    }
    
    XLSX.utils.book_append_sheet(workbook, textPreviewSheet, 'Document Text Preview');
  }
  
  // Generate buffer
  const excelBuffer = XLSX.write(workbook, { 
    type: 'buffer', 
    bookType: 'xlsx',
    compression: true 
  });
  
  return excelBuffer;
}

/**
 * Generate filename for Excel download
 */
export function generateExcelFilename(data: ProcessedData): string {
  const sanitizedTenant = data.tenantName.replace(/[^a-zA-Z0-9]/g, '_');
  const sanitizedProperty = data.propertyName.replace(/[^a-zA-Z0-9]/g, '_');
  const timestamp = new Date().toISOString().split('T')[0];
  
  return `Rental_Arrears_${sanitizedTenant}_${sanitizedProperty}_${timestamp}.xlsx`;
}