'use client';

import { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import ProcessingResults from '@/components/ProcessingResults';
import ErrorDisplay from '@/components/ErrorDisplay';
import { ProcessedData, APIResponse } from '@/types';
import { Building2, TrendingUp } from 'lucide-react';

export default function Home() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingExcel, setIsGeneratingExcel] = useState(false);
  const [processedData, setProcessedData] = useState<ProcessedData | null>(null);
  const [extractedText, setExtractedText] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleFileSelect = async (file: File) => {
    setIsProcessing(true);
    setError('');
    setProcessedData(null);

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      const response = await fetch('/api/process-pdf', {
        method: 'POST',
        body: formData,
      });

      const result: APIResponse = await response.json();

      if (result.success && result.data) {
        setProcessedData(result.data);
        setExtractedText(result.extractedText || '');
      } else {
        setError(result.error || 'Unknown error occurred');
      }
    } catch (err) {
      console.error('Processing error:', err);
      setError('Failed to process PDF. Please check your connection and try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadExcel = async () => {
    if (!processedData) return;

    setIsGeneratingExcel(true);

    try {
      // Include extractedText in processedData for Excel generation
      const dataWithExtractedText = {
        ...processedData,
        extractedText: extractedText || undefined
      };

      const response = await fetch('/api/generate-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataWithExtractedText),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Rental_Arrears_${processedData.tenantName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        throw new Error('Failed to generate Excel file');
      }
    } catch (err) {
      console.error('Excel generation error:', err);
      setError('Failed to generate Excel file. Please try again.');
    } finally {
      setIsGeneratingExcel(false);
    }
  };

  const handleRetry = () => {
    setError('');
    setProcessedData(null);
    setExtractedText('');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_20%_0%,rgba(99,102,241,0.18),transparent_60%),radial-gradient(900px_500px_at_80%_10%,rgba(16,185,129,0.14),transparent_55%),linear-gradient(to_bottom,rgba(2,6,23,0.9),rgba(2,6,23,1))]">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative p-3 rounded-xl shadow-sm ring-1 ring-white/10 bg-gradient-to-br from-indigo-500/90 to-blue-500/90">
                <Building2 className="w-8 h-8 text-white" />
                <div className="pointer-events-none absolute -inset-1 rounded-xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/10 blur-xl" />
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight">
                  Rental Arrears Processor
                </h1>
                <p className="text-slate-300 mt-1 text-base sm:text-lg">
                  Professional file processing for consistent, accurate rent arrears calculations
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              {(processedData || error) && (
                <button
                  onClick={handleRetry}
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-white/10 hover:bg-white/15 ring-1 ring-white/10 hover:ring-white/20 transition-all duration-200 active:scale-[0.98]"
                  aria-label="Upload another file"
                >
                  New Upload
                </button>
              )}
              <div className="hidden lg:flex items-center space-x-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5">
                <TrendingUp className="w-4 h-4 text-slate-200" />
                <span className="text-xs font-medium text-slate-200">Professional Edition</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Features Banner */}
        {!processedData && !error && (
          <div className="mb-8">
            <div className="text-center">
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mb-2">
                Fast, consistent arrears calculations
              </h2>
              <p className="text-slate-300 max-w-2xl mx-auto">
                Upload a ledger file and get a clean breakdown of rent vs non‑rent charges with a single, reliable arrears number.
              </p>
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="space-y-8">
          {!processedData && !error && (
            <FileUpload 
              onFileSelect={handleFileSelect} 
              isProcessing={isProcessing} 
            />
          )}

          {error && (
            <ErrorDisplay 
              error={error} 
              onRetry={handleRetry} 
            />
          )}

          {processedData && (
            <ProcessingResults
              data={processedData}
              extractedText={extractedText}
              onDownloadExcel={handleDownloadExcel}
              isGeneratingExcel={isGeneratingExcel}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      {/* <footer className="bg-white/60 backdrop-blur-sm border-t border-slate-200/60 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <div className="flex items-center justify-center space-x-2 mb-4">
              <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-slate-800">Rental Arrears Processor</span>
            </div>
            <p className="text-slate-600 mb-2">
              Built with Next.js 14, Tailwind CSS, and Hugging Face AI
            </p>
            <p className="text-sm text-slate-500">
              Enterprise-grade solution for rental property management
            </p>
          </div>
        </div>
      </footer> */}
    </div>
  );
}
