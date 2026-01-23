import { parsePDFTextDirectly } from '../src/lib/huggingface-client';
import { calculateFinalAmount } from '../src/lib/business-logic';

const text = `
FROM:
Fort Hamilton Apartments, Llc
2753 CONEY ISLAND AVENUE
SUITE 215
BROOKLYN, NY 11235
TO:
Kim Walsh
8220 FORT HAMILTON PARKWAY Apt:4J
BROOKLYN, NY 11209
Re:
STATEMENT
8220 FORT HAMILTON PARKWAY, BROOKLYN, NY 11209,
Apt/Unit No.  4J
AMOUNT     AMOUNT    BALANCE
DATE           DESCRIPTION                         BILLED     PAID      DUE
===================================================================================
07/01/2015   1 BASE RENT :                            1525.00               1525.00
07/01/2015  25 AIR CONDITIONER :                        10.00               1535.00
07/23/2015     PAYMENT CH#:159                                   1525.00      10.00
09/01/2025   1 BASE RENT :                            1886.61               5736.05
09/09/2025     PAYMENT CH#:199                                   1886.61    3849.44
10/01/2025   1 BASE RENT :
1886.61               5736.05
TOTAL  234345.71  228609.66    5736.05
`.trim();

const ai = parsePDFTextDirectly(text);
const processed = calculateFinalAmount(ai as any, new Date('2026-01-19'));

console.log(
  JSON.stringify(
    {
      issueDate: (ai as any).issueDate,
      ledgerEntriesCount: ai.ledgerEntries?.length ?? 0,
      lastLedgerDate: ai.ledgerEntries?.at(-1)?.date,
      step3: processed.calculationTrace?.step3,
      latestBalance: processed.latestBalance,
    },
    null,
    2
  )
);


