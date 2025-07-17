/**
 * Tool definitions for the MCP server
 * This file contains all tool information needed for both server registration and manifest generation
 */

import { BuildAPIArgsSchema, DirectoryTreeArgsSchema, SignAPIArgsSchema } from './schemas.js'
import { performBuildCall } from './dws/build.js'
import { performSignCall } from './dws/sign.js'
import { performDirectoryTreeCall } from './fs/directoryTree.js'
import { createErrorResponse } from './responses.js'

export interface ToolDefinition {
  name: string
  mcpDescription: string
  publicDescription: string
  schema: any
  handler: (args: any) => Promise<any>
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'document_processor',
    mcpDescription: `Processes documents using Nutrient DWS Processor API. Reads from and writes to file system or sandbox (if enabled).

Features:
• Import XFDF annotations
• Flatten annotations
• OCR processing
• Page rotation
• Watermarking (text/image)
• Redaction creation and application

Output formats: PDF, PDF/A, images (PNG, JPEG, WebP), JSON extraction, Office (DOCX, XLSX, PPTX)`,
    publicDescription: 'Document creation, editing, format conversion, data extraction, security, OCR, and optimization. Merge PDFs/Office docs/images, watermark, rotate, flatten, redact, convert PDF↔DOCX/images/PDF/A, extract text/tables/content, password protection, multi-language OCR, and file compression.',
    schema: BuildAPIArgsSchema.shape,
    handler: async ({ instructions, outputPath }) => {
      try {
        return performBuildCall(instructions, outputPath)
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  },
  {
    name: 'document_signer',
    mcpDescription: `Digitally signs PDF files using Nutrient DWS Sign API. Reads from and writes to file system or sandbox (if enabled).

Signature types:
• CMS/PKCS#7 (standard digital signatures)
• CAdES (advanced electronic signatures)

Appearance options:
• Visible or invisible signatures
• Multiple display modes (signature only, description only, or both)
• Customizable elements (signer name, reason, location, date)
• Support for watermarks and custom graphics

Positioning:
• Place on specific page coordinates
• Use existing signature form fields`,
    publicDescription: 'Digital signing with PAdES standards-compliant signatures using trusted certificates. Supports CMS/PKCS#7 and CAdES signature types with customizable appearance, positioning, watermarks and graphics.',
    schema: SignAPIArgsSchema.shape,
    handler: async ({ filePath, signatureOptions, watermarkImagePath, graphicImagePath, outputPath }) => {
      try {
        return performSignCall(filePath, outputPath, signatureOptions, watermarkImagePath, graphicImagePath)
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  },
  {
    name: 'directory_tree',
    mcpDescription: 'Returns the directory tree of a given path. All paths are resolved relative to root directory.',
    publicDescription: 'Returns the directory tree of a given path. All paths are resolved relative to root directory. Only available when sandbox mode is disabled.',
    schema: DirectoryTreeArgsSchema.shape,
    handler: async ({ path }) => performDirectoryTreeCall(path)
  },
  {
    name: 'sandbox_file_tree',
    mcpDescription: 'Returns the file tree of the sandbox directory. It will recurse into subdirectories and return a list of files and directories.',
    publicDescription: 'Returns the file tree of the sandbox directory when sandbox mode is enabled. Recurses into subdirectories and returns a list of files and directories.',
    schema: {},
    handler: async () => performDirectoryTreeCall('.')
  }
]
