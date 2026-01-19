'use client';

import { AlertCircle, RefreshCw, XCircle, Lightbulb } from 'lucide-react';

interface ErrorDisplayProps {
  error: string;
  onRetry?: () => void;
}

export default function ErrorDisplay({ error, onRetry }: ErrorDisplayProps) {
  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="bg-gradient-to-br from-red-50 to-rose-50 border-2 border-red-200 rounded-3xl p-8 shadow-xl">
        <div className="flex items-start space-x-4">
          <div className="p-3 bg-red-100 rounded-2xl">
            <XCircle className="w-8 h-8 text-red-600" />
          </div>
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-3">
              <h3 className="text-2xl font-bold text-red-800">Processing Error</h3>
              <div className="px-3 py-1 bg-red-200 text-red-800 text-sm font-semibold rounded-full">
                Action Required
              </div>
            </div>
            
            <div className="bg-white/70 backdrop-blur-sm p-4 rounded-xl border border-red-200 mb-6">
              <p className="text-red-800 font-medium text-lg">
                {error}
              </p>
            </div>
            
            <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-2xl p-6 mb-6">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Lightbulb className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h4 className="text-lg font-bold text-amber-800 mb-3">Troubleshooting Solutions</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-500 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-semibold text-amber-800">Check PDF Quality</p>
                          <p className="text-sm text-amber-700">Ensure PDF contains readable text, not just scanned images</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-500 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-semibold text-amber-800">Verify API Configuration</p>
                          <p className="text-sm text-amber-700">Confirm your Hugging Face API key is properly configured</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-500 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-semibold text-amber-800">Document Content</p>
                          <p className="text-sm text-amber-700">Verify PDF contains rental arrears information and financial data</p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2">
                        <div className="w-2 h-2 bg-amber-500 rounded-full mt-2 flex-shrink-0"></div>
                        <div>
                          <p className="font-semibold text-amber-800">Try Alternative File</p>
                          <p className="text-sm text-amber-700">Test with a different PDF document to isolate the issue</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-6 mb-6">
              <div className="flex items-start space-x-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <AlertCircle className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-blue-800 mb-2">Technical Requirements</h4>
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
                  className="group inline-flex items-center space-x-3 px-6 py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-bold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
                >
                  <div className="p-1 bg-white/20 rounded-lg group-hover:bg-white/30 transition-colors">
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