import FormData from 'form-data'
import { handleApiError, handleFileResponse } from './utils.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { SignatureOptions } from '../schemas.js'
import { callNutrientApi } from './api.js'
import { resolveReadFilePath, resolveWriteFilePath } from '../fs/sandbox.js'
import fs from 'fs'
import path from 'path'

/**
 * Performs a sign call to the Nutrient DWS API
 */
export async function performSignCall(
  filePath: string,
  outputFilePath: string,
  signatureOptions: SignatureOptions = { signatureType: 'cms', flatten: false },
  watermarkImagePath?: string,
  graphicImagePath?: string,
): Promise<CallToolResult> {
  try {
    // We resolve the output path first to fail early
    const resolvedOutputPath = await resolveWriteFilePath(outputFilePath);

    const formData = new FormData()
    await addFileToFormData(formData, "file", filePath)

    if (signatureOptions) {
      formData.append('data', JSON.stringify(signatureOptions))
    }

    if (watermarkImagePath) {
      await addFileToFormData(formData, 'watermark', watermarkImagePath)
    }

    if (graphicImagePath) {
      await addFileToFormData(formData, 'graphic', graphicImagePath)
    }

    const response = await callNutrientApi('sign', formData)

    return handleFileResponse(response, resolvedOutputPath, 'File signed successfully')
  } catch (e: unknown) {
    return handleApiError(e)
  }
}

/**
 * Adds an optional file to the form data
 * @param formData The form data to add the file to
 * @param fieldName Name of the field in the form data
 * @param filePath Path to the file to add
 * @returns Object with error information if any
 */
export async function addFileToFormData(formData: FormData, fieldName: string, filePath: string, ) {
  try {
    const validatedPath = await resolveReadFilePath(filePath)
    const fileBuffer = await fs.promises.readFile(validatedPath)
    formData.append(fieldName, fileBuffer, { filename: path.basename(validatedPath) })
  } catch (error) {
    throw Error(`Error with ${fieldName} image: ${error instanceof Error ? error.message : String(error)}`)
  }
}
