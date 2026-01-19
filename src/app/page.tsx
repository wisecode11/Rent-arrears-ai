'use client';

import { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import ProcessingResults from '@/components/ProcessingResults';
import ErrorDisplay from '@/components/ErrorDisplay';
import { ProcessedData, APIResponse } from '@/types';
import { FileText, Zap, Download, Shield, Building2, TrendingUp } from 'lucide-react';

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
      const response = await fetch('/api/generate-excel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(processedData),
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm shadow-lg border-b border-slate-200/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl shadow-lg">
                <Building2 className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-900 via-blue-900 to-indigo-900 bg-clip-text text-transparent">
                  Rental Arrears Processor
                </h1>
                <p className="text-slate-600 mt-2 text-lg font-medium">
                  Enterprise-grade AI-powered PDF processing for accurate rental arrears calculations
                </p>
              </div>
            </div>
            <div className="hidden lg:flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-full border border-emerald-200">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              <span className="text-sm font-semibold text-emerald-700">Professional Edition</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Features Banner */}
        {!processedData && !error && (
          <div className="mb-12">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-slate-800 mb-3">Powerful Features</h2>
              <p className="text-slate-600 max-w-2xl mx-auto">
                Advanced AI technology combined with precise business logic to deliver accurate rental arrears processing
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="group bg-white/70 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-white/50 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <div className="flex items-center space-x-4 mb-4">
                  <div className="p-3 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">AI-Powered Analysis</h3>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Advanced Hugging Face LLM technology intelligently extracts and categorizes charges from any PDF format with exceptional accuracy
                </p>
              </div>
              
              <div className="group bg-white/70 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-white/50 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <div className="flex items-center space-x-4 mb-4">
                  <div className="p-3 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <Download className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Professional Reports</h3>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Generate comprehensive Excel reports with structured data sheets, detailed breakdowns, and professional formatting
                </p>
              </div>
              
              <div className="group bg-white/70 backdrop-blur-sm p-8 rounded-2xl shadow-xl border border-white/50 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                <div className="flex items-center space-x-4 mb-4">
                  <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <Shield className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Precise Calculations</h3>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  Enterprise-grade business logic ensures accurate calculations: Final Amount = Opening Balance - Non-Rental Charges
                </p>
              </div>
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
