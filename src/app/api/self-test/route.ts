import { NextResponse } from 'next/server';
import { parseLedgerFromText, chargesFromLedgerEntries } from '@/lib/ledger-parser';
import { parsePDFTextDirectly, parseResidentLedgerFormat } from '@/lib/huggingface-client';
import { calculateFinalAmount } from '@/lib/business-logic';
import type { HuggingFaceResponse } from '@/types';

export async function GET() {
  const fixtures: Array<{ name: string; asOfDate: string; text: string; issueDateISO?: string }> = [
    {
      name: 'Format A (simple 2-amount rows)',
      asOfDate: '2026-01-03', // 1st-5th => previous month balance
      text: `
12/01/2025 BASE RENT 1500.00 1500.00
12/01/2025 AIR CONDITIONER 10.00 1510.00
12/05/2025 PAYMENT -1510.00 0.00
01/01/2026 BASE RENT 1500.00 1500.00
01/02/2026 LATE FEE 25.00 1525.00
      `.trim(),
    },
    {
      name: 'Format B (debit/credit/balance rows)',
      asOfDate: '2026-01-19', // 6th+ => current month balance
      text: `
2025-12-01 Rent Charge 1500.00 0.00 1500.00
2025-12-02 Maintenance Fee 50.00 0.00 1550.00
2025-12-10 Payment 0.00 1550.00 0.00
2026-01-01 Rent 1500.00 0.00 1500.00
2026-01-03 Legal Fees 100.00 0.00 1600.00
      `.trim(),
    },
    {
      name: 'Format C (statement w/ charge codes + wrapped amount/balance)',
      asOfDate: '2026-01-19',
      text: `
DATE DESCRIPTION AMOUNT AMOUNT BALANCE
07/01/2015  1 BASE RENT : 1525.00
1525.00
07/01/2015 25 AIR CONDITIONER : 10.00 1535.00
07/23/2015 PAYMENT CH#:159 1525.00 10.00
08/01/2015  1 BASE RENT : 1525.00
1535.00
08/06/2015 59 LATE CHARGE : 25.00 1570.00
TOTAL  234345.71  228609.66    5736.05
      `.trim(),
    },
    {
      name: 'Balance-forward rows should NOT count as non-rental',
      asOfDate: '2026-01-19',
      text: `
12/01/2015 BASE RENT 1525.00 4675.00
12/01/2015 AIR CONDITIONER 10.00 4685.00
12/02/2015 PAYMENT -1525.00 3160.00
01/01/2016 YEAR STARTING BALANCE 2016 3160.00 3160.00
01/01/2016 AIR CONDITIONER 10.00 3170.00
      `.trim(),
    },
    {
      name: 'No Issue Date: use latest ledger date for 1-5 rule (statement/charge-code layout, wrapped balance)',
      asOfDate: '2026-01-19', // should be ignored because we use latest ledger date when issueDate is missing
      text: `
STATEMENT
DATE DESCRIPTION AMOUNT AMOUNT BALANCE
09/01/2025  1 BASE RENT : 1886.61
5736.05
09/09/2025     PAYMENT CH#:199        1886.61               3849.44
10/01/2025  1 BASE RENT : 1886.61               5736.05
TOTAL  234345.71  228609.66    5736.05
      `.trim(),
    },
    {
      name: 'Issue Date cutoff (ignore future month entries)',
      asOfDate: '2026-01-03', // system date (should be ignored because issue date is present)
      issueDateISO: '2025-06-02',
      text: `
Date  Chg Code  Description  Charge  Payment  Balance  Chg/Rec
05/31/2025  latefee  Late Fee (05/2025)  50.00  0.00  100.00  1
06/01/2025  resid  Residential Rent (06/2025)  500.00  0.00  200.00  2
07/01/2025  resid  Residential Rent (07/2025)  500.00  0.00  300.00  3
      `.trim(),
    },
    {
      name: 'Issue Date + rent-only current month => step back',
      asOfDate: '2026-01-19',
      issueDateISO: '2025-08-14',
      text: `
Date  Chg Code  Description  Charge  Payment  Balance  Chg/Rec
08/01/2025  latefee  Late Fee (07/2025)  50.00  0.00  900.00  1
09/01/2025  resid  Residential Rent (09/2025)  1000.00  0.00  1500.00  2
      `.trim(),
    },
    {
      name: 'Issue Date + non-rent in current month => use it',
      asOfDate: '2026-01-19',
      issueDateISO: '2025-08-14',
      text: `
Date  Chg Code  Description  Charge  Payment  Balance  Chg/Rec
08/01/2025  latefee  Late Fee (07/2025)  50.00  0.00  900.00  1
09/01/2025  resid  Residential Rent (09/2025)  1000.00  0.00  1500.00  2
09/01/2025  latefee  Late Fee (08/2025)  50.00  0.00  1550.00  3
      `.trim(),
    },
    {
      name: 'Issue Date cutoff: allow backdated non-rent posted after issue date (Late Fee (08/2025) on 09/01)',
      asOfDate: '2026-01-19',
      issueDateISO: '2025-08-14',
      text: `
Date  Chg Code  Description  Charge  Payment  Balance  Chg/Rec
08/01/2025  resid  Residential Rent (08/2025)  3399.00  0.00  12000.00  1
09/01/2025  latefee  Late Fee (08/2025)  50.00  0.00  12081.73  2
      `.trim(),
    },
    {
      name: 'Issue Date cutoff: allow backdated non-rent posted after issue date with explicit date reference (Mar 13, 2025 ...)',
      asOfDate: '2026-01-19',
      issueDateISO: '2025-04-25',
      text: `
Date  Chg Code  Description  Charge  Payment  Balance  Chg/Rec
04/07/2025  keyinc  Feb 27, 2025 01:20:00 Lockout  50.00  0.00  7576.17  1
05/01/2025  keyinc  Mar 13, 2025 22:30 PM Lockout  75.00  0.00  7826.17  2
      `.trim(),
    },
    {
      name: 'Issue Date: allow payment row within issue month to drive latest balance (04/25 payment reduces balance)',
      asOfDate: '2026-01-19',
      issueDateISO: '2025-04-28',
      text: `
Date  Chg Code  Description  Charge  Payment  Balance  Chg/Rec
04/01/2025  resid  Residential Rent (04/2025)  656.10  0.00  7256.03  1
04/16/2025  latefees  Late Fees  50.00  0.00  7006.03  2
04/25/2025  chk#  ACH Payment  0.00  2608.88  4397.15  3
05/01/2025  resid  Residential Rent (05/2025)  743.77  0.00  5140.92  4
      `.trim(),
    },
  ];

  const results = fixtures.map((f) => {
    const parsed = parseLedgerFromText(f.text);
    const { rentalCharges, nonRentalCharges } = chargesFromLedgerEntries(parsed.ledgerEntries);
    const issueDate = f.issueDateISO;

    const aiData: HuggingFaceResponse = {
      tenantName: 'Test Tenant',
      propertyName: 'Test Property',
      period: 'Fixture',
      openingBalance: parsed.ledgerEntries[0]?.balance ?? 0,
      finalBalance: parsed.ledgerEntries.at(-1)?.balance ?? 0,
      rentalCharges,
      nonRentalCharges,
      ledgerEntries: parsed.ledgerEntries,
      issueDate,
    };

    const processed = calculateFinalAmount(aiData, new Date(f.asOfDate));
    const nonRentHasBalanceForward = nonRentalCharges.some((c) =>
      c.description.toUpperCase().includes('YEAR STARTING BALANCE')
    );
    return {
      name: f.name,
      asOfDate: f.asOfDate,
      ledgerEntries: parsed.ledgerEntries.length,
      rentalCharges: rentalCharges.length,
      nonRentalCharges: nonRentalCharges.length,
      nonRentHasBalanceForward,
      sampleRental: rentalCharges.slice(0, 3),
      latestBalance: processed.latestBalance,
      lastZeroOrNegativeBalanceDate: processed.lastZeroOrNegativeBalanceDate,
      totalNonRentalFromLastZero: processed.totalNonRentalFromLastZero,
      rentArrears: processed.rentArrears,
      calculationTrace: processed.calculationTrace,
      debugLedgerTail:
        f.name.startsWith('Issue Date')
          ? parsed.ledgerEntries.slice(-5)
          : undefined,
    };
  });

  const tenantLedgerFixtures: Array<{ name: string; asOfDate: string; text: string }> = [
    {
      name: 'Tenant Ledger (handles Legal Rent + concatenated amounts + negative balances)',
      asOfDate: '2025-07-08',
      text: `
Tenants: Sarah Thomas
Unit: 938 Eastern Parkway - 2A
Property: 932-938 Eastern Parkway Residences, LLC - 932-938 Eastern Parkway Brooklyn, NY 11213
Date Payer Description Charges Payments Balance
0.00
Starting Balance
6/1/2020 Residential Rent - APT RENT 1,900.00 1,900.00
6/22/2020 Shekinah Voisin Payment 950.00 950.00
7/26/2024 Sarah Thomas ACH Payment (Reference #7D01-5C50) 1,400.00-558.80
8/1/2024 Residential Rent - August 2024 - Legal Rent2,050.921,492.12
8/16/2024 Late Fees - Residential - Late Fee for Aug 202450.00942.12
8/16/2024 Late Fees - Residential - August 2024 Late fees reversal-50.00892.12
9/20/2021 Shekinah Voisin Payment (Reference #DTZQ-3LYM) 16,150.00-3,800.00
Total 6,421.96
      `.trim(),
    },
    {
      name: 'Security deposit paid/zeroed => exclude deposit from non-rental',
      asOfDate: '2025-04-18',
      text: `
Tenants: Test Tenant
Unit: 302
Property: 240 E 175TH STREET
Date Payer Description Charges Payments Balance
0.00
Starting Balance
1/1/2025 SECDEP SECURITY DEPOSIT 659.78 659.78
1/21/2025 WASHING WASHING MACHINE 16.82 -16.82
2/1/2025 RENT RENT 982.15 965.33
2/19/2025 PAYMENT 1000.00 -34.67
3/1/2025 SECDEP SECURITY DEPOSIT 0.00 0.00
Total 0.00
      `.trim(),
    },
  ];

  const tenantLedgerResults = tenantLedgerFixtures.map((f) => {
    const aiData = parsePDFTextDirectly(f.text);
    const processed = calculateFinalAmount(aiData as HuggingFaceResponse, new Date(f.asOfDate));
    return {
      name: f.name,
      asOfDate: f.asOfDate,
      ledgerEntries: aiData.ledgerEntries?.length ?? 0,
      // show both raw-parsed and processed counts (processed includes business-rule filters)
      aiRentalCharges: aiData.rentalCharges?.length ?? 0,
      aiNonRentalCharges: aiData.nonRentalCharges?.length ?? 0,
      processedRentalCharges: processed.rentalCharges?.length ?? 0,
      processedNonRentalCharges: processed.nonRentalCharges?.length ?? 0,
      lastZeroOrNegativeBalanceDate: processed.lastZeroOrNegativeBalanceDate,
      latestBalance: processed.latestBalance,
      totalNonRentalFromLastZero: processed.totalNonRentalFromLastZero,
      totalNonRental: processed.totalNonRental,
      sampleNonRent: (processed.nonRentalCharges ?? []).slice(0, 3),
    };
  });

  const residentLedgerFixtures: Array<{ name: string; asOfDate: string; text: string }> = [
    {
      name: 'Resident Ledger (Bldg/Unit format) parses charges vs credits correctly',
      asOfDate: '2025-07-09',
      text: `
Resident Ledger - As Of Property Date:  07/09/2025
Bldg/UnitTransactionDateFiscalPeriodSubjournalCtrlTransactionCodeTransactionDescriptionDocChargesCreditsFlagBalance
1769-14T07/01/2025072025RESIDENTRENTRent2,155.800.007,779.04
1769-14T06/15/2025062025RESIDENTLATEFEELateCharges25.000.005,623.24
1769-14T05/30/2025052025RESIDENT423PMTMORD654030.001,800.003,442.44
1769-14T11/19/2024112024RESIDENTNSFFEENSFCheckFee025.000.003,238.66
1769-14T11/30/2024112024RESIDENT431PMTOPACHWelcomeHomeACHPayment0.001,123.11-1,098.11
      `.trim(),
    },
  ];

  const residentLedgerResults = residentLedgerFixtures.map((f) => {
    const aiData = parsePDFTextDirectly(f.text);
    const residentDirect = parseResidentLedgerFormat(f.text);
    const processed = calculateFinalAmount(aiData as HuggingFaceResponse, new Date(f.asOfDate));
    const dateFiscalRow = /\d{1,2}\/\d{1,2}\/\d{4}\s*\d{6}(?=\D|$)/;
    const allLines = f.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const residentLineCandidates = allLines.filter((l) => dateFiscalRow.test(l) && /RESIDENT/i.test(l)).length;
    const sampleLine =
      allLines.find((l) => /RESIDENT/i.test(l) && l.includes('/') && /\d{4}/.test(l)) ??
      allLines.find((l) => /RESIDENT/i.test(l)) ??
      allLines[0] ??
      '';
    return {
      name: f.name,
      asOfDate: f.asOfDate,
      ledgerEntries: aiData.ledgerEntries?.length ?? 0,
      aiRentalCharges: aiData.rentalCharges?.length ?? 0,
      aiNonRentalCharges: aiData.nonRentalCharges?.length ?? 0,
      processedNonRentalCharges: processed.nonRentalCharges?.length ?? 0,
      debugLineCandidates: residentLineCandidates,
      debugAllLinesHead: allLines.slice(0, 6),
      debugSampleLine: sampleLine.slice(0, 120),
      debugDateFiscalMatch: dateFiscalRow.test(sampleLine),
      debugResidentDirect: {
        ledgerEntries: residentDirect.ledgerEntries?.length ?? 0,
        rentalCharges: residentDirect.rentalCharges?.length ?? 0,
        nonRentalCharges: residentDirect.nonRentalCharges?.length ?? 0,
      },
      latestBalance: processed.latestBalance,
      lastZeroOrNegativeBalanceDate: processed.lastZeroOrNegativeBalanceDate,
      totalNonRentalFromLastZero: processed.totalNonRentalFromLastZero,
      sampleNonRent: (processed.nonRentalCharges ?? []).slice(0, 5),
      debugLedgerTail: (aiData.ledgerEntries ?? []).slice(-5),
    };
  });

  return NextResponse.json({ ok: true, results, tenantLedgerResults, residentLedgerResults });
}




