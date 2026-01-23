"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPDFText = extractPDFText;
exports.validatePDFFile = validatePDFFile;
const pdf_parse_1 = __importDefault(require("pdf-parse"));
/**
 * Extract and normalize text from PDF buffer
 * Removes noise, page numbers, and formatting artifacts
 */
async function extractPDFText(buffer) {
    try {
        const data = await (0, pdf_parse_1.default)(buffer);
        let text = data.text;
        // Normalize text - remove common PDF artifacts
        text = text
            // Remove page numbers and headers/footers
            .replace(/Page \d+ of \d+/gi, '')
            .replace(/^\d+\s*$/gm, '')
            // Remove excessive whitespace
            .replace(/\s{3,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            // Remove special characters that interfere with parsing
            .replace(/[^\w\s\-\.\$\,\(\)\[\]\:\/\n]/g, ' ')
            // Clean up currency formatting
            .replace(/\$\s+/g, '$')
            .replace(/\s+\$/g, '$')
            // Normalize line breaks
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Remove empty lines
            .split('\n')
            .filter(line => line.trim().length > 0)
            .join('\n')
            .trim();
        return text;
    }
    catch (error) {
        console.error('PDF extraction error:', error);
        throw new Error('Failed to extract text from PDF');
    }
}
/**
 * Validate PDF file type and size
 */
function validatePDFFile(file) {
    // Check file type
    if (file.type !== 'application/pdf') {
        return { valid: false, error: 'File must be a PDF' };
    }
    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
        return { valid: false, error: 'File size must be less than 10MB' };
    }
    return { valid: true };
}
