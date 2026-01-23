"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const huggingface_client_1 = require("../src/lib/huggingface-client");
const business_logic_1 = require("../src/lib/business-logic");
// Minimal sample reproducing the issue:
// - Issue date: 04/25/2025 (Date: header)
// - Latest in-month row is a PAYMENT (04/17) with balance 7,576.17 (should NOT be chosen)
// - Post-issue lockout rows on 05/01 reference earlier dates (Mar 13) and should be considered for "current balance due"
const text = `
Resident Ledger
Date: 04/25/2025
Date  Chg Code  Description  Charge  Payment  Balance  Chg/Rec
04/01/2025  keyinc  Feb 27, 2025 01:20:00 Lockout  50.00  0.00  7576.16  999534
04/17/2025  chk#    City of NY 40773577  0.00  512.56  7576.17  726785
05/01/2025  keyinc  Mar 30, 2025 04:04 AM Lockout  100.00  0.00  7676.17  1006246
05/01/2025  keyinc  Mar 21, 2025 20:45 PM Lockout  75.00  0.00  7751.17  1006247
05/01/2025  keyinc  Mar 13, 2025 22:30 PM Lockout  75.00  0.00  7826.17  1006248
`.trim();
const ai = (0, huggingface_client_1.parsePDFTextDirectly)(text);
const processed = (0, business_logic_1.calculateFinalAmount)(ai, new Date('2026-01-19'));
console.log(JSON.stringify({
    issueDate: ai.issueDate,
    ledgerEntriesCount: ai.ledgerEntries?.length ?? 0,
    lastLedgerDate: ai.ledgerEntries?.at(-1)?.date,
    ledgerEntriesSample: (ai.ledgerEntries ?? []).map((e) => ({
        date: e.date,
        description: e.description,
        debit: e.debit ?? 0,
        credit: e.credit ?? 0,
        balance: e.balance,
    })),
    step3: processed.calculationTrace?.step3,
    latestBalance: processed.latestBalance,
}, null, 2));
