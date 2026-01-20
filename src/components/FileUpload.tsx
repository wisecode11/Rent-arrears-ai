'use client';

import { useState, useRef } from 'react';
import { Upload, FileText, AlertCircle, CloudUpload, CheckCircle2 } from 'lucide-react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

export default function FileUpload({ onFileSelect, isProcessing }: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelection = (file: File) => {
    const name = (file.name || '').toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || name.endsWith('.csv');
    const isXlsx =
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';

    if (!isPdf && !isCsv && !isXlsx) {
      alert('Please select a PDF, CSV, or Excel (XLSX/XLS) file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
    onFileSelect(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelection(e.target.files[0]);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mb-2">
          Upload your rental arrears file
        </h2>
        <p className="text-base sm:text-lg text-slate-300 max-w-2xl mx-auto">
          Automatically extract ledger entries and calculate rent arrears from PDF, CSV, or Excel files
        </p>
      </div>

      <div
        className={`
          group relative overflow-hidden border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer
          transition-all duration-200 ease-out
          ${dragActive 
            ? 'border-indigo-400 bg-white/5 ring-1 ring-indigo-400/30' 
            : 'border-white/15 hover:border-white/25 bg-slate-950/35 hover:bg-slate-950/45 ring-1 ring-white/10'
          }
          ${isProcessing ? 'opacity-50 pointer-events-none' : ''}
          shadow-sm hover:shadow-xl hover:-translate-y-0.5
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={openFileDialog}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_200px_at_50%_-20%,rgba(99,102,241,0.35),transparent_60%),radial-gradient(500px_260px_at_80%_120%,rgba(16,185,129,0.20),transparent_55%)] opacity-70" />
        <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-[radial-gradient(800px_220px_at_50%_0%,rgba(255,255,255,0.06),transparent_60%)]" />

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.csv,.xlsx,.xls"
          onChange={handleInputChange}
          className="hidden"
          disabled={isProcessing}
        />

        <div className="relative flex flex-col items-center space-y-6">
          {selectedFile ? (
            <>
              <div className="relative">
                <div className="p-6 rounded-2xl shadow-sm ring-1 ring-white/10 bg-gradient-to-br from-emerald-500 to-teal-500">
                  <FileText className="w-16 h-16 text-white" />
                </div>
                <div className="absolute -top-2 -right-2 p-2 bg-emerald-500 rounded-full shadow-sm ring-2 ring-slate-950/60">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold text-white mb-2">
                  {selectedFile.name}
                </p>
                <div className="flex items-center justify-center space-x-3 text-slate-300">
                  <span className="px-3 py-1 bg-white/5 rounded-full text-sm font-medium ring-1 ring-white/10">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                  <span className="px-3 py-1 bg-emerald-500/15 text-emerald-200 rounded-full text-sm font-medium ring-1 ring-emerald-400/20">
                    Document
                  </span>
                </div>
              </div>
              {!isProcessing && (
                <p className="text-slate-300 font-medium">
                  Click to select a different file (processing starts automatically)
                </p>
              )}
            </>
          ) : (
            <>
              <div className="relative">
                <div className="p-6 rounded-2xl shadow-sm ring-1 ring-white/10 bg-gradient-to-br from-indigo-500 to-blue-500">
                  <CloudUpload className="w-16 h-16 text-white" />
                </div>
                <div className="absolute inset-0 rounded-2xl animate-pulse opacity-15 bg-gradient-to-br from-indigo-400 to-emerald-400"></div>
              </div>
              <div className="text-center">
                <p className="text-2xl font-semibold text-white mb-2">
                  Upload Rental Arrears File
                </p>
                <p className="text-base sm:text-lg text-slate-300 mb-5">
                  Drag and drop your PDF, CSV, or Excel file here, or click to browse
                </p>
                <div className="inline-flex items-center space-x-2 px-6 py-3 rounded-xl text-white font-medium
                  bg-white/10 hover:bg-white/15 ring-1 ring-white/15 hover:ring-white/25
                  transition-all duration-200 active:scale-[0.98]
                ">
                  <Upload className="w-5 h-5" />
                  <span>Choose File</span>
                </div>
              </div>
            </>
          )}
        </div>

        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-md rounded-2xl">
            <div className="text-center">
              <div className="relative mb-4">
                <div className="w-16 h-16 border-4 border-white/15 rounded-full animate-spin border-t-indigo-400 mx-auto"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-indigo-200" />
                </div>
              </div>
              <p className="text-lg font-semibold text-white mb-2">Processing your file</p>
              <p className="text-slate-300">Extracting ledger rows and calculating arrears…</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur">
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-amber-500/15 rounded-md ring-1 ring-amber-400/20">
            <AlertCircle className="w-5 h-5 text-amber-200" />
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-white mb-2">Document requirements</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-300">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-300/80 rounded-full"></div>
                <span>PDF/CSV/Excel supported (max 10MB)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-300/80 rounded-full"></div>
                <span>PDFs should be text-based (not scanned images)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-300/80 rounded-full"></div>
                <span>Contains rental arrears information</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-300/80 rounded-full"></div>
                <span>Readable text with charge details</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}