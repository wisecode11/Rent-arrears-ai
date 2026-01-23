"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateFinalAmount = calculateFinalAmount;
exports.validateProcessedData = validateProcessedData;
const ledger_parser_1 = require("@/lib/ledger-parser");
function normalizeDesc(input) {
    return (input ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function isSecurityDepositLike(description) {
    const d = normalizeDesc(description);
    if (d.includes('security deposit') || d.includes('security deposits') || d.includes('secdep'))
        return true;
    const cls = (0, ledger_parser_1.classifyDescription)(description ?? '');
    return cls.category === 'security_deposit';
}
/**
 * Heuristic: If a ledger shows multiple security-deposit-related rows and later evidence indicates the
 * deposit was settled (e.g., refunded/reversed or explicitly zeroed), then we should treat that deposit
 * as paid/settled and exclude it from non-rental totals.
 *
 * Why: security deposits are often tracked as a separate bucket and may be paid/cleared later; users
 * don't want a previously-settled deposit inflating "non-rental charges".
 */
function shouldIgnoreSecurityDepositCharges(ledgerEntries) {
    if (!ledgerEntries || ledgerEntries.length === 0)
        return false;
    const idxs = [];
    for (let i = 0; i < ledgerEntries.length; i++) {
        if (isSecurityDepositLike(ledgerEntries[i].description ?? ''))
            idxs.push(i);
    }
    // If only one deposit row exists, keep it (caller may still want to count it).
    if (idxs.length < 2)
        return false;
    const firstIdx = idxs[0];
    for (const i of idxs) {
        if (i <= firstIdx)
            continue;
        const e = ledgerEntries[i];
        const d = normalizeDesc(e.description ?? '');
        const hasSettlementKeyword = d.includes('refund') || d.includes('return') || d.includes('reversal') || d.includes('reversed') || d.includes('reclass');
        const credit = e.credit ?? 0;
        const debit = e.debit ?? 0;
        const bal = e.balance ?? 0;
        const explicitZeroed = debit === 0 && credit === 0 && bal === 0;
        // Treat as settled if we see explicit reversal/refund/reclass wording, a credit on a deposit row,
        // or an explicit "0" style deposit row.
        if (hasSettlementKeyword || credit > 0 || explicitZeroed)
            return true;
    }
    return false;
}
/**
 * Apply core business logic for rental arrears calculation
 * Implements 4-step calculation rules:
 * 1. Find the last zero or negative balance
 * 2. Add up non-rent charges from that point onward
 * 3. Identify the correct latest balance (based on date)
 * 4. Calculate rent arrears = latest balance - total non-rent charges
 */
function pickLatestBalanceByDateRule(ledgerEntries, asOfDate) {
    if (!ledgerEntries.length)
        return 0;
    // Sort newest first
    const sorted = [...ledgerEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const day = asOfDate.getDate();
    const month = asOfDate.getMonth();
    const year = asOfDate.getFullYear();
    const targetMonth = day >= 1 && day <= 5 ? (month === 0 ? 11 : month - 1) : month;
    const targetYear = day >= 1 && day <= 5 && month === 0 ? year - 1 : year;
    // Find latest entry within the target month/year
    const inTarget = sorted.find((entry) => {
        const d = new Date(entry.date);
        return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
    });
    if (inTarget)
        return inTarget.balance;
    // Fallbacks:
    // - If we're 1st-5th and there's no entry in the previous month, use the latest entry before current month.
    if (day >= 1 && day <= 5) {
        const beforeCurrentMonth = sorted.find((entry) => {
            const d = new Date(entry.date);
            return d.getFullYear() < year || (d.getFullYear() === year && d.getMonth() < month);
        });
        if (beforeCurrentMonth)
            return beforeCurrentMonth.balance;
    }
    // Otherwise, just use the most recent known balance.
    return sorted[0].balance;
}
function pickLatestBalanceEntryByDateRule(ledgerEntries, asOfDate, options) {
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
    // Client rule (strict):
    // - day 1-5 => use previous month
    // - day 6+ => use current month
    // Any "future-dated" ledger entries should be filtered BEFORE calling this function
    // (using Issue Date cutoff when available).
    // IMPORTANT: Many ledgers have multiple rows on the same date. We must pick the *last*
    // non-rent balance within the chosen month, not an earlier same-day item.
    // We use the original array order as a tie-breaker (later index = later row).
    const rowIndex = new Map();
    for (let i = 0; i < ledgerEntries.length; i++)
        rowIndex.set(ledgerEntries[i], i);
    const sortedNewest = [...ledgerEntries].sort((a, b) => {
        const da = new Date(a.date).getTime();
        const db = new Date(b.date).getTime();
        if (da !== db)
            return db - da; // newest date first
        const ia = rowIndex.get(a) ?? 0;
        const ib = rowIndex.get(b) ?? 0;
        return ib - ia; // later row first
    });
    const usePrevMonth = !options?.forceCurrentMonth && day >= 1 && day <= 5;
    const initialTargetMonth = usePrevMonth ? (month === 0 ? 11 : month - 1) : month;
    const initialTargetYear = usePrevMonth && month === 0 ? year - 1 : year;
    const isRentEntry = (entry) => {
        if (entry.isRental === true)
            return true;
        const cls = (0, ledger_parser_1.classifyDescription)(entry.description ?? '');
        return cls.isRentalCharge === true;
    };
    // Preferred selection:
    // - Pick the latest row in the target month.
    // - If there is a non-rent row in that month, prefer the latest non-rent row (helps when ledgers
    //   have many same-month lines and we want a balance after a non-rent event like a payment/fee).
    // - If the month has entries but ALL are rent, still use the latest rent row (this matches
    //   statement "current balance due" behavior and avoids stepping back to earlier months).
    const findLatestNonRentInMonth = (yy, mm0) => {
        // sortedNewest already orders by (date desc, row order desc), so first match is the latest row.
        return sortedNewest.find((entry) => {
            const d = new Date(entry.date);
            return d.getFullYear() === yy && d.getMonth() === mm0 && !isRentEntry(entry);
        });
    };
    const findLatestAnyInMonth = (yy, mm0) => {
        return sortedNewest.find((entry) => {
            const d = new Date(entry.date);
            return d.getFullYear() === yy && d.getMonth() === mm0;
        });
    };
    // Try the target month first; if no entries exist for that month, step back month-by-month (max 24 months).
    let targetMonth = initialTargetMonth;
    let targetYear = initialTargetYear;
    let selected;
    let skippedEmptyMonths = 0;
    let usedRentOnlyMonth = false;
    for (let guard = 0; guard < 24; guard++) {
        const latestAny = findLatestAnyInMonth(targetYear, targetMonth);
        if (latestAny) {
            const latestNonRent = findLatestNonRentInMonth(targetYear, targetMonth);
            selected = latestNonRent ?? latestAny;
            usedRentOnlyMonth = !latestNonRent && isRentEntry(latestAny);
            break;
        }
        skippedEmptyMonths++;
        // Step back one month.
        targetMonth -= 1;
        if (targetMonth < 0) {
            targetMonth = 11;
            targetYear -= 1;
        }
    }
    const targetMonthISO = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;
    if (selected) {
        const notes = [];
        if (skippedEmptyMonths > 0)
            notes.push(`Skipped ${skippedEmptyMonths} empty month(s) with no ledger rows.`);
        if (usedRentOnlyMonth)
            notes.push('Target month had only rent rows; used the latest rent balance for that month.');
        return {
            rule: usePrevMonth ? 'prev-month-if-day-1-5' : 'current-month-if-day-6+',
            targetMonthISO,
            selected,
            note: notes.length ? notes.join(' ') : undefined,
        };
    }
    if (usePrevMonth) {
        const beforeCurrentMonth = sortedNewest.find((entry) => !isRentEntry(entry));
        return {
            rule: 'prev-month-if-day-1-5',
            targetMonthISO,
            selected: beforeCurrentMonth ?? sortedNewest[0],
            note: 'No non-rent balance found in target/previous months; used the most recent known balance.',
        };
    }
    return {
        rule: 'current-month-if-day-6+',
        targetMonthISO,
        selected: sortedNewest.find((entry) => !isRentEntry(entry)) ?? sortedNewest[0],
        note: 'No non-rent balance found in target months; used the most recent known balance.',
    };
}
function calculateFinalAmount(aiData, asOfDate = new Date()) {
    // Stable ledger ordering for "from that point onward" logic
    const sortedLedgerEntries = aiData.ledgerEntries && aiData.ledgerEntries.length > 0
        ? [...aiData.ledgerEntries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        : undefined;
    // If ledger indicates security deposits were settled, exclude them from non-rental totals/lists.
    const ignoreSecurityDeposits = sortedLedgerEntries ? shouldIgnoreSecurityDepositCharges(sortedLedgerEntries) : false;
    const filteredNonRentalCharges = ignoreSecurityDeposits
        ? (aiData.nonRentalCharges ?? []).filter((c) => {
            const desc = normalizeDesc(c.description ?? '');
            return c.category !== 'security_deposit' && !desc.includes('security deposit') && !desc.includes('security deposits');
        })
        : aiData.nonRentalCharges;
    // Calculate total non-rental charges (ALL charges from beginning to end)
    // Example: If there are charges from 2019 to 2025, this sums ALL of them
    // This is the $8,675.00 shown as "Total non-rental charges"
    const totalNonRental = (filteredNonRentalCharges ?? []).reduce((sum, charge) => sum + Math.abs(charge.amount), 0);
    // Effective as-of date for Step 3:
    // - Prefer Issue Date when available (statement date).
    // - Otherwise, if we have ledger entries, use the latest ledger transaction date (statement "as-of" proxy).
    // - Otherwise use runtime date (asOfDate param, typically today).
    const systemAsOfDateISO = asOfDate.toISOString().split('T')[0];
    const extractedIssueDateISO = aiData.issueDate;
    const extractedIssueDateObj = extractedIssueDateISO ? new Date(extractedIssueDateISO) : undefined;
    const extractedIssueDateValid = extractedIssueDateObj && !Number.isNaN(extractedIssueDateObj.getTime());
    // Guardrail: sometimes a PDF parse accidentally treats a transaction-row date (e.g. a last-zero date)
    // as the "issue date". If that happens, Step 3 will filter out newer ledger rows and incorrectly
    // show a latest balance of $0.00. If the extracted issue date is *far* older than the newest ledger
    // row, ignore it.
    let issueDateUsed = Boolean(extractedIssueDateValid);
    if (issueDateUsed && sortedLedgerEntries && sortedLedgerEntries.length > 0) {
        const newestLedgerDateObj = new Date(sortedLedgerEntries[sortedLedgerEntries.length - 1].date);
        const daysBehind = (newestLedgerDateObj.getTime() - extractedIssueDateObj.getTime()) / (1000 * 60 * 60 * 24);
        // Allow normal statement cutoffs (e.g. issue date in prior month while next-month rent appears),
        // but reject obviously-wrong dates that are months/years behind the statement.
        if (daysBehind > 120) {
            issueDateUsed = false;
        }
    }
    const issueDateISO = issueDateUsed ? extractedIssueDateISO : undefined;
    const issueDateObj = issueDateUsed ? extractedIssueDateObj : undefined;
    const issueDateValid = Boolean(issueDateUsed && issueDateObj && !Number.isNaN(issueDateObj.getTime()));
    const latestLedgerDateObj = sortedLedgerEntries && sortedLedgerEntries.length > 0
        ? new Date(sortedLedgerEntries[sortedLedgerEntries.length - 1].date)
        : undefined;
    const latestLedgerDateValid = Boolean(latestLedgerDateObj && !Number.isNaN(latestLedgerDateObj.getTime()));
    const effectiveAsOfDate = issueDateValid
        ? issueDateObj
        : latestLedgerDateValid
            ? latestLedgerDateObj
            : asOfDate;
    // Step 1: Find the last zero or negative balance
    // This finds the most recent date when balance was $0.00 or negative
    // Example: "Last zero/negative balance: 04/06/2024"
    let lastZeroOrNegativeBalanceDate;
    let lastZeroOrNegativeBalance;
    let lastZeroOrNegativeIndex;
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
    let nonRentMethod = 'all-nonrental-fallback';
    let nonRentItems = [];
    let nonRentNote;
    // Preferred: ledger-order calculation (matches "from that point onward" even within the same date)
    if (typeof lastZeroOrNegativeIndex === 'number' && sortedLedgerEntries && sortedLedgerEntries.length > 0) {
        nonRentMethod = 'ledger-order';
        // Count only entries AFTER the last <= 0 balance row.
        for (let i = lastZeroOrNegativeIndex + 1; i < sortedLedgerEntries.length; i++) {
            const entry = sortedLedgerEntries[i];
            const debit = entry.debit ?? 0;
            if (debit <= 0)
                continue;
            // Payments/credits should not be counted here.
            const cls = (0, ledger_parser_1.classifyDescription)(entry.description);
            // Balance-forward/opening-balance rows should never be treated as charges.
            const isPaymentLike = cls.isPayment || cls.isBalanceForward || (entry.credit ?? 0) > 0;
            if (isPaymentLike)
                continue;
            // Only exclude clear rent charges; everything else counts toward non-rent.
            const isRentLike = entry.isRental === true || cls.isRentalCharge;
            if (isRentLike)
                continue;
            // If security deposits were later settled, exclude them from non-rent totals.
            if (ignoreSecurityDeposits && cls.category === 'security_deposit')
                continue;
            totalNonRentalFromLastZero += Math.abs(debit);
            nonRentItems.push({
                date: entry.date,
                description: entry.description,
                amount: Math.abs(debit),
                category: cls.category && cls.category !== 'rent' ? cls.category : undefined,
                ledgerIndex: i,
            });
        }
    }
    else if (lastZeroOrNegativeBalanceDate) {
        // Backup: date-only filter (inclusive)
        nonRentMethod = 'date-only';
        nonRentNote = 'Ledger ordering unavailable; used date-only filter (inclusive).';
        const lastZeroDate = new Date(lastZeroOrNegativeBalanceDate);
        const included = (filteredNonRentalCharges ?? []).filter((c) => c.date && new Date(c.date) >= lastZeroDate);
        totalNonRentalFromLastZero = included.reduce((sum, c) => sum + Math.abs(c.amount), 0);
        nonRentItems = included.map((c) => ({
            date: c.date ?? lastZeroOrNegativeBalanceDate,
            description: c.description,
            amount: Math.abs(c.amount),
            category: c.category,
        }));
    }
    else {
        // Fallback: if no ledger entries or last zero date, use all non-rental charges
        nonRentMethod = 'all-nonrental-fallback';
        nonRentNote = 'No ledger entries / no last-zero date; using all non-rental charges.';
        totalNonRentalFromLastZero = totalNonRental;
        nonRentItems = (filteredNonRentalCharges ?? []).map((c) => ({
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
    let step3Rule = effectiveAsOfDate.getDate() >= 1 && effectiveAsOfDate.getDate() <= 5 ? 'prev-month-if-day-1-5' : 'current-month-if-day-6+';
    let step3TargetMonthISO = `${effectiveAsOfDate.getFullYear()}-${String(effectiveAsOfDate.getMonth() + 1).padStart(2, '0')}`;
    let step3SelectedEntry;
    let step3Note;
    console.log('Balance extraction - Input data:', {
        finalBalance: aiData.finalBalance,
        openingBalance: aiData.openingBalance,
        ledgerEntriesCount: aiData.ledgerEntries?.length || 0
    });
    if (sortedLedgerEntries && sortedLedgerEntries.length > 0) {
        // CRITICAL: If we have an Issue Date, Step 3 must not use future-dated ledger rows.
        // Many ledgers include next-month RENT rows even when the statement Issue Date is in the prior month.
        // Example: Issue Date 04/28/2025 but a 05/01/2025 rent row exists. We must not pick that balance.
        const step3LedgerEntries = issueDateValid
            ? sortedLedgerEntries.filter((e) => new Date(e.date).getTime() <= issueDateObj.getTime())
            : sortedLedgerEntries;
        const omittedForIssueDate = issueDateValid ? sortedLedgerEntries.length - step3LedgerEntries.length : 0;
        // IMPORTANT: Step 3 should respect Issue Date when provided.
        // If the ledger contains future rent rows (e.g., next month rent posted) we should not
        // advance the "latest balance" month beyond the statement Issue Date.
        const picked = pickLatestBalanceEntryByDateRule(step3LedgerEntries, effectiveAsOfDate, { forceCurrentMonth: false });
        step3Rule = picked.rule;
        step3TargetMonthISO = picked.targetMonthISO;
        const noteParts = [];
        if (omittedForIssueDate > 0) {
            noteParts.push(`Ignored ${omittedForIssueDate} future-dated ledger row(s) after Issue Date (${issueDateISO}) for latest-balance selection.`);
        }
        if (picked.note)
            noteParts.push(picked.note);
        step3Note = noteParts.length ? noteParts.join(' ') : undefined;
        if (picked.selected) {
            step3SelectedEntry = {
                date: picked.selected.date,
                balance: picked.selected.balance,
                description: picked.selected.description,
            };
            latestBalance = picked.selected.balance;
        }
        else {
            latestBalance = pickLatestBalanceByDateRule(step3LedgerEntries, effectiveAsOfDate);
        }
        console.log('✅ Picked latest balance from ledger entries (date rule applied):', latestBalance);
    }
    else {
        // If no ledger entries, we can't apply the month rule reliably; use finalBalance if present, else openingBalance.
        if (typeof aiData.finalBalance === 'number' && !isNaN(aiData.finalBalance)) {
            latestBalance = aiData.finalBalance;
            step3Note = 'No ledger entries; using finalBalance as latest balance.';
            console.log('⚠️ No ledger entries; using finalBalance as latestBalance fallback:', latestBalance);
        }
        else {
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
    const calculationTrace = {
        asOfDateISO: effectiveAsOfDate.toISOString().split('T')[0],
        systemAsOfDateISO,
        issueDateISO,
        step1: {
            lastZeroOrNegative: typeof lastZeroOrNegativeIndex === 'number' && sortedLedgerEntries
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
        nonRentalCharges: filteredNonRentalCharges ?? [],
        totalNonRental,
        finalRentalAmount,
        // New fields
        ledgerEntries: aiData.ledgerEntries,
        lastZeroOrNegativeBalanceDate,
        latestBalance: finalLatestBalance,
        totalNonRentalFromLastZero: finalTotalNonRentalFromLastZero,
        rentArrears: finalLatestBalance - finalTotalNonRentalFromLastZero,
        calculationTrace,
        issueDate: issueDateISO,
    };
}
/**
 * Validate processed data for completeness and accuracy
 */
function validateProcessedData(data) {
    const errors = [];
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
