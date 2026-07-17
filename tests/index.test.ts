import { describe, expect, it, vi } from 'vitest'
import { createMcpServer, createStdioApiClients } from '../src/index.js'
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

function createMockApiClient(): DwsApiClient {
  const post = vi.fn().mockRejectedValue(new Error('should not be called'))
  return { post, get: post } as unknown as DwsApiClient
}

function text(result: CallToolResult): string {
  return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
}

describe('createStdioApiClients', () => {
  it('shares one client between apiClient and extractApiClient under OAuth (product:all covers both)', () => {
    const { apiClient, extractApiClient } = createStdioApiClients(baseEnvironment())

    expect(extractApiClient).toBe(apiClient)
  })

  it('builds a distinct extractApiClient when NUTRIENT_DWS_EXTRACT_API_KEY is set alongside a static key', () => {
    const { apiClient, extractApiClient } = createStdioApiClients(
      baseEnvironment({ nutrientApiKey: 'processor-key', nutrientExtractApiKey: 'pdf_live_extract-key' }),
    )

    expect(extractApiClient).not.toBe(apiClient)
    expect(extractApiClient).not.toBeNull()
  })

  it('leaves extractApiClient null under a static key with no extraction key configured', () => {
    const { extractApiClient } = createStdioApiClients(baseEnvironment({ nutrientApiKey: 'processor-key' }))

    expect(extractApiClient).toBeNull()
  })

  it('throws when NUTRIENT_DWS_EXTRACT_API_KEY is set without NUTRIENT_DWS_API_KEY', () => {
    expect(() =>
      createStdioApiClients(baseEnvironment({ nutrientExtractApiKey: 'pdf_live_extract-key' })),
    ).toThrow(/NUTRIENT_DWS_EXTRACT_API_KEY.*NUTRIENT_DWS_API_KEY/s)
  })
})

describe('data_extractor with no extraction credential', () => {
  it('fails fast without calling the API and names NUTRIENT_DWS_EXTRACT_API_KEY', async () => {
    const apiClient = createMockApiClient()
    const server = createMcpServer({ sandboxEnabled: true, apiClient, extractApiClient: null })

    const tool = (
      server as unknown as {
        _registeredTools: Record<string, { handler: (args: unknown) => Promise<CallToolResult> }>
      }
    )._registeredTools.data_extractor

    const result = await tool.handler({ filePath: 'input.pdf', mode: 'text' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('NUTRIENT_DWS_EXTRACT_API_KEY')
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})
