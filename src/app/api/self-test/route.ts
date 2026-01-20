import { NextResponse } from 'next/server';
import { parseLedgerFromText, chargesFromLedgerEntries } from '@/lib/ledger-parser';
import { calculateFinalAmount } from '@/lib/business-logic';
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
      latestBalance: processed.latestBalance,
      lastZeroOrNegativeBalanceDate: processed.lastZeroOrNegativeBalanceDate,
      totalNonRentalFromLastZero: processed.totalNonRentalFromLastZero,
      rentArrears: processed.rentArrears,
    };
  });

  return NextResponse.json({ ok: true, results });
}



