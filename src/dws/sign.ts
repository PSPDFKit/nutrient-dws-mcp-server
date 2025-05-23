import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { handleApiError, addFileToFormData, handleFileResponse } from './utils.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { SignatureOptions } from '../schemas.js'
import { resolveSandboxFilePath } from '../fs/sandbox.js'
import { callNutrientApi } from './api.js'

/**
 * Performs a sign call to the Nutrient DWS API
 */
export async function performSignCall(
  filePath: string,
  relativeOutputFilePath: string, // TODO: Should we rename this to outputFilePath
  signatureOptions: SignatureOptions = { signatureType: 'cms', flatten: false },
  watermarkImagePath?: string,
  graphicImagePath?: string,
): Promise<CallToolResult> {
  const resolvedPath = resolveSandboxFilePath(filePath)

  const fileBuffer = fs.readFileSync(resolvedPath)
  const fileName = path.basename(resolvedPath)

  try {
    const formData = new FormData()
    formData.append('file', fileBuffer, { filename: fileName })

    if (signatureOptions) {
      formData.append('data', JSON.stringify(signatureOptions))
    }

    if (watermarkImagePath) {
      addFileToFormData(formData, watermarkImagePath, 'watermark')
    }

    if (graphicImagePath) {
      addFileToFormData(formData, graphicImagePath, 'graphic')
    }

    const response = await callNutrientApi('sign', formData)
    return handleFileResponse(response, relativeOutputFilePath, 'File signed successfully')
  } catch (e: unknown) {
    return handleApiError(e)
  }
}
