import { NextResponse } from 'next/server';
import { parseLedgerFromText, chargesFromLedgerEntries } from '@/lib/ledger-parser';
import { calculateFinalAmount } from '@/lib/business-logic';
import { analyzeWithAI, parseResidentLedgerFormat } from '@/lib/huggingface-client';
import type { HuggingFaceResponse } from '@/types';

export async function GET() {
  const fixtures: Array<{ name: string; asOfDate: string; text: string }> = [
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
  ];

  const results = fixtures.map((f) => {
    const parsed = parseLedgerFromText(f.text);
    const { rentalCharges, nonRentalCharges } = chargesFromLedgerEntries(parsed.ledgerEntries);

    const aiData: HuggingFaceResponse = {
      tenantName: 'Test Tenant',
      propertyName: 'Test Property',
      period: 'Fixture',
      openingBalance: parsed.ledgerEntries[0]?.balance ?? 0,
      finalBalance: parsed.ledgerEntries.at(-1)?.balance ?? 0,
      rentalCharges,
      nonRentalCharges,
      ledgerEntries: parsed.ledgerEntries,
    };

    const processed = calculateFinalAmount(aiData, new Date(f.asOfDate));
    return {
      name: f.name,
      asOfDate: f.asOfDate,
      ledgerEntries: parsed.ledgerEntries.length,
      rentalCharges: rentalCharges.length,
      nonRentalCharges: nonRentalCharges.length,
      sampleRental: rentalCharges.slice(0, 3),
      latestBalance: processed.latestBalance,
      lastZeroOrNegativeBalanceDate: processed.lastZeroOrNegativeBalanceDate,
      totalNonRentalFromLastZero: processed.totalNonRentalFromLastZero,
      rentArrears: processed.rentArrears,
    };
  });

  // Resident Ledger regression test: wrapped utilities line with "noise" decimals inside the description.
  const residentLedgerFixture = `
Resident Ledger
Date: 08/14/2025
Name Test Tenant Unit 1A
Address 123 Linden LLC Status Active
Date  Chg Code  Description  Charge  Payment  Balance  Chg/Rec
11/22/2023  chk#  Payment ACH  8,811.12  (8,811.12)  (3,350.00) 588931
12/01/2023  resid  Residential Rent (12/2023)  3,300.00  0.00 0.00 845564
12/01/2023  utilele
 Period:10\\3\\2023 - 10\\31\\2023 Readings:23358.70 - 24052.30 Usage=693.60
Cost_KWH=SC1 Salestax=$0.84 Amount=$18.62 MULTIPLIER:1.0 ACTUAL
 19.45  19.45 847797
12/01/2023  latefee   Late Fee (11/2023)  50.00  0.00 69.45 840478
12/02/2023  nsf  Returned check charge  25.00  0.00 94.45 850307
      `.trim();

  const residentDebug = {
    linesAroundUtilities: residentLedgerFixture
      .split('\n')
      .map((l) => l.replace(/\r/g, ''))
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => l.includes('utilele') || l.includes('Period:') || l.includes('Cost_KWH') || l.includes('19.45')),
    // Mirror the resident-ledger coalescing step to confirm the utility block actually includes all lines.
    coalescedUtilityBlock: (() => {
      const lines = residentLedgerFixture.split('\n').map((l) => l.trim()).filter(Boolean);
      const dataStart = lines.findIndex((l) => l.includes('Date') && l.includes('Chg Code') && l.includes('Balance'));
      const DATE_PREFIX_REGEX = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+/;
      const blocks: string[] = [];
      for (let i = Math.max(0, dataStart + 1); i < lines.length; i++) {
        const raw = lines[i];
        if (!DATE_PREFIX_REGEX.test(raw)) continue;
        let buf = raw;
        while (i + 1 < lines.length) {
          const next = lines[i + 1];
          if (DATE_PREFIX_REGEX.test(next)) break;
          buf = `${buf}\n${next}`;
          i++;
        }
        blocks.push(buf);
      }
      const util = blocks.find((b) => b.includes('utilele')) || '';
      return util;
    })(),
  };

  const residentDirect = parseResidentLedgerFormat(residentLedgerFixture);
  const residentAi = await analyzeWithAI(residentLedgerFixture);
  const residentProcessed = calculateFinalAmount(residentAi, new Date('2026-01-19'));

  const residentResult = {
    name: 'Resident Ledger (wrapped utilities, noise decimals)',
    period: residentAi.period,
    ledgerEntries: residentAi.ledgerEntries?.length ?? 0,
    rentalCharges: residentAi.rentalCharges.length,
    nonRentalCharges: residentAi.nonRentalCharges.length,
    sampleNonRental: residentAi.nonRentalCharges.slice(0, 5),
    parsedLedgerEntries: (residentAi.ledgerEntries ?? []).slice(0, 10),
    lastZeroOrNegativeBalanceDate: residentProcessed.lastZeroOrNegativeBalanceDate,
    latestBalance: residentProcessed.latestBalance,
    totalNonRentalFromLastZero: residentProcessed.totalNonRentalFromLastZero,
    rentArrears: residentProcessed.rentArrears,
    residentDebug,
    residentDirectSummary: {
      period: residentDirect.period,
      ledgerEntries: residentDirect.ledgerEntries?.length ?? 0,
      rentalCharges: residentDirect.rentalCharges.length,
      nonRentalCharges: residentDirect.nonRentalCharges.length,
      sampleNonRental: residentDirect.nonRentalCharges.slice(0, 3),
      parsedLedgerEntries: (residentDirect.ledgerEntries ?? []).slice(0, 10),
    },
  };

  return NextResponse.json({ ok: true, results, residentResult });
}




