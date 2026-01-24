'use client';

import { useState } from 'react';
import { ProcessedData } from '@/types';
import { Download, Eye, EyeOff, AlertTriangle, CheckCircle, TrendingUp, DollarSign, FileSpreadsheet, Calendar, ChevronDown, ChevronUp } from 'lucide-react';

interface ProcessingResultsProps {
  data: ProcessedData;
  extractedText?: string;
  onDownloadExcel: () => void;
  isGeneratingExcel: boolean;
}

export default function ProcessingResults({ 
  data, 
  extractedText, 
  onDownloadExcel, 
  isGeneratingExcel 
}: ProcessingResultsProps) {
  const [showExtractedText, setShowExtractedText] = useState(false);
  const [showRentalCharges, setShowRentalCharges] = useState(false);
  const [showNonRentalCharges, setShowNonRentalCharges] = useState(false);
  const [showNonRentalFromLastZero, setShowNonRentalFromLastZero] = useState(false);
  const [showCalculationFlow, setShowCalculationFlow] = useState(false);
  const [showStep2Items, setShowStep2Items] = useState(false);
  const [step2Query, setStep2Query] = useState('');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatISODate = (iso?: string) => {
    if (!iso) return 'N/A';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US');
  };

  const getFinalAmountColor = () => {
    if (data.finalRentalAmount > 0) return 'text-red-600';
    if (data.finalRentalAmount < 0) return 'text-emerald-600';
    return 'text-slate-600';
  };

  const getFinalAmountBgColor = () => {
    if (data.finalRentalAmount > 0) return 'from-red-50 to-rose-50 border-red-200';
    if (data.finalRentalAmount < 0) return 'from-emerald-50 to-teal-50 border-emerald-200';
    return 'from-slate-50 to-gray-50 border-slate-200';
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-8">
      {/* Success Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center space-x-3 px-5 py-2.5 bg-emerald-500/15 border border-emerald-400/20 rounded-full mb-4 backdrop-blur">
          <CheckCircle className="w-5 h-5 text-emerald-200" />
          <span className="text-sm font-medium text-emerald-100">Processing complete</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mb-2">Analysis results</h2>
        <p className="text-base sm:text-lg text-slate-300">Your file has been processed and summarized below</p>
      </div>

      {/* Summary Card */}
      <div className="bg-slate-950/35 rounded-2xl shadow-xl p-8 border border-white/10 ring-1 ring-white/10 backdrop-blur">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Financial overview</h3>
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
            <TrendingUp className="w-4 h-4 text-slate-200" />
            <span className="text-xs font-medium text-slate-200">Professional analysis</span>
          </div>
        </div>

        {/* Property Information */}
        <div className="mb-8">
          <h4 className="text-lg sm:text-xl font-semibold text-white flex items-center space-x-2 mb-6">
            <div className="p-2 bg-indigo-500/90 rounded-md ring-1 ring-white/10">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <span>Property Details</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tenant</span>
              <p className="text-lg font-semibold text-white mt-1">{data.tenantName}</p>
            </div>
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Property</span>
              <p className="text-lg font-semibold text-white mt-1">{data.propertyName}</p>
            </div>
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Period</span>
              <p className="text-lg font-semibold text-white mt-1">{data.period}</p>
            </div>
          </div>
        </div>

        {/* Key Financial Metrics - Clean Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Latest Balance Card */}
          <div className="bg-white/5 rounded-2xl shadow-sm p-8 border border-white/10 ring-1 ring-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/7">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xl font-semibold text-white flex items-center space-x-2">
                <div className="p-2 bg-indigo-500/90 rounded-md ring-1 ring-white/10">
                  <DollarSign className="w-6 h-6 text-white" />
                </div>
                <span>Latest Balance</span>
              </h4>
            </div>
            <div className="mt-6">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Current balance</p>
              <p className="text-3xl sm:text-4xl font-semibold text-white">
                {formatCurrency(data.latestBalance !== undefined ? data.latestBalance : data.openingBalance)}
              </p>
              {data.lastZeroOrNegativeBalanceDate && (
                <p className="text-xs text-slate-400 mt-3">
                  Last zero/negative balance: <span className="text-slate-200">{new Date(data.lastZeroOrNegativeBalanceDate).toLocaleDateString('en-US')}</span>
                </p>
              )}
              {!data.lastZeroOrNegativeBalanceDate && (data.ledgerEntries?.length ?? 0) === 0 && (
                <p className="text-xs text-slate-400 mt-3 italic">
                  Using opening balance (ledger entries not available)
                </p>
              )}
              {!data.lastZeroOrNegativeBalanceDate && (data.ledgerEntries?.length ?? 0) > 0 && (
                <p className="text-xs text-slate-400 mt-3 italic">
                  No zero/negative balance found; using ledger entries for latest balance
                </p>
              )}
            </div>
          </div>

          {/* Total Non-Rental Charges Card */}
          <div className="bg-white/5 rounded-2xl shadow-sm p-8 border border-white/10 ring-1 ring-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/7">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xl font-semibold text-white flex items-center space-x-2">
                <div className="p-2 bg-orange-500/90 rounded-md ring-1 ring-white/10">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <span>Total Non-Rental Charges</span>
              </h4>
            </div>
            <div className="mt-6">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                From last zero/negative balance
              </p>
              <p className="text-3xl sm:text-4xl font-semibold text-white">
                {formatCurrency(data.totalNonRentalFromLastZero !== undefined ? data.totalNonRentalFromLastZero : data.totalNonRental)}
              </p>
              <p className="text-xs text-slate-400 mt-3">
                Total non-rental charges: <span className="text-slate-200">{formatCurrency(data.totalNonRental)}</span>
              </p>
              {data.totalNonRentalFromLastZero === undefined && (
                <p className="text-xs text-slate-400 mt-2 italic">
                  Showing all non-rental charges (ledger entries not available)
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Rent Arrears Card - Separate Card */}
        <div className="relative overflow-hidden bg-gradient-to-br from-emerald-500/10 via-white/5 to-indigo-500/10 rounded-2xl shadow-sm p-8 border border-white/10 ring-1 ring-white/10 mb-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_220px_at_30%_0%,rgba(16,185,129,0.25),transparent_60%),radial-gradient(700px_240px_at_70%_120%,rgba(99,102,241,0.18),transparent_55%)]" />
          <div className="flex items-center justify-between mb-4">
            <h4 className="relative text-2xl font-semibold text-white flex items-center space-x-2">
              <div className="p-3 bg-emerald-500/90 rounded-md ring-1 ring-white/10">
                <TrendingUp className="w-7 h-7 text-white" />
              </div>
              <span>Total Rent Arrears</span>
            </h4>
          </div>
          <div className="relative mt-6">
            <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Calculated amount</p>
            <p className={`text-4xl sm:text-5xl font-semibold ${(data.rentArrears !== undefined ? data.rentArrears : data.finalRentalAmount) >= 0 ? 'text-rose-200' : 'text-emerald-200'}`}>
              {formatCurrency(data.rentArrears !== undefined ? data.rentArrears : data.finalRentalAmount)}
            </p>
            <div className="mt-6 p-4 bg-slate-950/40 rounded-xl border border-white/10 ring-1 ring-white/10">
              <p className="text-sm font-semibold text-white mb-2">Calculation formula</p>
              <p className="text-slate-300 font-mono text-sm">
                Rent Arrears = Latest Balance - Total Non-Rental Charges (from last zero/negative)
              </p>
              <p className="text-slate-100 font-mono text-base mt-2">
                {formatCurrency(data.rentArrears !== undefined ? data.rentArrears : data.finalRentalAmount)} = {formatCurrency(data.latestBalance !== undefined ? data.latestBalance : data.openingBalance)} - {formatCurrency(data.totalNonRentalFromLastZero !== undefined ? data.totalNonRentalFromLastZero : data.totalNonRental)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charges Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Rental Charges */}
        <div className="bg-slate-950/35 rounded-2xl shadow-xl p-8 border border-white/10 ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Rental charges</h3>
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                <span className="text-xs font-medium text-slate-200">{data.rentalCharges.length} items</span>
              </div>
              <button
                type="button"
                onClick={() => setShowRentalCharges((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 hover:border-white/20 transition-all duration-200 active:scale-[0.98]"
                aria-expanded={showRentalCharges}
                aria-controls="rental-charges-list"
              >
                <span className="text-xs font-medium text-slate-100">
                  {showRentalCharges ? 'Collapse' : 'Expand'}
                </span>
                {showRentalCharges ? (
                  <ChevronUp className="w-4 h-4 text-slate-200" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-200" />
                )}
              </button>
            </div>
          </div>
          
          {data.rentalCharges.length === 0 ? (
            <div className="text-center py-12">
              <div className="p-4 bg-white/5 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center ring-1 ring-white/10">
                <DollarSign className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-slate-300 italic text-lg">No rental charges found</p>
            </div>
          ) : showRentalCharges ? (
            <div id="rental-charges-list" className="space-y-4">
              {data.rentalCharges.map((charge, index) => (
                <div
                  key={index}
                  className="group p-4 bg-white/5 hover:bg-white/7 rounded-xl border border-white/10 hover:border-white/20 transition-all duration-200"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium text-white transition-colors">
                        {charge.description}
                      </p>
                      {charge.date && (
                        <p className="text-sm text-slate-300 mt-1 flex items-center space-x-1">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          <span className="text-slate-300">{charge.date}</span>
                        </p>
                      )}
                    </div>
                    <div className="ml-4">
                      <span className="text-lg font-semibold text-slate-100">
                        {formatCurrency(charge.amount)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10">
              <p className="text-slate-300 italic"> <span className="text-slate-100 font-medium">Expand</span> to view.</p>
            </div>
          )}
        </div>

        {/* Non-Rental Charges - ALL */}
        <div className="bg-slate-950/35 rounded-2xl shadow-xl p-8 border border-white/10 ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Non‑rental charges</h3>
              <span className="inline-block px-2.5 py-0.5 bg-orange-500/15 text-orange-200 text-xs font-medium rounded-full mt-2 ring-1 ring-orange-400/20">
                Most important
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                <span className="text-xs font-medium text-slate-200">{data.nonRentalCharges.length} items</span>
              </div>
              <button
                type="button"
                onClick={() => setShowNonRentalCharges((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 hover:border-white/20 transition-all duration-200 active:scale-[0.98]"
                aria-expanded={showNonRentalCharges}
                aria-controls="nonrental-charges-list"
              >
                <span className="text-xs font-medium text-slate-100">
                  {showNonRentalCharges ? 'Collapse' : 'Expand'}
                </span>
                {showNonRentalCharges ? (
                  <ChevronUp className="w-4 h-4 text-slate-200" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-200" />
                )}
              </button>
            </div>
          </div>
          
          {data.nonRentalCharges.length === 0 ? (
            <div className="text-center py-12">
              <div className="p-4 bg-white/5 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center ring-1 ring-white/10">
                <DollarSign className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-slate-300 italic text-lg">No non‑rental charges found</p>
            </div>
          ) : showNonRentalCharges ? (
            <div id="nonrental-charges-list" className="space-y-4">
              {data.nonRentalCharges.map((charge, index) => (
                <div
                  key={index}
                  className="group p-4 bg-white/5 hover:bg-white/7 rounded-xl border border-white/10 hover:border-white/20 transition-all duration-200"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium text-white transition-colors">
                        {charge.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-sm text-slate-300">
                        {charge.date && (
                          <div className="flex items-center space-x-1">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            <span className="text-slate-300">{charge.date}</span>
                          </div>
                        )}
                        {charge.category && (
                          <span className="px-2 py-0.5 bg-white/5 text-slate-200 rounded-full text-xs font-medium ring-1 ring-white/10">
                            {charge.category}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-4">
                      <span className="text-lg font-semibold text-slate-100">
                        {formatCurrency(charge.amount)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="border-t border-white/10 pt-4 mt-6">
                <div className="flex justify-between items-center p-4 bg-white/5 rounded-xl border border-white/10">
                  <span className="text-lg font-semibold text-white">Total non‑rental</span>
                  <span className="text-xl sm:text-2xl font-semibold text-white">
                    {formatCurrency(data.totalNonRental)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-10">
              <p className="text-slate-300 italic"> <span className="text-slate-100 font-medium">Expand</span> to view.</p>
            </div>
          )}
        </div>
      </div>

      {/* Non-Rental Charges from Last Zero/Negative Balance */}
      {data.lastZeroOrNegativeBalanceDate && data.totalNonRentalFromLastZero !== undefined && data.totalNonRentalFromLastZero > 0 && (
        <div className="bg-slate-950/35 rounded-2xl shadow-xl p-8 border border-white/10 ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Non‑rental charges (from last zero/negative balance)</h3>
              <p className="text-sm text-slate-400 mt-2">
                Charges after <span className="text-slate-200 font-medium">{new Date(data.lastZeroOrNegativeBalanceDate).toLocaleDateString('en-US')}</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 bg-orange-500/15 rounded-full border border-orange-400/20">
                <span className="text-xs font-medium text-orange-200">
                  {(() => {
                    const step2Items = data.calculationTrace?.step2?.includedItems;
                    if (Array.isArray(step2Items)) return `${step2Items.length} items`;

                    // Fallback: date-only filter
                    const lastZeroDate = new Date(data.lastZeroOrNegativeBalanceDate);
                    const filtered = data.nonRentalCharges.filter((charge) => {
                      if (!charge.date) return false;
                      return new Date(charge.date) > lastZeroDate;
                    });
                    return `${filtered.length} items`;
                  })()}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowNonRentalFromLastZero((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 hover:border-white/20 transition-all duration-200 active:scale-[0.98]"
                aria-expanded={showNonRentalFromLastZero}
                aria-controls="nonrental-from-lastzero-list"
              >
                <span className="text-xs font-medium text-slate-100">
                  {showNonRentalFromLastZero ? 'Collapse' : 'Expand'}
                </span>
                {showNonRentalFromLastZero ? (
                  <ChevronUp className="w-4 h-4 text-slate-200" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-200" />
                )}
              </button>
            </div>
          </div>
          
          {(() => {
            // SOURCE OF TRUTH: Use Step 2's ledger-order included items (not re-filtered nonRentalCharges).
            // This ensures the listing matches the Step 2 total (avoids wrong amounts like late fee base vs actual).
            const step2Items = data.calculationTrace?.step2?.includedItems;
            const items = Array.isArray(step2Items)
              ? step2Items.map((it) => ({
                  description: it.description,
                  amount: it.amount,
                  date: it.date,
                  category: it.category,
                }))
              : (() => {
                  // Fallback: date-only filter on extracted nonRentalCharges (less accurate)
                  const lastZeroDate = new Date(data.lastZeroOrNegativeBalanceDate);
                  return data.nonRentalCharges
                    .filter((charge) => {
                      if (!charge.date) return false;
                      return new Date(charge.date) > lastZeroDate;
                    })
                    .map((c) => ({
                      description: c.description,
                      amount: c.amount,
                      date: c.date,
                      category: c.category,
                    }));
                })();

            if (items.length === 0) {
              return (
                <div className="text-center py-12">
                  <div className="p-4 bg-white/5 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center ring-1 ring-white/10">
                    <AlertTriangle className="w-8 h-8 text-slate-400" />
                  </div>
                  <p className="text-slate-300 italic text-lg">No charges found after last zero/negative balance date</p>
                </div>
              );
            }

            if (!showNonRentalFromLastZero) {
              return (
                <div className="text-center py-10">
                  <p className="text-slate-300 italic"> <span className="text-slate-100 font-medium">Expand</span> to view.</p>
                </div>
              );
            }

            return (
              <div id="nonrental-from-lastzero-list" className="space-y-4">
                {items.map((charge, index) => (
                  <div
                    key={index}
                    className="group p-4 bg-white/5 hover:bg-white/7 rounded-xl border border-white/10 hover:border-white/20 transition-all duration-200"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-medium text-white transition-colors">
                          {charge.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-sm text-slate-300">
                          {charge.date && (
                            <div className="flex items-center space-x-1">
                              <Calendar className="w-4 h-4 text-slate-400" />
                              <span className="text-slate-300">{charge.date}</span>
                            </div>
                          )}
                          {charge.category && (
                            <span className="px-2 py-0.5 bg-white/5 text-slate-200 rounded-full text-xs font-medium ring-1 ring-white/10">
                              {charge.category}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="ml-4">
                        <span className="text-lg font-semibold text-slate-100">
                          {formatCurrency(charge.amount)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="border-t border-white/10 pt-4 mt-6">
                  <div className="flex justify-between items-center p-4 bg-orange-500/10 rounded-xl border border-orange-400/20">
                    <span className="text-lg font-semibold text-white">Total from last zero/negative balance</span>
                    <span className="text-xl sm:text-2xl font-semibold text-orange-200">
                      {formatCurrency(data.totalNonRentalFromLastZero)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Extracted Text Preview */}
      {extractedText && (
        <div className="bg-slate-950/35 rounded-2xl shadow-xl p-8 border border-white/10 ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Document text preview</h3>
            <button
              onClick={() => setShowExtractedText(!showExtractedText)}
              className="flex items-center space-x-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all duration-200 border border-white/10 hover:border-white/20 active:scale-[0.98]"
            >
              {showExtractedText ? <EyeOff className="w-5 h-5 text-slate-200" /> : <Eye className="w-5 h-5 text-slate-200" />}
              <span className="font-medium text-slate-100">{showExtractedText ? 'Hide text' : 'Show text'}</span>
            </button>
          </div>
          
          {showExtractedText && (
            <div className="bg-slate-950/40 p-6 rounded-xl border border-white/10 max-h-96 overflow-y-auto">
              <pre className="text-sm text-slate-200 whitespace-pre-wrap font-mono leading-relaxed">
                {extractedText}
              </pre>
              <div className="mt-4 text-xs text-slate-400">
                Total characters: {extractedText?.length || 0}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Calculation Flow (4 steps) - shown under Document text preview */}
      {data.calculationTrace && (
        <div className="bg-slate-950/35 rounded-2xl shadow-xl p-8 border border-white/10 ring-1 ring-white/10 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Calculation flow (4 steps)</h3>
              <p className="text-sm text-slate-400 mt-1">
                Easy breakdown of where calculation started and which rules were applied.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 bg-white/5 text-slate-200 rounded-full ring-1 ring-white/10">
                  Used as-of: <span className="font-semibold">{data.calculationTrace.asOfDateISO}</span>
                </span>
                {data.calculationTrace.issueDateISO && (
                  <span className="px-2.5 py-1 bg-white/5 text-slate-200 rounded-full ring-1 ring-white/10">
                    Issue date (from ledger): <span className="font-semibold">{data.calculationTrace.issueDateISO}</span>
                  </span>
                )}
                {data.calculationTrace.systemAsOfDateISO && (
                  <span className="px-2.5 py-1 bg-white/5 text-slate-200 rounded-full ring-1 ring-white/10">
                    System date: <span className="font-semibold">{data.calculationTrace.systemAsOfDateISO}</span>
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCalculationFlow((v) => !v)}
              className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 hover:border-white/20 transition-all duration-200 active:scale-[0.98]"
              aria-expanded={showCalculationFlow}
            >
              <span className="text-xs font-medium text-slate-100">
                {showCalculationFlow ? 'Collapse' : 'Expand'}
              </span>
              {showCalculationFlow ? (
                <ChevronUp className="w-4 h-4 text-slate-200" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-200" />
              )}
            </button>
          </div>

          {showCalculationFlow && (
            <div className="mt-6 space-y-4">
              {/* Step 1 */}
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="text-sm font-semibold text-white">Step 1 — Find last zero/negative balance</p>
                {data.calculationTrace.step1.lastZeroOrNegative ? (
                  <p className="text-sm text-slate-300 mt-2">
                    Found at <span className="text-slate-100">{formatISODate(data.calculationTrace.step1.lastZeroOrNegative.date)}</span>{' '}
                    with balance <span className="text-slate-100">{formatCurrency(data.calculationTrace.step1.lastZeroOrNegative.balance)}</span>
                    {data.calculationTrace.step1.lastZeroOrNegative.description ? (
                      <> — <span className="text-slate-200">{data.calculationTrace.step1.lastZeroOrNegative.description}</span></>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-sm text-slate-300 mt-2">
                    {data.calculationTrace.step1.note ?? 'No last zero/negative balance found.'}
                  </p>
                )}
              </div>

              {/* Step 2 */}
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                {(() => {
                  const items = data.calculationTrace.step2.includedItems || [];
                  const q = step2Query.trim().toLowerCase();
                  const filtered = q
                    ? items.filter((it) => {
                        const hay = `${it.description} ${it.category ?? ''}`.toLowerCase();
                        return hay.includes(q);
                      })
                    : items;

                  const counts = filtered.reduce<Record<string, number>>((acc, it) => {
                    const key = it.category ?? 'other';
                    acc[key] = (acc[key] ?? 0) + 1;
                    return acc;
                  }, {});

                  return (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-white">Step 2 — Add up non‑rent charges (from that point onward)</p>
                          <p className="text-sm text-slate-300 mt-2">
                            Method: <span className="text-slate-100">{data.calculationTrace.step2.method}</span> — Included{' '}
                            <span className="text-slate-100">{data.calculationTrace.step2.includedItemsCount}</span> items totaling{' '}
                            <span className="text-slate-100">{formatCurrency(data.calculationTrace.step2.totalNonRent)}</span>.
                          </p>
                          {data.calculationTrace.step2.note && (
                            <p className="text-xs text-slate-400 mt-1">{data.calculationTrace.step2.note}</p>
                          )}
                        </div>
                        {items.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowStep2Items((v) => !v)}
                            className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 hover:border-white/20 transition-all duration-200 active:scale-[0.98]"
                            aria-expanded={showStep2Items}
                          >
                            <span className="text-xs font-medium text-slate-100">
                              {showStep2Items ? 'Hide items' : 'View items'}
                            </span>
                            {showStep2Items ? (
                              <ChevronUp className="w-4 h-4 text-slate-200" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-200" />
                            )}
                          </button>
                        )}
                      </div>

                      {Object.keys(counts).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {Object.entries(counts)
                            .sort((a, b) => b[1] - a[1])
                            .map(([cat, n]) => (
                              <span
                                key={cat}
                                className="px-2.5 py-1 bg-white/5 text-slate-200 rounded-full text-xs font-medium ring-1 ring-white/10"
                                title="Category count in included Step 2 items"
                              >
                                {cat}: {n}
                              </span>
                            ))}
                        </div>
                      )}

                      {showStep2Items && (
                        <div className="mt-4">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <input
                              value={step2Query}
                              onChange={(e) => setStep2Query(e.target.value)}
                              placeholder="Search items (e.g., nsf, returned check, bad_check)"
                              className="w-full px-3 py-2 rounded-lg bg-slate-950/40 border border-white/10 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-white/15"
                            />
                            <span className="shrink-0 text-xs text-slate-400">
                              {filtered.length}/{items.length}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {filtered.map((it, idx) => (
                              <div key={idx} className="p-3 bg-slate-950/40 rounded-lg border border-white/10">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <p className="text-sm text-slate-100 truncate">{it.description}</p>
                                    <p className="text-xs text-slate-400 mt-1">
                                      {formatISODate(it.date)}
                                      {it.category ? (
                                        <span className="ml-2 px-2 py-0.5 bg-white/5 rounded-full ring-1 ring-white/10">
                                          {it.category}
                                        </span>
                                      ) : null}
                                    </p>
                                  </div>
                                  <p className="text-sm font-semibold text-slate-100">{formatCurrency(it.amount)}</p>
                                </div>
                              </div>
                            ))}
                            {filtered.length === 0 && (
                              <p className="text-sm text-slate-400 italic">No items match your search.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Step 3 */}
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="text-sm font-semibold text-white">Step 3 — Identify the correct latest balance</p>
                <p className="text-sm text-slate-300 mt-2">
                  Rule used: <span className="text-slate-100">{data.calculationTrace.step3.rule}</span> — Target month:{' '}
                  <span className="text-slate-100">{data.calculationTrace.step3.targetMonthISO}</span>
                </p>
                <p className="text-sm text-slate-300 mt-1">
                  Latest balance chosen: <span className="text-slate-100">{formatCurrency(data.calculationTrace.step3.latestBalance)}</span>
                  {data.calculationTrace.step3.selectedEntry ? (
                    <> (from {formatISODate(data.calculationTrace.step3.selectedEntry.date)})</>
                  ) : null}
                </p>
                {data.calculationTrace.step3.note && (
                  <p className="text-xs text-slate-400 mt-1">{data.calculationTrace.step3.note}</p>
                )}
              </div>

              {/* Step 4 */}
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="text-sm font-semibold text-white">Step 4 — Calculate rent arrears</p>
                <p className="text-sm text-slate-300 mt-2">Rent Arrears = Latest Balance − Non‑rent Total</p>
                <p className="text-slate-100 font-mono text-base mt-2">
                  {formatCurrency(data.calculationTrace.step4.rentArrears)} = {formatCurrency(data.calculationTrace.step3.latestBalance)} − {formatCurrency(data.calculationTrace.step2.totalNonRent)}
                </p>
                <p className="text-xs text-slate-400 mt-1 font-mono">{data.calculationTrace.step4.formulaHuman}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Download Excel Button */}
      <div className="text-center">
        <button
          onClick={onDownloadExcel}
          disabled={isGeneratingExcel}
          className="group inline-flex items-center space-x-3 px-8 py-4 rounded-2xl
            bg-gradient-to-r from-emerald-500/90 to-teal-500/90 hover:from-emerald-500 hover:to-teal-500
            disabled:from-slate-500 disabled:to-slate-500
            text-white font-semibold text-lg
            shadow-xl shadow-emerald-500/10
            ring-1 ring-white/10 hover:ring-white/20
            transition-all duration-200 ease-out
            hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]
            disabled:hover:translate-y-0 disabled:active:scale-100
          "
        >
          {isGeneratingExcel ? (
            <>
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              <span>Generating Excel Report...</span>
            </>
          ) : (
            <>
              <div className="p-2 bg-white/15 rounded-xl ring-1 ring-white/15">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <span>Download Excel report</span>
              <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />
            </>
          )}
        </button>
        <p className="text-slate-300 mt-4 text-sm">
          Includes summary, rental charges, and non‑rental charges sheets
        </p>
      </div>
    </div>
  );
}