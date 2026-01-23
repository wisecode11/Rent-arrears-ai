"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.OPTIONS = OPTIONS;
const server_1 = require("next/server");
const excel_generator_1 = require("@/lib/excel-generator");
async function POST(request) {
    try {
        // Parse request body
        const processedData = await request.json();
        // Validate required data
        if (!processedData.tenantName || !processedData.propertyName) {
            return server_1.NextResponse.json({ error: 'Missing required data for Excel generation' }, { status: 400 });
        }
        // Generate Excel file
        console.log('Generating Excel file...');
        const excelBuffer = (0, excel_generator_1.generateExcelFile)(processedData);
        const filename = (0, excel_generator_1.generateExcelFilename)(processedData);
        // Return Excel file as response
        return new server_1.NextResponse(new Uint8Array(excelBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': excelBuffer.length.toString(),
            },
        });
    }
    catch (error) {
        console.error('Excel generation error:', error);
        return server_1.NextResponse.json({ error: 'Failed to generate Excel file' }, { status: 500 });
    }
}
// Handle preflight requests
async function OPTIONS() {
    return new server_1.NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
