import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { handleApiError, handleFileResponse, pipeToString } from './utils.js'
import { Action, Instructions } from '../schemas.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { FileReference } from './types.js'
import { createErrorResponse, createSuccessResponse } from '../responses.js'
import { AxiosResponse } from 'axios'
import { resolveSandboxFilePath } from '../fs/sandbox.js'
import { callNutrientApi } from './api.js'

/**
 * Performs a build call to the Nutrient DWS Processor API
 */
export async function performBuildCall(
  instructions: Instructions,
  relativeOutputFilePath: string, // TODO: Should we rename this to outputFilePath
): Promise<CallToolResult> {
  const { instructions: adjustedInstructions, fileReferences } = processInstructions(instructions)

  if (fileReferences.size === 0) {
    return createErrorResponse('Error: No valid files or urls found in instructions')
  }

  try {
    const response = await makeApiBuildCall(adjustedInstructions, fileReferences)

    if (adjustedInstructions.output?.type === 'json-content') {
      return handleJsonContentResponse(response)
    } else {
      return handleFileResponse(response, relativeOutputFilePath, 'File processed successfully using build API')
    }
  } catch (e: unknown) {
    return handleApiError(e)
  }
}

/**
 * Process file references in instructions
 */
function processInstructions(instructions: Instructions): {
  instructions: Instructions
  fileReferences: Map<string, FileReference>
} {
  const adjustedInstructions = { ...instructions }
  const fileReferences = new Map<string, FileReference>()

  if (adjustedInstructions.parts) {
    for (const part of adjustedInstructions.parts) {
      if (part.file) {
        const fileReference = processFileReference(part.file)
        part.file = fileReference.key
        fileReferences.set(fileReference.key, fileReference)
      }

      // Actions have been disabled in parts to reduce tool complexity. We can re-enable them if needed.
      // if (part.actions) {
      //   for (const action of part.actions) {
      //     const fileReference = processActionFileReferences(action)
      //     if (fileReference) {
      //       fileReferences.set(fileReference.key, fileReference)
      //     }
      //   }
      // }
    }
  }

  if (adjustedInstructions.actions) {
    for (const action of adjustedInstructions.actions) {
      const fileReference = processActionFileReferences(action)
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
function processActionFileReferences(action: Action): FileReference | undefined {
  if (action.type === 'watermark' && 'image' in action && action.image) {
    const fileReference = processFileReference(action.image)
    action.image = fileReference.key
    return fileReference
  } else if (action.type === 'applyXfdf' && 'file' in action && typeof action.file === 'string') {
    const fileReference = processFileReference(action.file)
    action.file = fileReference.key
    return fileReference
  }

  // No need to parse files for the other actions
  return undefined
}

/**
 * Process a single file reference
 */
function processFileReference(reference: string): FileReference {
  if (reference.startsWith('http://') || reference.startsWith('https://')) {
    return {
      key: reference,
      url: reference,
      name: reference,
    }
  }

  try {
    const resolvedPath = resolveSandboxFilePath(reference)

    const fileBuffer = fs.readFileSync(resolvedPath)
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

/**
 * Handle JSON content response
 */
async function handleJsonContentResponse(response: AxiosResponse): Promise<CallToolResult> {
  const resultString = await pipeToString(response.data)
  return createSuccessResponse(resultString)
}
