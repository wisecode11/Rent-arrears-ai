'use client';

import { AlertCircle, RefreshCw, XCircle, Lightbulb } from 'lucide-react';

interface ErrorDisplayProps {
  error: string;
  onRetry?: () => void;
}

export default function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="bg-slate-950/35 border border-white/10 rounded-2xl p-8 shadow-xl ring-1 ring-white/10 backdrop-blur">
        <div className="flex items-start space-x-4">
          <div className="p-2.5 bg-rose-500/15 rounded-xl ring-1 ring-rose-400/20">
            <XCircle className="w-7 h-7 text-rose-200" />
          </div>
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-3">
              <h3 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Processing error</h3>
              <div className="px-2.5 py-0.5 bg-rose-500/15 text-rose-200 text-xs font-medium rounded-full ring-1 ring-rose-400/20">
                Action Required
              </div>
            </div>
            
            <div className="bg-white/5 p-4 rounded-xl border border-white/10 mb-6">
              <p className="text-slate-100 font-medium text-base sm:text-lg">
                {error}
              </p>
            </div>
            
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-amber-500/15 rounded-md ring-1 ring-amber-400/20">
                  <Lightbulb className="w-6 h-6 text-amber-200" />
                </div>
                <div className="flex-1">
                  <h4 className="text-lg font-semibold text-white mb-3">Troubleshooting</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-300/80 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-slate-100">Check PDF quality</p>
                          <p className="text-sm text-slate-300">Ensure the PDF contains selectable text (not only scanned images)</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-300/80 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-slate-100">Verify configuration</p>
                          <p className="text-sm text-slate-300">Confirm your environment variables and API key are set correctly</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-300/80 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-slate-100">Document content</p>
                          <p className="text-sm text-slate-300">Confirm the file contains dated ledger rows and running balances</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-300/80 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-slate-100">Try another file</p>
                          <p className="text-sm text-slate-300">Test a different statement to isolate formatting issues</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-indigo-500/15 rounded-md ring-1 ring-indigo-400/20">
                  <AlertCircle className="w-6 h-6 text-indigo-200" />
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-white mb-2">Technical requirements</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-300">
                    <div className="space-y-2">
                      <p><span className="font-semibold text-slate-100">File format:</span> PDF/CSV/Excel (max 10MB)</p>
                      <p><span className="font-semibold text-slate-100">Content type:</span> Dated ledger entries with amounts</p>
                    </div>
                    <div className="space-y-2">
                      <p><span className="font-semibold text-slate-100">API status:</span> Optional (fallback parsing is deterministic)</p>
                      <p><span className="font-semibold text-slate-100">Data required:</span> Balances, charges, and payments</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {onRetry && (
              <div className="flex justify-center">
                <button
                  onClick={onRetry}
                  className="group inline-flex items-center space-x-3 px-6 py-3 rounded-xl
                    bg-rose-500/90 hover:bg-rose-500 text-white font-medium
                    shadow-sm ring-1 ring-white/10 hover:ring-white/20
                    transition-all duration-200 active:scale-[0.98]
                  "
                >
                  <div className="p-1 bg-white/15 rounded-lg ring-1 ring-white/15">
                    <RefreshCw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500 ease-out" />
                  </div>
                  <span>Try Again</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}