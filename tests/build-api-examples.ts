import { BuildAPIArgs } from '../src/schemas.js'

/**
 * Dataset of diverse examples covering the feature set of BuildAPIArgsSchema
 * These examples aim for maximal coverage of the schema's capabilities
 *
 * The examples cover:
 * - Different file types and formats
 * - Various instruction configurations
 * - All action types (OCR, rotation, watermarks, flattening, etc.)
 * - All output formats (PDF, PDF/A, PDF/UA, image, JSON, Office, HTML, Markdown)
 * - Various combinations of options and parameters
 * - Edge cases and special use cases
 */

// Basic PDF processing example
export const basicPdfExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// PDF with password protection
export const passwordProtectedPdfExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'examplePassword.pdf',
        password: 'test123',
      },
    ],
    output: {
      type: 'pdf',
      user_password: 'user123',
      owner_password: 'owner456',
      user_permissions: ['printing', 'fill_forms', 'extract_accessibility'],
    },
  },
  outputPath: 'output_pdf.pdf',
}

// PDF/A conversion with metadata
export const pdfaConversionExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'pdfa',
      conformance: 'pdfa-2b',
      vectorization: true,
      rasterization: true,
      metadata: {
        title: 'Example Document',
        author: 'John Doe',
      },
      labels: [
        {
          pages: { start: 0, end: 0 },
          label: 'Cover Page',
        },
        {
          pages: { start: 1, end: 5 },
          label: 'Introduction',
        },
      ],
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Image conversion example
export const imageConversionExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'image',
      format: 'png',
      pages: { start: 0, end: 2 },
      width: 1200,
    },
  },
  outputPath: 'output_pdf.pdf',
}

// JSON content extraction
export const jsonContentExtractionExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'json-content',
      plainText: true,
      keyValuePairs: true,
      tables: true,
      language: 'english',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Office document conversion
export const officeConversionExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.docx',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Multiple file parts with page ranges
export const multiplePartsExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
        pages: { start: 0, end: 2 },
      },
      {
        file: 'example.pdf',
        pages: { start: 1, end: 3 },
      },
      {
        file: 'example.docx',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with OCR action
export const ocrActionExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'ocr',
        language: 'english',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with rotation action
export const rotationActionExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'rotate',
        rotateBy: 90,
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with text watermark
export const textWatermarkExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'watermark',
        watermarkType: 'text',
        text: 'CONFIDENTIAL',
        width: 50,
        height: 50,
        rotation: 45,
        opacity: 0.5,
        fontColor: '#FF0000',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with image watermark
export const imageWatermarkExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'watermark',
        watermarkType: 'image',
        image: 'example.png',
        width: 200,
        height: 100,
        opacity: 0.7,
        rotation: 0,
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with flattening annotations
export const flattenAnnotationsExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'flatten',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with applying XFDF
export const applyXfdfExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'applyXfdf',
        file: 'example.xfdf',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with redactions using preset
export const redactionsPresetExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'createRedactions',
        strategy: 'preset',
        strategyOptions: {
          preset: 'credit-card-number',
          includeAnnotations: true,
          start: 0,
          limit: null,
        },
      },
      {
        type: 'applyRedactions',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with redactions using regex
export const redactionsRegexExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'createRedactions',
        strategy: 'regex',
        strategyOptions: {
          regex: '\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b',
          caseSensitive: false,
          includeAnnotations: true,
          start: 0,
          limit: 10,
        },
      },
      {
        type: 'applyRedactions',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with redactions using text
export const redactionsTextExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'createRedactions',
        strategy: 'text',
        strategyOptions: {
          text: 'confidential',
          caseSensitive: false,
          includeAnnotations: true,
          start: 0,
          limit: null,
        },
      },
      {
        type: 'applyRedactions',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Complex example with multiple actions and optimizations
export const complexExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
        pages: { start: 0, end: 5 },
      },
      {
        file: 'example.docx',
      },
      {
        file: 'examplePassword.pdf',
        password: 'test123',
        pages: { start: 1, end: -1 },
      },
    ],
    actions: [
      {
        type: 'ocr',
        language: 'english',
      },
      {
        type: 'watermark',
        watermarkType: 'text',
        text: 'DRAFT',
        width: '50%',
        height: 80,
        opacity: 0.3,
        rotation: 30,
      },
      {
        type: 'flatten',
      },
      {
        type: 'createRedactions',
        strategy: 'preset',
        strategyOptions: {
          preset: 'social-security-number',
          includeAnnotations: true,
          start: 0,
          limit: null,
        },
      },
      {
        type: 'applyRedactions',
      },
    ],
    output: {
      type: 'pdfa',
      conformance: 'pdfa-3a',
      vectorization: true,
      rasterization: true,
      metadata: {
        title: 'Comprehensive Example',
        author: 'API User',
      },
      optimize: {
        grayscaleText: false,
        grayscaleGraphics: false,
        grayscaleImages: true,
        grayscaleFormFields: false,
        grayscaleAnnotations: false,
        disableImages: false,
        mrcCompression: true,
        linearize: true,
        imageOptimizationQuality: 2,
      },
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with Excel to PDF conversion
export const excelToPdfExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.xlsx',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with PowerPoint to PDF conversion
export const powerPointToPdfExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pptx',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with PDF to Office conversion
export const pdfToOfficeExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'docx',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with image to PDF conversion
export const imageToPdfExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.jpg',
      },
    ],
    output: {
      type: 'pdf',
      metadata: {
        title: 'Image Converted to PDF',
        author: 'Conversion Tool',
      },
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with WebP image to PDF conversion
export const webpToPdfExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.webp',
        content_type: 'image/webp',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with JPEG image output format
export const jpegOutputExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'image',
      format: 'jpeg',
      dpi: 150,
      pages: { start: 0, end: 0 },
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with WebP image output format
export const webpOutputExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'image',
      format: 'webp',
      height: 600,
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with PDF/A-1b conformance
export const pdfA1bExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'pdfa',
      conformance: 'pdfa-1b',
      vectorization: true,
      rasterization: true,
      metadata: {
        title: 'PDF/A-1b Document',
        author: 'Compliance Team',
      },
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with PDF/A-3u conformance
export const pdfA3uExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'pdfa',
      conformance: 'pdfa-3u',
      vectorization: true,
      rasterization: false,
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with 180-degree rotation
export const rotation180Example: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'rotate',
        rotateBy: 180,
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with 270-degree rotation
export const rotation270Example: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'rotate',
        rotateBy: 270,
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with multiple redaction presets
export const multipleRedactionPresetsExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'createRedactions',
        strategy: 'preset',
        strategyOptions: {
          preset: 'credit-card-number',
          includeAnnotations: true,
          start: 0,
          limit: null,
        },
      },
      {
        type: 'createRedactions',
        strategy: 'preset',
        strategyOptions: {
          preset: 'email-address',
          includeAnnotations: true,
          start: 0,
          limit: null,
        },
      },
      {
        type: 'createRedactions',
        strategy: 'preset',
        strategyOptions: {
          preset: 'social-security-number',
          includeAnnotations: true,
          start: 0,
          limit: null,
        },
      },
      {
        type: 'applyRedactions',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with PDF to XLSX conversion
export const pdfToXlsxExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'xlsx',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with PDF to PPTX conversion
export const pdfToPptxExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'pptx',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with comprehensive PDF optimization
export const comprehensivePdfOptimizationExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'pdf',
      optimize: {
        grayscaleText: true,
        grayscaleGraphics: true,
        grayscaleImages: true,
        grayscaleFormFields: true,
        grayscaleAnnotations: true,
        disableImages: false,
        mrcCompression: true,
        imageOptimizationQuality: 1,
        linearize: true,
      },
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with all user permissions
export const allUserPermissionsExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'pdf',
      user_password: 'userpass',
      owner_password: 'ownerpass',
      user_permissions: [
        'printing',
        'modification',
        'extract',
        'annotations_and_forms',
        'fill_forms',
        'extract_accessibility',
        'assemble',
        'print_high_quality',
      ],
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with negative page indices in page ranges
export const negativePageIndicesExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
        pages: { start: 0, end: -2 }, // All pages except the last one
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with mixed file types in a single document
export const mixedFileTypesExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
        pages: { start: 0, end: 1 },
      },
      {
        file: 'example.jpg',
      },
      {
        file: 'example.docx',
      },
      {
        file: 'example.pptx',
      },
      {
        file: 'example.xlsx',
      },
    ],
    output: {
      type: 'pdf',
      metadata: {
        title: 'Mixed Document Types',
        author: 'Integration Team',
      },
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with OCR and redactions combined
export const ocrAndRedactionsExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'ocr',
        language: 'english',
      },
      {
        type: 'createRedactions',
        strategy: 'preset',
        strategyOptions: {
          preset: 'credit-card-number',
          includeAnnotations: true,
          start: 0,
          limit: null,
        },
      },
      {
        type: 'createRedactions',
        strategy: 'regex',
        strategyOptions: {
          regex: '\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b',
          caseSensitive: false,
          includeAnnotations: true,
          start: 0,
          limit: null,
        },
      },
      {
        type: 'applyRedactions',
      },
    ],
    output: {
      type: 'pdf',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with disabled images and maximum optimization
export const disabledImagesExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'pdf',
      optimize: {
        grayscaleText: true,
        grayscaleGraphics: true,
        grayscaleImages: false,
        grayscaleFormFields: false,
        grayscaleAnnotations: false,
        disableImages: true,
        mrcCompression: false,
        imageOptimizationQuality: 1,
        linearize: true,
      },
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Example with PDF/UA output for accessibility
export const pdfUAExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'pdfua',
      metadata: {
        title: 'Accessible Document',
        author: 'Accessibility Team',
      },
    },
  },
  outputPath: 'output_pdfua.pdf',
}

// Example with HTML output using page layout
export const htmlPageLayoutExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'html',
      layout: 'page',
    },
  },
  outputPath: 'output_page.html',
}

// Example with HTML output using reflow layout
export const htmlReflowLayoutExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'html',
      layout: 'reflow',
    },
  },
  outputPath: 'output_reflow.html',
}

// Example with HTML output (default layout)
export const htmlDefaultExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'html',
    },
  },
  outputPath: 'output.html',
}

// Example with Markdown output
export const markdownExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'markdown',
    },
  },
  outputPath: 'output.md',
}

// Example with Markdown output from multiple sources
export const markdownMultipleSourcesExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
        pages: { start: 0, end: 2 },
      },
      {
        file: 'example.docx',
      },
    ],
    output: {
      type: 'markdown',
    },
  },
  outputPath: 'output_combined.md',
}

// Example with JSON content extraction for key-value pairs only
export const jsonContentKeyValuePairsExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'json-content',
      plainText: false,
      keyValuePairs: true,
      tables: false,
      language: 'english',
    },
  },
  outputPath: 'output_kvp.json',
}

// Example with JSON content extraction for tables only
export const jsonContentTablesOnlyExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'json-content',
      plainText: false,
      keyValuePairs: false,
      tables: true,
      language: 'english',
    },
  },
  outputPath: 'output_tables.json',
}

// Example with JSON content extraction with multiple languages
export const jsonContentMultiLanguageExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    output: {
      type: 'json-content',
      plainText: true,
      keyValuePairs: true,
      tables: true,
      language: ['english', 'spanish', 'french'],
    },
  },
  outputPath: 'output_multilang.json',
}

// Complex example with OCR and HTML output
export const ocrToHtmlExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'ocr',
        language: 'english',
      },
    ],
    output: {
      type: 'html',
      layout: 'reflow',
    },
  },
  outputPath: 'output_ocr.html',
}

// Complex example with watermark and Markdown output
export const watermarkToMarkdownExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'watermark',
        watermarkType: 'text',
        text: 'DRAFT',
        width: 100,
        height: 50,
        opacity: 0.3,
        rotation: 45,
        fontColor: '#CCCCCC',
      },
    ],
    output: {
      type: 'markdown',
    },
  },
  outputPath: 'output_watermarked.md',
}

// Example with redactions and PDF/UA output
export const redactedPdfUAExample: BuildAPIArgs = {
  instructions: {
    parts: [
      {
        file: 'example.pdf',
      },
    ],
    actions: [
      {
        type: 'createRedactions',
        strategy: 'preset',
        strategyOptions: {
          preset: 'social-security-number',
          includeAnnotations: true,
          start: 0,
          limit: null,
        },
      },
      {
        type: 'applyRedactions',
      },
    ],
    output: {
      type: 'pdfua',
      metadata: {
        title: 'Redacted Accessible Document',
        author: 'Compliance Team',
      },
    },
  },
  outputPath: 'output_redacted_accessible.pdf',
}
