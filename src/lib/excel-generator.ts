import * as XLSX from 'xlsx';
import { ProcessedData } from '@/types';

/**
 * Generate Excel file with structured rental arrears data
 * Creates 3 sheets: Rental Charges, Non-Rental Charges, Summary
 */
export function generateExcelFile(data: ProcessedData): Buffer {
  // Create new workbook
  const workbook = XLSX.utils.book_new();
  
  // Sheet 1: Rental Charges
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
  
  // Sheet 2: Non-Rental Charges (MOST IMPORTANT)
  const nonRentalChargesData = [
    ['Description', 'Amount', 'Date', 'Category'],
    ...data.nonRentalCharges.map(charge => [
      charge.description,
      charge.amount,
      charge.date || 'N/A',
      charge.category || 'Other'
    ])
  ];
  
  const nonRentalSheet = XLSX.utils.aoa_to_sheet(nonRentalChargesData);
  
  // Format non-rental charges sheet
  nonRentalSheet['!cols'] = [
    { width: 40 }, // Description
    { width: 15 }, // Amount
    { width: 15 }, // Date
    { width: 20 }  // Category
  ];
  
  XLSX.utils.book_append_sheet(workbook, nonRentalSheet, 'Non-Rental Charges');
  
  // Sheet 3: Summary
  const summaryData = [
    ['Property Information', ''],
    ['Tenant Name', data.tenantName],
    ['Property Name', data.propertyName],
    ['Period', data.period],
    ['', ''],
    ['Financial Summary', ''],
    ['Opening Balance', data.openingBalance],
    ['Latest Balance (per date rule)', data.latestBalance],
    ['Last Zero/Negative Balance Date', data.lastZeroOrNegativeBalanceDate || 'N/A'],
    ['Total Non-Rental Charges (all)', data.totalNonRental],
    ['Total Non-Rental Charges (from last <= 0)', data.totalNonRentalFromLastZero],
    ['Rent Arrears', data.rentArrears],
    ['', ''],
    ['Calculation Logic', ''],
    ['Rent Arrears = Latest Balance - Non-Rental Charges (from last <= 0 balance)', ''],
    [`${data.rentArrears} = ${data.latestBalance} - ${data.totalNonRentalFromLastZero}`, ''],
    ['', ''],
    ['Breakdown', ''],
    [`Total Rental Charges: ${data.rentalCharges.length}`, ''],
    [`Total Non-Rental Charges: ${data.nonRentalCharges.length}`, ''],
    ['', ''],
    ['Generated On', new Date().toISOString().split('T')[0]]
  ];
  
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  
  // Format summary sheet
  summarySheet['!cols'] = [
    { width: 35 }, // Label
    { width: 25 }  // Value
  ];
  
  // Style important cells (Rent Arrears)
  // Rent Arrears row is B12 with the new layout above.
  if (summarySheet['B12']) {
    summarySheet['B12'].s = {
      font: { bold: true, color: { rgb: "FF0000" } },
      fill: { fgColor: { rgb: "FFFF00" } }
    };
  }
  
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  
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