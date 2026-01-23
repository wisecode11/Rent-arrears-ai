"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.OPTIONS = OPTIONS;
const server_1 = require("next/server");
const pdf_processor_1 = require("@/lib/pdf-processor");
const huggingface_client_1 = require("@/lib/huggingface-client");
const business_logic_1 = require("@/lib/business-logic");
const spreadsheet_processor_1 = require("@/lib/spreadsheet-processor");
async function POST(request) {
    try {
        // Parse form data
        const formData = await request.formData();
        const file = (formData.get('file') || formData.get('pdf'));
        if (!file) {
            return server_1.NextResponse.json({
                success: false,
                error: 'No file provided'
            }, { status: 400 });
        }
        const filename = file.name || '';
        const lowerName = filename.toLowerCase();
        const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
        const isCsv = file.type === 'text/csv' || lowerName.endsWith('.csv');
        const isXlsx = lowerName.endsWith('.xlsx') ||
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
            const validation = (0, pdf_processor_1.validatePDFFile)(file);
            if (!validation.valid) {
                return server_1.NextResponse.json({
                    success: false,
                    error: validation.error
                }, { status: 400 });
            }
            console.log('Extracting text from PDF...');
            extractedText = await (0, pdf_processor_1.extractPDFText)(buffer);
            if (!extractedText || extractedText.length < 50) {
                return server_1.NextResponse.json({
                    success: false,
                    error: 'Could not extract meaningful text from PDF'
                }, { status: 400 });
            }
            console.log('Analyzing document (direct parsing + optional AI fallback)...');
            if (!(0, huggingface_client_1.validateHuggingFaceConfig)()) {
                console.log('⚠️ Hugging Face API key not configured; using deterministic parsing only');
            }
            aiData = await (0, huggingface_client_1.analyzeWithAI)(extractedText);
        }
        else if (isCsv || isXlsx) {
            console.log('Parsing spreadsheet (CSV/XLSX)...');
            aiData = (0, spreadsheet_processor_1.analyzeSpreadsheet)(buffer);
            extractedText = `Parsed ${aiData.ledgerEntries?.length ?? 0} ledger rows from spreadsheet.`;
        }
        else {
            return server_1.NextResponse.json({
                success: false,
                error: 'Unsupported file type. Please upload a PDF, CSV, or XLSX.'
            }, { status: 400 });
        }
        // Step 3: Apply business logic
        console.log('Applying business logic...');
        const processedData = (0, business_logic_1.calculateFinalAmount)(aiData);
        // Step 4: Validate processed data
        const dataValidation = (0, business_logic_1.validateProcessedData)(processedData);
        if (!dataValidation.valid) {
            return server_1.NextResponse.json({
                success: false,
                error: `Data validation failed: ${dataValidation.errors.join(', ')}`
            }, { status: 400 });
        }
        // Return successful response with FULL extracted text
        return server_1.NextResponse.json({
            success: true,
            data: processedData,
            extractedText: extractedText // Send complete text, not truncated
        });
    }
    catch (error) {
        console.error('PDF processing error:', error);
        return server_1.NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        }, { status: 500 });
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
