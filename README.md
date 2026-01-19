# Rental Arrears Processor

A production-ready Next.js 14 application that uses AI to automatically extract and process rental arrears data from PDF documents.

## 🚀 Features

- **AI-Powered PDF Processing**: Uses Hugging Face LLM to intelligently extract rental and non-rental charges
- **Automatic Text Extraction**: Handles any PDF format with robust text normalization
- **Business Logic Application**: Calculates final rental amounts using precise business rules
- **Excel Export**: Generates structured Excel reports with multiple sheets
- **Professional UI**: Clean, responsive interface built with Tailwind CSS
- **Error Handling**: Comprehensive error handling and validation

## 🛠 Tech Stack

- **Frontend**: Next.js 14 (App Router), React 19, Tailwind CSS
- **Backend**: Node.js API Routes
- **AI**: Hugging Face Inference API (Mixtral/Mistral models)
- **PDF Processing**: pdf-parse library
- **Excel Generation**: xlsx (SheetJS)
- **Icons**: Lucide React
- **TypeScript**: Full type safety

## 📋 Prerequisites

- Node.js 18+ 
- npm or yarn
- Hugging Face API key (free at [huggingface.co](https://huggingface.co/settings/tokens))

## 🔧 Installation & Setup

1. **Clone and navigate to the project**:
   ```bash
   cd rental-arrears-processor
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.local.example .env.local
   ```
   
   Edit `.env.local` and add your Hugging Face API key:
   ```
   HUGGINGFACE_API_KEY=your_actual_api_key_here
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```

5. **Open your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## 🎯 How It Works

### Business Logic
The system applies this critical calculation:
```
Final Rental Amount = Opening Balance - Total Non-Rental Charges
```

### Processing Flow
1. **PDF Upload**: User uploads any rental arrears PDF
2. **Text Extraction**: System extracts and normalizes text from PDF
3. **AI Analysis**: Hugging Face LLM analyzes text and extracts structured data
4. **Business Logic**: Applies calculation rules to determine final amounts
5. **Results Display**: Shows breakdown of charges and calculations
6. **Excel Export**: Generates downloadable Excel report

### AI Prompt Strategy
The system uses a precise prompt that instructs the AI to:
- Extract ALL rental charges (rent, utilities, etc.)
- Extract ALL non-rental charges (maintenance, legal fees, insurance, etc.)
- Identify opening balance (handles negative/zero balances)
- Return data in strict JSON format
- Maintain accuracy with exact amounts

## 📊 Excel Report Structure

The generated Excel file contains 3 sheets:

1. **Rental Charges**: All rental-related charges with dates
2. **Non-Rental Charges**: All non-rental charges (MOST IMPORTANT) with categories
3. **Summary**: Property info, financial summary, and calculation breakdown

## 🔒 Security Features

- File type validation (PDF only)
- File size limits (10MB max)
- Input sanitization
- Error handling for malformed PDFs
- API key validation

## 📁 Project Structure

```
rental-arrears-processor/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── process-pdf/route.ts    # PDF processing endpoint
│   │   │   └── generate-excel/route.ts # Excel generation endpoint
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx                    # Main application page
│   ├── components/
│   │   ├── FileUpload.tsx             # PDF upload component
│   │   ├── ProcessingResults.tsx      # Results display component
│   │   └── ErrorDisplay.tsx           # Error handling component
│   ├── lib/
│   │   ├── pdf-processor.ts           # PDF text extraction
│   │   ├── huggingface-client.ts      # AI integration
│   │   ├── business-logic.ts          # Calculation logic
│   │   └── excel-generator.ts         # Excel file generation
│   └── types/
│       └── index.ts                   # TypeScript interfaces
├── .env.local.example                 # Environment template
├── package.json
└── README.md
```

## 🚀 Deployment

### Vercel (Recommended)
1. Push code to GitHub
2. Connect repository to Vercel
3. Add `HUGGINGFACE_API_KEY` environment variable in Vercel dashboard
4. Deploy

### Other Platforms
Ensure you set the `HUGGINGFACE_API_KEY` environment variable in your deployment platform.

## 🔧 Configuration

### Hugging Face Models
The system uses these models in order of preference:
1. `mistralai/Mixtral-8x7B-Instruct-v0.1` (primary)
2. `microsoft/DialoGPT-medium` (fallback)

### PDF Processing
- Supports any PDF with extractable text
- Handles tables, paragraphs, and mixed layouts
- Normalizes text to remove artifacts
- Maximum file size: 10MB

## 🐛 Troubleshooting

### Common Issues

1. **"Hugging Face API key not configured"**
   - Ensure `.env.local` exists with valid `HUGGINGFACE_API_KEY`

2. **"Could not extract meaningful text from PDF"**
   - PDF might be image-based (scanned document)
   - Try a different PDF with selectable text

3. **"AI analysis failed"**
   - Check your Hugging Face API key validity
   - Ensure you have API quota remaining

4. **Excel download not working**
   - Check browser popup blockers
   - Ensure processed data is valid

## 📝 Usage Tips

1. **Best PDF Types**: Text-based PDFs work best (not scanned images)
2. **File Naming**: Use descriptive filenames for better organization
3. **Data Accuracy**: Review extracted data before downloading Excel
4. **API Limits**: Hugging Face free tier has rate limits

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section above
2. Review the error messages in the UI
3. Check browser console for detailed errors
4. Ensure all environment variables are configured

## 🔮 Future Enhancements

- Support for multiple file uploads
- OCR integration for scanned PDFs
- Custom business rule configuration
- Database storage for processed documents
- User authentication and document history
- Advanced reporting and analytics
