'use client';

import { AlertCircle, RefreshCw, XCircle, Lightbulb } from 'lucide-react';

interface ErrorDisplayProps {
  error: string;
  onRetry?: () => void;
}

export default function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-8 shadow-sm">
        <div className="flex items-start space-x-4">
          <div className="p-2.5 bg-rose-100 rounded-lg">
            <XCircle className="w-7 h-7 text-rose-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-3">
              <h3 className="text-xl sm:text-2xl font-semibold text-rose-900">Processing Error</h3>
              <div className="px-2.5 py-0.5 bg-rose-200 text-rose-800 text-xs font-medium rounded-full">
                Action Required
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg border border-rose-200 mb-6">
              <p className="text-rose-900 font-medium text-base sm:text-lg">
                {error}
              </p>
            </div>
            
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-amber-100 rounded-md">
                  <Lightbulb className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h4 className="text-lg font-semibold text-amber-900 mb-3">Troubleshooting Solutions</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-500 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-amber-900">Check PDF Quality</p>
                          <p className="text-sm text-amber-700">Ensure PDF contains readable text, not just scanned images</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-500 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-amber-900">Verify API Configuration</p>
                          <p className="text-sm text-amber-700">Confirm your Hugging Face API key is properly configured</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-500 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-amber-900">Document Content</p>
                          <p className="text-sm text-amber-700">Verify PDF contains rental arrears information and financial data</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-500 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-medium text-amber-900">Try Alternative File</p>
                          <p className="text-sm text-amber-700">Test with a different PDF document to isolate the issue</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-blue-100 rounded-md">
                  <AlertCircle className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-blue-900 mb-2">Technical Requirements</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-700">
                    <div className="space-y-2">
                      <p><span className="font-semibold">File Format:</span> PDF only (max 10MB)</p>
                      <p><span className="font-semibold">Content Type:</span> Text-based documents</p>
                    </div>
                    <div className="space-y-2">
                      <p><span className="font-semibold">API Status:</span> Hugging Face connection required</p>
                      <p><span className="font-semibold">Data Required:</span> Rental arrears information</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {onRetry && (
              <div className="flex justify-center">
                <button
                  onClick={onRetry}
                  className="group inline-flex items-center space-x-3 px-6 py-3 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-xl shadow-sm transition-colors"
                >
                  <div className="p-1 bg-white/20 rounded-lg">
                    <RefreshCw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
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