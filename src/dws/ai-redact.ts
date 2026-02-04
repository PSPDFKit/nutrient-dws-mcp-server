import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { handleApiError, handleFileResponse } from './utils.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createErrorResponse } from '../responses.js'
import { resolveReadFilePath, resolveWriteFilePath } from '../fs/sandbox.js'
import { callNutrientApi } from './api.js'

/**
 * Performs an AI redaction call to the Nutrient DWS AI Redact API.
 *
 * Unlike pattern-based redaction (createRedactions + applyRedactions via /build),
 * AI redaction uses the /ai/redact endpoint which automatically detects and
 * permanently removes sensitive information using AI analysis.
 *
 * The /ai/redact endpoint uses a different request format than /build:
 * - file1: the document to redact (multipart file)
 * - data: JSON string with documents array and criteria
 *
 * Typical response time: 60-120 seconds due to AI analysis.
 */
export async function performAiRedactCall(
  filePath: string,
  criteria: string,
  outputPath: string,
): Promise<CallToolResult> {
  try {
    const resolvedInputPath = await resolveReadFilePath(filePath)
    const resolvedOutputPath = await resolveWriteFilePath(outputPath)

    // Verify input file exists
    try {
      await fs.promises.access(resolvedInputPath, fs.constants.R_OK)
    } catch {
      return createErrorResponse(`Error: Input file not found or not readable: ${filePath}`)
    }

    const fileBuffer = await fs.promises.readFile(resolvedInputPath)
    const fileName = path.basename(resolvedInputPath)

    // Build the /ai/redact request format:
    // - file1: the document (multipart file field)
    // - data: JSON with documents array and criteria
    const formData = new FormData()
    formData.append('file1', fileBuffer, { filename: fileName })
    formData.append(
      'data',
      JSON.stringify({
        documents: [{ documentId: 'file1' }],
        criteria: criteria,
      }),
    )

    const response = await callNutrientApi('ai/redact', formData, {
      timeout: 300000, // 5 minutes — AI redaction takes 60-120s typically
    })

    return handleFileResponse(response, resolvedOutputPath, 'AI redaction completed successfully. Output saved to')
  } catch (e: unknown) {
    return handleApiError(e)
  }
}
