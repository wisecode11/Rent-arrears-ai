import { NextRequest, NextResponse } from 'next/server';
import { extractPDFText, validatePDFFile } from '@/lib/pdf-processor';
import { analyzeWithAI, validateHuggingFaceConfig } from '@/lib/huggingface-client';
import { calculateFinalAmount, validateProcessedData } from '@/lib/business-logic';
import { APIResponse } from '@/types';

export async function POST(request: NextRequest) {
  try {
    // Validate Hugging Face configuration
    if (!validateHuggingFaceConfig()) {
      return NextResponse.json({
        success: false,
        error: 'Hugging Face API key not configured'
      } as APIResponse, { status: 500 });
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('pdf') as File;

    if (!file) {
      return NextResponse.json({
        success: false,
        error: 'No PDF file provided'
      } as APIResponse, { status: 400 });
    }

    // Validate PDF file
    const validation = validatePDFFile(file);
    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        error: validation.error
      } as APIResponse, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Step 1: Extract text from PDF
    console.log('Extracting text from PDF...');
    const extractedText = await extractPDFText(buffer);
    
    if (!extractedText || extractedText.length < 50) {
      return NextResponse.json({
        success: false,
        error: 'Could not extract meaningful text from PDF'
      } as APIResponse, { status: 400 });
    }

    // Step 2: Analyze with AI
    console.log('Analyzing with Hugging Face AI...');
    const aiData = await analyzeWithAI(extractedText);

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