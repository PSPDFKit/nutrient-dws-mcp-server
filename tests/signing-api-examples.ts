import { SignAPIArgs } from '../src/schemas.js'

/**
 * Dataset of diverse examples covering the feature set of SignAPIArgsSchema
 * These examples aim for maximal coverage of the schema's capabilities
 *
 * The examples cover:
 * - Different signature types (CMS, CAdES)
 * - Various appearance configurations
 * - Different signature positions
 * - Metadata options
 * - Watermark and graphic image usage
 * - Form field signing
 */

// Basic signature example
export const basicSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: false,
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: false,
      showReason: false,
      showLocation: false,
      showWatermark: true,
    },
    position: {
      pageIndex: 0,
      rect: [50, 50, 200, 100],
    },
    signatureMetadata: {
      signerName: 'John Doe',
      signatureReason: 'Document approval',
      signatureLocation: 'San Francisco',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Invisible signature example
export const invisibleSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: false,
    signatureMetadata: {
      signerName: 'Jane Smith',
      signatureReason: 'Document verification',
      signatureLocation: 'New York',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// CAdES signature example
export const cadesSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cades',
    cadesLevel: 'b-lt',
    flatten: false,
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: true,
      showReason: true,
      showLocation: true,
      showWatermark: true,
    },
    position: {
      pageIndex: 0,
      rect: [50, 200, 200, 100],
    },
    signatureMetadata: {
      signerName: 'Robert Johnson',
      signatureReason: 'Final approval',
      signatureLocation: 'Chicago',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Signature with watermark image example
export const watermarkSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: false,
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: false,
      showReason: true,
      showLocation: false,
      showWatermark: true,
    },
    position: {
      pageIndex: 0,
      rect: [50, 350, 200, 100],
    },
    signatureMetadata: {
      signerName: 'Sarah Williams',
      signatureReason: 'Document review',
      signatureLocation: 'Boston',
    },
  },
  watermarkImagePath: 'example.png',
  outputPath: 'output_pdf.pdf',
}

// Signature with graphic image example
export const graphicSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: false,
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: false,
      showReason: false,
      showLocation: false,
      showWatermark: true,
    },
    position: {
      pageIndex: 0,
      rect: [300, 50, 200, 100],
    },
    signatureMetadata: {
      signerName: 'Michael Brown',
      signatureReason: 'Document certification',
      signatureLocation: 'Los Angeles',
    },
  },
  graphicImagePath: 'example.jpg',
  outputPath: 'output_pdf.pdf',
}

// Signature with both watermark and graphic images
export const combinedImagesSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: false,
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: false,
      showReason: true,
      showLocation: true,
      showWatermark: true,
    },
    position: {
      pageIndex: 0,
      rect: [300, 200, 200, 100],
    },
    signatureMetadata: {
      signerName: 'Emily Davis',
      signatureReason: 'Final review',
      signatureLocation: 'Seattle',
    },
  },
  watermarkImagePath: 'example.png',
  graphicImagePath: 'example.jpg',
  outputPath: 'output_pdf.pdf',
}

// Signature with form field name
// Note: This example assumes a PDF with a signature field exists
// For testing purposes, we'll use a regular PDF but this would normally require a PDF with a signature field
export const formFieldSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: true,
    // formFieldName: 'Signature1', // Uncomment when using a PDF with a signature field
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: false,
      showReason: true,
      showLocation: true,
      showWatermark: true,
    },
    position: {
      pageIndex: 0,
      rect: [50, 500, 200, 100],
    },
    signatureMetadata: {
      signerName: 'David Wilson',
      signatureReason: 'Form completion',
      signatureLocation: 'Denver',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Signature with description only mode
export const descriptionOnlySignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: false,
    appearance: {
      mode: 'descriptionOnly',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: false,
      showReason: true,
      showLocation: true,
      showWatermark: false,
    },
    position: {
      pageIndex: 0,
      rect: [300, 350, 200, 100],
    },
    signatureMetadata: {
      signerName: 'Lisa Johnson',
      signatureReason: 'Information only',
      signatureLocation: 'Miami',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Signature with signature only mode
export const signatureOnlyExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: false,
    appearance: {
      mode: 'signatureOnly',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: false,
      showReason: false,
      showLocation: false,
      showWatermark: true,
    },
    position: {
      pageIndex: 1,
      rect: [50, 50, 200, 100],
    },
    signatureMetadata: {
      signerName: 'Thomas Anderson',
      signatureReason: 'Visual approval',
      signatureLocation: 'Austin',
    },
  },
  graphicImagePath: 'example.jpg',
  outputPath: 'output_pdf.pdf',
}

// Signature with flattening
export const flattenedSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: true,
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: false,
      showReason: true,
      showLocation: true,
      showWatermark: true,
    },
    position: {
      pageIndex: 1,
      rect: [50, 200, 200, 100],
    },
    signatureMetadata: {
      signerName: 'Patricia Miller',
      signatureReason: 'Final document',
      signatureLocation: 'Philadelphia',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// Signature with overwrite original
// Note: This example would normally overwrite the original file
// For testing purposes, we'll set overwriteOriginal to false to avoid modifying test files
export const overwriteSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cms',
    flatten: false,
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: false,
      showReason: false,
      showLocation: false,
      showWatermark: true,
    },
    position: {
      pageIndex: 0,
      rect: [50, 50, 200, 100],
    },
    signatureMetadata: {
      signerName: 'James Wilson',
      signatureReason: 'Document approval',
      signatureLocation: 'Dallas',
    },
  },
  outputPath: 'output_pdf.pdf', // Changed to false for testing to avoid modifying test files
}

// CAdES B-B level signature
export const cadesBBSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cades',
    cadesLevel: 'b-b',
    flatten: false,
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: true,
      showReason: true,
      showLocation: true,
      showWatermark: true,
    },
    position: {
      pageIndex: 1,
      rect: [300, 50, 200, 100],
    },
    signatureMetadata: {
      signerName: 'Elizabeth Taylor',
      signatureReason: 'Basic approval',
      signatureLocation: 'Washington DC',
    },
  },
  outputPath: 'output_pdf.pdf',
}

// CAdES B-T level signature
export const cadesBTSignatureExample: SignAPIArgs = {
  filePath: 'example.pdf',
  signatureOptions: {
    signatureType: 'cades',
    cadesLevel: 'b-t',
    flatten: false,
    appearance: {
      mode: 'signatureAndDescription',
      showSigner: true,
      showSignDate: true,
      showDateTimezone: true,
      showReason: true,
      showLocation: true,
      showWatermark: true,
    },
    position: {
      pageIndex: 1,
      rect: [300, 200, 200, 100],
    },
    signatureMetadata: {
      signerName: 'Richard Harris',
      signatureReason: 'Timestamped approval',
      signatureLocation: 'Atlanta',
    },
  },
  outputPath: 'output_pdf.pdf',
}
