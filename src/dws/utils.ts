import path from 'path'
import fs from 'fs'
import axios, { AxiosResponse } from 'axios'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Readable } from 'stream'
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
  resolvedOutputPath: string,
  successMessage: string,
): Promise<CallToolResult> {
  const resultBuffer = await pipeToBuffer(response.data)

  const outputDir = path.dirname(resolvedOutputPath)

  try {
    await fs.promises.access(outputDir)
  } catch {
    await fs.promises.mkdir(outputDir, { recursive: true })
  }

  await fs.promises.writeFile(resolvedOutputPath, resultBuffer)

  return createSuccessResponse(`${successMessage} and saved to: ${resolvedOutputPath}`)
}

/**
 * Handle JSON content response
 */
export async function handleJsonContentResponse(response: AxiosResponse): Promise<CallToolResult> {
  const resultString = await pipeToString(response.data)
  return createSuccessResponse(resultString)
}
