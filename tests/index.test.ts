import { describe, expect, it, vi } from 'vitest'
import { createMcpServer } from '../src/index.js'
import { createApiClient } from '../src/dws/api.js'
import type { Environment } from '../src/utils/environment.js'
import type { DwsApiClient } from '../src/dws/client.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

function baseEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    dwsApiBaseUrl: 'https://api.nutrient.io',
    authServerUrl: 'https://api.nutrient.io',
    ...overrides,
  }
}

function createMockApiClient(overrides: { supports?: (product: 'processor' | 'extraction') => boolean } = {}): DwsApiClient {
  const post = vi.fn().mockRejectedValue(new Error('should not be called'))
  return { post, get: post, supports: overrides.supports ?? (() => true) } as unknown as DwsApiClient
}

function text(result: CallToolResult): string {
  return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
}

describe('createApiClient', () => {
  it('supports both products under OAuth (product:all covers both)', () => {
    const apiClient = createApiClient(baseEnvironment())

    expect(apiClient.supports('processor')).toBe(true)
    expect(apiClient.supports('extraction')).toBe(true)
  })

  it('supports only the processor product when NUTRIENT_DWS_API_KEY alone is set', () => {
    const apiClient = createApiClient(baseEnvironment({ nutrientApiKey: 'processor-key' }))

    expect(apiClient.supports('processor')).toBe(true)
    expect(apiClient.supports('extraction')).toBe(false)
  })

  it('supports only the extraction product when NUTRIENT_DWS_EXTRACT_API_KEY alone is set', () => {
    const apiClient = createApiClient(baseEnvironment({ nutrientExtractApiKey: 'pdf_live_extract-key' }))

    expect(apiClient.supports('processor')).toBe(false)
    expect(apiClient.supports('extraction')).toBe(true)
  })

  it('supports both products when both static keys are set', () => {
    const apiClient = createApiClient(
      baseEnvironment({ nutrientApiKey: 'processor-key', nutrientExtractApiKey: 'pdf_live_extract-key' }),
    )

    expect(apiClient.supports('processor')).toBe(true)
    expect(apiClient.supports('extraction')).toBe(true)
  })
})

describe('parse_document with no extraction credential', () => {
  it('fails fast without calling the API and names NUTRIENT_DWS_EXTRACT_API_KEY', async () => {
    const apiClient = createMockApiClient({ supports: (product) => product === 'processor' })
    const server = createMcpServer({ sandboxEnabled: true, apiClient })

    const tool = (
      server as unknown as {
        _registeredTools: Record<string, { handler: (args: unknown) => Promise<CallToolResult> }>
      }
    )._registeredTools.parse_document

    const result = await tool.handler({ filePath: 'input.pdf', mode: 'text' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('NUTRIENT_DWS_EXTRACT_API_KEY')
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})

describe('extraction-only server (no Processor credential)', () => {
  it('registers both Processor and extraction tools', () => {
    const apiClient = createMockApiClient({ supports: (product) => product === 'extraction' })

    expect(() => createMcpServer({ sandboxEnabled: true, apiClient })).not.toThrow()

    const server = createMcpServer({ sandboxEnabled: true, apiClient })
    const tools = (
      server as unknown as {
        _registeredTools: Record<string, { handler: (args: unknown) => Promise<CallToolResult> }>
      }
    )._registeredTools

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        'document_processor',
        'document_signer',
        'ai_redactor',
        'check_credits',
        'parse_document',
        'extract_fields',
      ]),
    )
  })

  it('Processor tools return the missing-credential error without calling the API', async () => {
    const apiClient = createMockApiClient({ supports: (product) => product === 'extraction' })
    const server = createMcpServer({ sandboxEnabled: true, apiClient })

    const tools = (
      server as unknown as {
        _registeredTools: Record<string, { handler: (args: unknown) => Promise<CallToolResult> }>
      }
    )._registeredTools

    const buildResult = await tools.document_processor.handler({ instructions: {}, outputPath: 'out.pdf' })
    const creditsResult = await tools.check_credits.handler({})

    expect(buildResult.isError).toBe(true)
    expect(text(buildResult)).toContain('NUTRIENT_DWS_API_KEY')
    expect(creditsResult.isError).toBe(true)
    expect(text(creditsResult)).toContain('NUTRIENT_DWS_API_KEY')
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})
