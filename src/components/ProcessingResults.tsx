'use client';

import { useState } from 'react';
import { ProcessedData } from '@/types';
import { Download, Eye, EyeOff, AlertTriangle, CheckCircle, TrendingUp, DollarSign, FileSpreadsheet, Calendar } from 'lucide-react';

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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
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
        <div className="inline-flex items-center space-x-3 px-5 py-2.5 bg-emerald-50 border border-emerald-200 rounded-full mb-4">
          <CheckCircle className="w-5 h-5 text-emerald-700" />
          <span className="text-sm font-medium text-emerald-800">Processing Complete</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-slate-900 mb-2">Analysis Results</h2>
        <p className="text-base sm:text-lg text-slate-600">Your rental arrears document has been successfully processed</p>
      </div>

      {/* Summary Card */}
      <div className="bg-white rounded-2xl shadow-sm p-8 border border-slate-200">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl sm:text-2xl font-semibold text-slate-900">Financial Overview</h3>
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 bg-slate-100 rounded-full border border-slate-200">
            <TrendingUp className="w-4 h-4 text-slate-700" />
            <span className="text-xs font-medium text-slate-700">Professional Analysis</span>
          </div>
        </div>

        {/* Property Information */}
        <div className="mb-8">
          <h4 className="text-lg sm:text-xl font-semibold text-slate-900 flex items-center space-x-2 mb-6">
            <div className="p-2 bg-blue-600 rounded-md">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <span>Property Details</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Tenant</span>
              <p className="text-lg font-bold text-slate-900 mt-1">{data.tenantName}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Property</span>
              <p className="text-lg font-bold text-slate-900 mt-1">{data.propertyName}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-sm font-semibold text-slate-600 uppercase tracking-wide">Period</span>
              <p className="text-lg font-bold text-slate-900 mt-1">{data.period}</p>
            </div>
          </div>
        </div>

        {/* Key Financial Metrics - Clean Dashboard */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Latest Balance Card */}
          <div className="bg-blue-50 rounded-xl shadow-sm p-8 border border-blue-200">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xl font-semibold text-slate-900 flex items-center space-x-2">
                <div className="p-2 bg-blue-600 rounded-md">
                  <DollarSign className="w-6 h-6 text-white" />
                </div>
                <span>Latest Balance</span>
              </h4>
            </div>
            <div className="mt-6">
              <p className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2">Current Balance</p>
              <p className="text-3xl sm:text-4xl font-bold text-blue-900">
                {formatCurrency(data.latestBalance !== undefined ? data.latestBalance : data.openingBalance)}
              </p>
              {data.lastZeroOrNegativeBalanceDate && (
                <p className="text-xs text-slate-600 mt-3">
                  Last zero/negative balance: {new Date(data.lastZeroOrNegativeBalanceDate).toLocaleDateString()}
                </p>
              )}
              {!data.lastZeroOrNegativeBalanceDate && (
                <p className="text-xs text-slate-500 mt-3 italic">
                  Using opening balance (ledger entries not available)
                </p>
              )}
            </div>
          </div>

          {/* Total Non-Rental Charges Card */}
          <div className="bg-orange-50 rounded-xl shadow-sm p-8 border border-orange-200">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-xl font-semibold text-slate-900 flex items-center space-x-2">
                <div className="p-2 bg-orange-600 rounded-md">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <span>Total Non-Rental Charges</span>
              </h4>
            </div>
            <div className="mt-6">
              <p className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2">
                From Last Zero/Negative Balance
              </p>
              <p className="text-3xl sm:text-4xl font-bold text-orange-900">
                {formatCurrency(data.totalNonRentalFromLastZero !== undefined ? data.totalNonRentalFromLastZero : data.totalNonRental)}
              </p>
              <p className="text-xs text-slate-600 mt-3">
                Total non-rental charges: {formatCurrency(data.totalNonRental)}
              </p>
              {data.totalNonRentalFromLastZero === undefined && (
                <p className="text-xs text-slate-500 mt-2 italic">
                  Showing all non-rental charges (ledger entries not available)
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Rent Arrears Card - Separate Card */}
        <div className="bg-emerald-50 rounded-xl shadow-sm p-8 border border-emerald-200 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-2xl font-semibold text-slate-900 flex items-center space-x-2">
              <div className="p-3 bg-emerald-600 rounded-md">
                <TrendingUp className="w-7 h-7 text-white" />
              </div>
              <span>Total Rent Arrears</span>
            </h4>
          </div>
          <div className="mt-6">
            <p className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-2">Calculated Amount</p>
            <p className={`text-4xl sm:text-5xl font-bold ${(data.rentArrears !== undefined ? data.rentArrears : data.finalRentalAmount) >= 0 ? 'text-red-700' : 'text-emerald-700'}`}>
              {formatCurrency(data.rentArrears !== undefined ? data.rentArrears : data.finalRentalAmount)}
            </p>
            <div className="mt-6 p-4 bg-white rounded-lg border border-emerald-200">
              <p className="text-sm font-semibold text-emerald-800 mb-2">Calculation Formula:</p>
              <p className="text-emerald-700 font-mono text-sm">
                Rent Arrears = Latest Balance - Total Non-Rental Charges (from last zero/negative)
              </p>
              <p className="text-emerald-800 font-mono text-base mt-2">
                {formatCurrency(data.rentArrears !== undefined ? data.rentArrears : data.finalRentalAmount)} = {formatCurrency(data.latestBalance !== undefined ? data.latestBalance : data.openingBalance)} - {formatCurrency(data.totalNonRentalFromLastZero !== undefined ? data.totalNonRentalFromLastZero : data.totalNonRental)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Charges Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Rental Charges */}
        <div className="bg-white rounded-2xl shadow-sm p-8 border border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl sm:text-2xl font-semibold text-slate-900">Rental Charges</h3>
            <div className="px-3 py-1.5 bg-slate-100 rounded-full border border-slate-200">
              <span className="text-xs font-medium text-slate-700">{data.rentalCharges.length} Items</span>
            </div>
          </div>
          
          {data.rentalCharges.length > 0 ? (
            <div className="space-y-4">
              {data.rentalCharges.map((charge, index) => (
                <div key={index} className="group p-4 bg-slate-50 hover:bg-blue-50 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors duration-150">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium text-slate-900 group-hover:text-blue-900 transition-colors">
                        {charge.description}
                      </p>
                      {charge.date && (
                        <p className="text-sm text-slate-600 mt-1 flex items-center space-x-1">
                          <Calendar className="w-4 h-4" />
                          <span>{charge.date}</span>
                        </p>
                      )}
                    </div>
                    <div className="ml-4">
                      <span className="text-lg font-semibold text-slate-900 group-hover:text-blue-900 transition-colors">
                        {formatCurrency(charge.amount)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="p-4 bg-slate-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <DollarSign className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-slate-500 italic text-lg">No rental charges found</p>
            </div>
          )}
        </div>

        {/* Non-Rental Charges - MOST IMPORTANT */}
        <div className="bg-orange-50 rounded-2xl shadow-sm p-8 border border-orange-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl sm:text-2xl font-semibold text-orange-900">Non-Rental Charges</h3>
              <span className="inline-block px-2.5 py-0.5 bg-orange-200 text-orange-900 text-xs font-medium rounded-full mt-2">
                MOST IMPORTANT
              </span>
            </div>
            <div className="px-3 py-1.5 bg-orange-100 rounded-full border border-orange-200">
              <span className="text-xs font-medium text-orange-900">{data.nonRentalCharges.length} Items</span>
            </div>
          </div>
          
          {data.nonRentalCharges.length > 0 ? (
            <div className="space-y-4">
              {data.nonRentalCharges.map((charge, index) => (
                <div key={index} className="group p-4 bg-white hover:bg-orange-50 rounded-lg border border-orange-200 hover:border-orange-300 transition-colors duration-150">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium text-slate-900 group-hover:text-orange-900 transition-colors">
                        {charge.description}
                      </p>
                      <div className="flex items-center space-x-4 mt-2 text-sm text-slate-600">
                        {charge.date && (
                          <div className="flex items-center space-x-1">
                            <Calendar className="w-4 h-4" />
                            <span>{charge.date}</span>
                          </div>
                        )}
                        {charge.category && (
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded-full text-xs font-medium">
                            {charge.category}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-4">
                      <span className="text-lg font-semibold text-orange-900 group-hover:text-orange-900 transition-colors">
                        {formatCurrency(charge.amount)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="border-t border-orange-300 pt-4 mt-6">
                <div className="flex justify-between items-center p-4 bg-orange-100 rounded-lg">
                  <span className="text-lg font-semibold text-orange-900">Total Non-Rental:</span>
                  <span className="text-xl sm:text-2xl font-bold text-orange-900">
                    {formatCurrency(data.totalNonRental)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="p-4 bg-orange-100 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <DollarSign className="w-8 h-8 text-orange-400" />
              </div>
              <p className="text-orange-600 italic text-lg">No non-rental charges found</p>
            </div>
          )}
        </div>
      </div>

      {/* Extracted Text Preview */}
      {extractedText && (
        <div className="bg-white rounded-2xl shadow-sm p-8 border border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl sm:text-2xl font-semibold text-slate-900">Document Text Preview</h3>
            <button
              onClick={() => setShowExtractedText(!showExtractedText)}
              className="flex items-center space-x-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors duration-150 border border-slate-300"
            >
              {showExtractedText ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              <span className="font-medium">{showExtractedText ? 'Hide Text' : 'Show Text'}</span>
            </button>
          </div>
          
          {showExtractedText && (
            <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 max-h-96 overflow-y-auto">
              <pre className="text-sm text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">
                {extractedText}
              </pre>
              <div className="mt-4 text-xs text-slate-500">
                Total characters: {extractedText?.length || 0}
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
          className="group inline-flex items-center space-x-3 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-medium text-lg rounded-xl shadow-sm transition-colors"
        >
          {isGeneratingExcel ? (
            <>
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              <span>Generating Excel Report...</span>
            </>
          ) : (
            <>
              <div className="p-2 bg-white/20 rounded-lg">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <span>Download Professional Excel Report</span>
              <Download className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />
            </>
          )}
        </button>
        <p className="text-slate-600 mt-4 text-sm">
          Complete analysis with rental charges, non-rental charges, and summary sheets
        </p>
      </div>
    </div>
  );
}