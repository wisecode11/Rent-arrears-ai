import { NextRequest, NextResponse } from 'next/server';
import { extractPDFText, validatePDFFile } from '@/lib/pdf-processor';
import { analyzeWithAI, validateHuggingFaceConfig } from '@/lib/huggingface-client';
import { calculateFinalAmount, validateProcessedData } from '@/lib/business-logic';
import { analyzeSpreadsheet } from '@/lib/spreadsheet-processor';
import { APIResponse } from '@/types';

export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData();
    const file = (formData.get('file') || formData.get('pdf')) as File;

    if (!file) {
      return NextResponse.json({
        success: false,
        error: 'No file provided'
      } as APIResponse, { status: 400 });
    }

    const filename = file.name || '';
    const lowerName = filename.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || lowerName.endsWith('.csv');
    const isXlsx =
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls') ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let extractedText = '';

    // Step 1: Extract/parse into structured data
    let aiData;
    if (isPdf) {
      // Validate PDF file
      const validation = validatePDFFile(file);
      if (!validation.valid) {
        return NextResponse.json({
          success: false,
          error: validation.error
        } as APIResponse, { status: 400 });
      }

      console.log('Extracting text from PDF...');
      extractedText = await extractPDFText(buffer);
      
      if (!extractedText || extractedText.length < 50) {
        return NextResponse.json({
          success: false,
          error: 'Could not extract meaningful text from PDF'
        } as APIResponse, { status: 400 });
      }

      console.log('Analyzing document (direct parsing + optional AI fallback)...');
      if (!validateHuggingFaceConfig()) {
        console.log('⚠️ Hugging Face API key not configured; using deterministic parsing only');
      }
      aiData = await analyzeWithAI(extractedText);
    } else if (isCsv || isXlsx) {
      console.log('Parsing spreadsheet (CSV/XLSX)...');
      aiData = analyzeSpreadsheet(buffer);
      extractedText = `Parsed ${aiData.ledgerEntries?.length ?? 0} ledger rows from spreadsheet.`;
    } else {
      return NextResponse.json({
        success: false,
        error: 'Unsupported file type. Please upload a PDF, CSV, or XLSX.'
      } as APIResponse, { status: 400 });
    }

    // Step 3: Apply business logic
    console.log('Applying business logic...');
    const processedData = calculateFinalAmount(aiData);

    // Step 4: Validate processed data
    const dataValidation = validateProcessedData(processedData);
    if (!dataValidation.valid) {
      return NextResponse.json({
        success: false,
        error: `Data validation failed: ${dataValidation.errors.join(', ')}`
      } as APIResponse, { status: 400 });
    }

    // Return successful response with FULL extracted text
    return NextResponse.json({
      success: true,
      data: processedData,
      extractedText: extractedText // Send complete text, not truncated
    } as APIResponse);

  } catch (error) {
    console.error('PDF processing error:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    } as APIResponse, { status: 500 });
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}