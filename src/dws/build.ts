import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { handleApiError, handleFileResponse, handleJsonContentResponse } from './utils.js'
import { Action, Instructions } from '../schemas.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { FileReference } from './types.js'
import { createErrorResponse } from '../responses.js'
import { resolveReadFilePath, resolveWriteFilePath } from '../fs/sandbox.js'
import { callNutrientApi } from './api.js'

/**
 * Performs a build call to the Nutrient DWS Processor API
 */
export async function performBuildCall(instructions: Instructions, outputFilePath: string): Promise<CallToolResult> {
  const { instructions: adjustedInstructions, fileReferences } = await processInstructions(instructions)

  if (fileReferences.size === 0) {
    return createErrorResponse('Error: No valid files or urls found in instructions')
  }

  try {
    // We resolve the output path first to fail early
    const resolvedOutputPath = await resolveWriteFilePath(outputFilePath)
    const response = await makeApiBuildCall(adjustedInstructions, fileReferences)

    if (adjustedInstructions.output?.type === 'json-content') {
      return handleJsonContentResponse(response)
    } else {
      return handleFileResponse(response, resolvedOutputPath, 'File processed successfully using build API')
    }
  } catch (e: unknown) {
    return handleApiError(e)
  }
}

/**
 * Process file references in instructions
 */
async function processInstructions(instructions: Instructions): Promise<{
  instructions: Instructions
  fileReferences: Map<string, FileReference>
}> {
  const adjustedInstructions = { ...instructions }
  const fileReferences = new Map<string, FileReference>()

  if (adjustedInstructions.parts) {
    for (const part of adjustedInstructions.parts) {
      if (part.file) {
        const fileReference = await processFileReference(part.file)
        part.file = fileReference.key
        fileReferences.set(fileReference.key, fileReference)
      }

      // Actions have been disabled in parts to reduce tool complexity. We can re-enable them if needed.
      // if (part.actions) {
      //   for (const action of part.actions) {
      //     const fileReference = await processActionFileReferences(action)
      //     if (fileReference) {
      //       fileReferences.set(fileReference.key, fileReference)
      //     }
      //   }
      // }
    }
  }

  if (adjustedInstructions.actions) {
    for (const action of adjustedInstructions.actions) {
      const fileReference = await processActionFileReferences(action)
      if (fileReference) {
        fileReferences.set(fileReference.key, fileReference)
      }
    }
  }

  return { instructions: adjustedInstructions, fileReferences }
}

/**
 * Process file references in actions
 */
async function processActionFileReferences(action: Action): Promise<FileReference | undefined> {
  if (action.type === 'watermark' && 'image' in action && action.image) {
    const fileReference = await processFileReference(action.image)
    action.image = fileReference.key
    return fileReference
  } else if (action.type === 'applyXfdf' && 'file' in action && typeof action.file === 'string') {
    const fileReference = await processFileReference(action.file)
    action.file = fileReference.key
    return fileReference
  } else if (action.type === 'applyInstantJson' && 'file' in action && typeof action.file === 'string') {
    const fileReference = await processFileReference(action.file)
    action.file = fileReference.key
    return fileReference
  }

  // No need to parse files for the other actions
  return undefined
}

/**
 * Process a single file reference
 */
async function processFileReference(reference: string): Promise<FileReference> {
  if (reference.startsWith('http://') || reference.startsWith('https://')) {
    return {
      key: reference,
      url: reference,
      name: reference,
    }
  }

  try {
    const resolvedPath = await resolveReadFilePath(reference)

    const fileBuffer = await fs.promises.readFile(resolvedPath)
    const fileName = path.basename(resolvedPath)
    const fileKey = fileName.replace(/[^a-zA-Z0-9]/g, '_')

    return {
      key: fileKey,
      name: fileName,
      file: {
        buffer: fileBuffer,
        path: resolvedPath,
      },
    }
  } catch (error) {
    throw new Error(
      `Error with referenced file ${reference}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Make the API call to the build endpoint
 */
async function makeApiBuildCall(instructions: Instructions, fileReferences: Map<string, FileReference>) {
  const allInputsAreUrls = Array.from(fileReferences.values()).every((fileRef) => fileRef.url)

  if (allInputsAreUrls) {
    return callNutrientApi('build', instructions)
  } else {
    const formData = new FormData()
    formData.append('instructions', JSON.stringify(instructions))

    for (const [key, { file, name }] of fileReferences.entries()) {
      if (file) {
        formData.append(key, file.buffer, { filename: name })
      }
    }

    return callNutrientApi('build', formData)
  }
}
