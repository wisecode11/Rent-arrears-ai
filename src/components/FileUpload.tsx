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
        <h2 className="text-2xl sm:text-3xl font-semibold text-slate-900 mb-2">Upload Your Rental Arrears Document</h2>
        <p className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto">
          Automatically extract ledger entries and calculate rent arrears from PDF, CSV, or Excel files
        </p>
      </div>

      <div
        className={`
          relative border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-200 cursor-pointer
          ${dragActive 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-slate-300 hover:border-slate-400 bg-white'
          }
          ${isProcessing ? 'opacity-50 pointer-events-none' : ''}
          shadow-sm hover:shadow-md
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={openFileDialog}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.csv,.xlsx,.xls"
          onChange={handleInputChange}
          className="hidden"
          disabled={isProcessing}
        />

        <div className="flex flex-col items-center space-y-6">
          {selectedFile ? (
            <>
              <div className="relative">
                <div className="p-6 bg-emerald-600 rounded-xl shadow-sm">
                  <FileText className="w-16 h-16 text-white" />
                </div>
                <div className="absolute -top-2 -right-2 p-2 bg-emerald-500 rounded-full shadow-sm">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-slate-800 mb-2">
                  {selectedFile.name}
                </p>
                <div className="flex items-center justify-center space-x-4 text-slate-600">
                  <span className="px-3 py-1 bg-slate-100 rounded-full text-sm font-medium">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
                    Document
                  </span>
                </div>
              </div>
              {!isProcessing && (
                <p className="text-slate-600 font-medium">
                  Click to select a different file or processing will begin automatically
                </p>
              )}
            </>
          ) : (
            <>
              <div className="relative">
                <div className="p-6 bg-blue-600 rounded-xl shadow-sm">
                  <CloudUpload className="w-16 h-16 text-white" />
                </div>
                <div className="absolute inset-0 bg-blue-500 rounded-xl animate-pulse opacity-10"></div>
              </div>
              <div className="text-center">
                <p className="text-2xl font-semibold text-slate-900 mb-2">
                  Upload Rental Arrears File
                </p>
                <p className="text-base sm:text-lg text-slate-600 mb-4">
                  Drag and drop your PDF, CSV, or Excel file here, or click to browse
                </p>
                <div className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-all duration-150">
                  <Upload className="w-5 h-5" />
                  <span>Choose File</span>
                </div>
              </div>
            </>
          )}
        </div>

        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 backdrop-blur-sm rounded-3xl">
            <div className="text-center">
              <div className="relative mb-4">
                <div className="w-16 h-16 border-4 border-blue-200 rounded-full animate-spin border-t-blue-600 mx-auto"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              <p className="text-lg font-semibold text-slate-800 mb-2">Processing Your Document</p>
              <p className="text-slate-600">AI is analyzing your rental arrears data...</p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-6">
        <div className="flex items-start space-x-3">
          <div className="p-2 bg-amber-100 rounded-md">
            <AlertCircle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-amber-900 mb-2">Document Requirements</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-amber-700">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-400 rounded-full"></div>
                <span>PDF format only (max 10MB)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-400 rounded-full"></div>
                <span>Text-based documents (not scanned images)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-400 rounded-full"></div>
                <span>Contains rental arrears information</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-400 rounded-full"></div>
                <span>Readable text with charge details</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}