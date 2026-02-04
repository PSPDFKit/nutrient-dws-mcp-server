import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { Stats } from 'fs'
import { Readable } from 'stream'
import { config as dotenvConfig } from 'dotenv'
import { performAiRedactCall } from '../src/dws/ai-redact.js'
import * as sandbox from '../src/fs/sandbox.js'
import * as api from '../src/dws/api.js'
import axios, { InternalAxiosRequestConfig } from 'axios'
import path from 'path'
import { FileHandle } from 'fs/promises'
import { CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js'

dotenvConfig()

function getTextContent(result: CallToolResult, index: number = 0): string {
  const content = result.content[index]
  if (content.type === 'text') {
    return (content as TextContent).text
  }
  throw new Error(`Expected text content at index ${index}, got ${content.type}`)
}

vi.mock('axios')
vi.mock('node:fs', { spy: true })
vi.mock('../src/dws/api.js')

function createMockStream(content: string | Buffer): Readable {
  const readable = new Readable()
  readable._read = () => {}
  process.nextTick(() => {
    readable.emit('data', content)
    readable.emit('end')
  })
  return readable
}

describe('performAiRedactCall', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetAllMocks()

    process.env = { ...originalEnv, NUTRIENT_DWS_API_KEY: 'test-api-key' }

    vi.spyOn(fs.promises, 'access').mockImplementation(async () => {})
    vi.spyOn(fs.promises, 'stat').mockReturnValue(
      Promise.resolve({
        isFile: () => true,
        isDirectory: () => true,
      } as Stats),
    )
    vi.spyOn(fs.promises, 'open').mockReturnValue(Promise.resolve({ close: async () => {} } as FileHandle))
    vi.spyOn(fs.promises, 'readFile').mockReturnValue(Promise.resolve(Buffer.from('test pdf content')))
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(async () => {})
    vi.spyOn(fs.promises, 'mkdir').mockReturnValue(Promise.resolve(undefined))

    vi.mocked(api.callNutrientApi).mockImplementation(async () => {
      const mockStream = createMockStream(Buffer.from('redacted pdf content'))
      return {
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should call ai/redact endpoint with correct format', async () => {
    const result = await performAiRedactCall('/test.pdf', 'All personally identifiable information', '/output.pdf')

    expect(result.isError).toBe(false)
    expect(api.callNutrientApi).toHaveBeenCalledWith('ai/redact', expect.any(Object), { timeout: 300000 })
  })

  it('should save the redacted file to output path', async () => {
    await performAiRedactCall('/test.pdf', 'All PII', '/output_redacted.pdf')

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('output_redacted.pdf'),
      expect.any(Buffer),
    )
  })

  it('should return success message with file path', async () => {
    const result = await performAiRedactCall('/test.pdf', 'All PII', '/output.pdf')

    expect(result.isError).toBe(false)
    expect(getTextContent(result)).toContain('AI redaction completed successfully')
    expect(getTextContent(result)).toContain('output.pdf')
  })

  it('should handle file not found error', async () => {
    // The resolveReadFilePath call will succeed (mocked), but we mock access check
    // to fail specifically for the R_OK check inside performAiRedactCall
    vi.spyOn(fs.promises, 'access').mockImplementation(async (filePath, mode) => {
      const p = typeof filePath === 'string' ? filePath : filePath.toString()
      // Let sandbox resolution succeed, but fail the explicit R_OK check
      if (mode === fs.constants.R_OK && (p.includes('nonexistent') || p.includes('test.pdf'))) {
        throw new Error('ENOENT')
      }
    })

    const result = await performAiRedactCall('/nonexistent.pdf', 'All PII', '/output.pdf')

    expect(result.isError).toBe(true)
    expect(getTextContent(result)).toContain('not found or not readable')
  })

  it('should handle API errors', async () => {
    const mockError = {
      response: {
        data: createMockStream('AI redaction error from API'),
      },
    }
    vi.mocked(axios.isAxiosError).mockImplementation(() => true)
    vi.mocked(api.callNutrientApi).mockRejectedValueOnce(mockError)

    const result = await performAiRedactCall('/test.pdf', 'All PII', '/output.pdf')

    expect(result.isError).toBe(true)
    expect(getTextContent(result)).toContain('AI redaction error from API')
  })

  it('should use 5 minute timeout for AI redaction', async () => {
    await performAiRedactCall('/test.pdf', 'All PII', '/output.pdf')

    const callArgs = vi.mocked(api.callNutrientApi).mock.calls[0]
    expect(callArgs[0]).toBe('ai/redact')
    expect(callArgs[2]).toEqual({ timeout: 300000 })
  })

  it('should work with sandbox paths', async () => {
    await sandbox.setSandboxDirectory('/sandbox')

    const mockStream = createMockStream(Buffer.from('redacted content'))
    vi.mocked(api.callNutrientApi).mockResolvedValueOnce({
      data: mockStream,
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as InternalAxiosRequestConfig,
    })

    const result = await performAiRedactCall('test.pdf', 'All PII', 'output.pdf')

    expect(result.isError).toBe(false)

    // Reset sandbox
    await sandbox.setSandboxDirectory(null)
  })

  it('should accept custom criteria', async () => {
    const result = await performAiRedactCall('/test.pdf', 'Only email addresses and phone numbers', '/output.pdf')

    expect(result.isError).toBe(false)
    // Verify callNutrientApi was called (the criteria is in the FormData)
    expect(api.callNutrientApi).toHaveBeenCalled()
  })
})
