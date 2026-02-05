import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { handleApiError, handleFileResponse } from './utils.js'
import { createErrorResponse } from '../responses.js'
import { resolveReadFilePath, resolveWriteFilePath } from '../fs/sandbox.js'
import { callNutrientApi } from './api.js'

/**
 * Performs an AI redaction call to the Nutrient DWS AI Redact API.
 */
export async function performAiRedactCall(
  filePath: string,
  criteria: string,
  outputPath: string,
  stage?: boolean,
  apply?: boolean,
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

    if (stage && apply) {
      return createErrorResponse('Error: stage and apply cannot both be true. Choose one mode.')
    }

    // Guard against output overwriting input
    if (path.resolve(resolvedInputPath) === path.resolve(resolvedOutputPath)) {
      return createErrorResponse(
        'Error: Output path must be different from input path to prevent data corruption.',
      )
    }

    const fileBuffer = await fs.promises.readFile(resolvedInputPath)
    const fileName = path.basename(resolvedInputPath)

    const redactionState = stage ? 'stage' : apply ? 'apply' : undefined

    const dataPayload: { documents: Array<{ documentId: string }>; criteria: string; redaction_state?: string } = {
      documents: [{ documentId: 'file1' }],
      criteria,
    }

    if (redactionState) {
      dataPayload.redaction_state = redactionState
    }

    const formData = new FormData()
    formData.append('file1', fileBuffer, { filename: fileName })
    formData.append('data', JSON.stringify(dataPayload))

    const response = await callNutrientApi('ai/redact', formData)

    return handleFileResponse(response, resolvedOutputPath, 'AI redaction completed successfully. Output saved to')
  } catch (e: unknown) {
    return handleApiError(e)
  }
}
