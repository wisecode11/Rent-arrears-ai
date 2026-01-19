import { NextRequest, NextResponse } from 'next/server';
import { generateExcelFile, generateExcelFilename } from '@/lib/excel-generator';
import { ProcessedData } from '@/types';

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const processedData: ProcessedData = await request.json();

    // Validate required data
    if (!processedData.tenantName || !processedData.propertyName) {
      return NextResponse.json(
        { error: 'Missing required data for Excel generation' },
        { status: 400 }
      );
    }

    // Generate Excel file
    console.log('Generating Excel file...');
    const excelBuffer = generateExcelFile(processedData);
    const filename = generateExcelFilename(processedData);

    // Return Excel file as response
    return new NextResponse(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': excelBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('Excel generation error:', error);
    
    return NextResponse.json(
      { error: 'Failed to generate Excel file' },
      { status: 500 }
    );
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