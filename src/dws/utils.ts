import path from 'path'
import fs from 'fs'
import FormData from 'form-data'
import axios, { AxiosResponse } from 'axios'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Readable } from 'stream'
import { resolveOutputFilePath, resolveSandboxFilePath } from '../fs/sandbox.js'
import { writeBufferToFile } from '../fs/utils.js'
import { createSuccessResponse } from '../responses.js'

/**
 * Converts a readable stream to a string
 * @param responseData The readable stream to convert
 * @returns A promise that resolves to the string content of the stream
 */
export async function pipeToString(responseData: Readable): Promise<string> {
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    responseData.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    responseData.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    responseData.on('error', (err) => reject(err))
  })
}

/**
 * Converts a readable stream to a buffer
 * @param responseData The readable stream to convert
 * @returns A promise that resolves to the buffer content of the stream
 */
export async function pipeToBuffer(responseData: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    responseData.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    responseData.on('end', () => resolve(Buffer.concat(chunks)))
    responseData.on('error', (err) => reject(err))
  })
}

/**
 * Validates that the API key is set in the environment
 * @returns Object with error information if API key is not set
 */
export function getApiKey(): string {
  if (!process.env.NUTRIENT_DWS_API_KEY) {
    throw new Error('NUTRIENT_DWS_API_KEY not set in environment')
  }

  return process.env.NUTRIENT_DWS_API_KEY
}

/**
 * Handles API errors and converts them to a standard format
 * @returns Object with error information
 * @param e
 */
export async function handleApiError(e: unknown): Promise<CallToolResult> {
  if (axios.isAxiosError(e) && e.response?.data) {
    try {
      const errorString = await pipeToString(e.response.data)
      try {
        const errorJson = JSON.parse(errorString)

        // Check if the error response matches the expected format
        if (errorJson.details && (errorJson.status || errorJson.requestId || errorJson.failingPaths)) {
          // This appears to be a HostedErrorResponse format
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(errorJson, null, 2),
                isError: true,
              },
            ],
            isError: true,
          }
        }
      } catch (_) {
        // ts-expect-error We can allow an empty block as we'll fall through to default error handling.
      }

      return {
        content: [{ type: 'text', text: `Error processing API response: ${errorString}` }],
        isError: true,
      }
    } catch (streamError) {
      return {
        content: [
          {
            type: 'text',
            text: `Error processing API response: ${streamError instanceof Error ? streamError.message : String(streamError)}`,
          },
        ],
        isError: true,
      }
    }
  } else {
    const errorString = e instanceof Error ? e.message : String(e)
    return {
      content: [{ type: 'text', text: `Error: ${errorString}` }],
      isError: true,
    }
  }
}

/**
 * Handle file response
 */
export async function handleFileResponse(
  response: AxiosResponse,
  outputFilePath: string,
  successMessage: string,
): Promise<CallToolResult> {
  const resultBuffer = await pipeToBuffer(response.data)

  const outputPath = resolveOutputFilePath(outputFilePath)
  const outputDir = path.dirname(outputPath)

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  writeBufferToFile(resultBuffer, outputPath)

  return createSuccessResponse(`${successMessage} and saved to: ${outputPath}`)
}

/**
 * Adds an optional file to the form data
 * @param formData The form data to add the file to
 * @param filePath Path to the file to add
 * @param fieldName Name of the field in the form data
 * @returns Object with error information if any
 */
export function addFileToFormData(formData: FormData, filePath: string, fieldName: string) {
  try {
    const validatedPath = resolveSandboxFilePath(filePath)
    const fileBuffer = fs.readFileSync(validatedPath)
    formData.append(fieldName, fileBuffer, { filename: path.basename(validatedPath) })
  } catch (error) {
    throw Error(`Error with ${fieldName} image: ${error instanceof Error ? error.message : String(error)}`)
  }
}
