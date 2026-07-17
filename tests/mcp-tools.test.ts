import { describe, expect, it } from 'vitest'
import { createMcpServer } from '../src/index.js'
import type { DwsApiClient } from '../src/dws/client.js'

function createMockApiClient(): DwsApiClient {
  return {
    post: async () => {
      throw new Error('not implemented')
    },
    get: async () => {
      throw new Error('not implemented')
    },
  } as unknown as DwsApiClient
}

type RegisteredTool = {
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
  }
}

function getRegisteredTools(sandboxEnabled: boolean): Record<string, RegisteredTool> {
  const server = createMcpServer({
    sandboxEnabled,
    apiClient: createMockApiClient(),
    extractApiClient: createMockApiClient(),
  })

  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools
}

describe('MCP tool metadata', () => {
  it('assigns titles and safety annotations to all sandbox-enabled tools', () => {
    const tools = getRegisteredTools(true)

    expect(Object.keys(tools).sort()).toEqual([
      'ai_redactor',
      'check_credits',
      'data_extractor',
      'document_processor',
      'document_signer',
      'query_extraction',
      'sandbox_file_tree',
    ])

    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.annotations, `${name} is missing annotations`).toBeTruthy()
      expect(tool.annotations?.title, `${name} is missing a title`).toBeTruthy()

      const isReadOnly = tool.annotations?.readOnlyHint === true
      const isDestructive = tool.annotations?.destructiveHint === true
      expect(Number(isReadOnly) + Number(isDestructive), `${name} must be either read-only or destructive`).toBe(1)
    }
  })

  it('registers directory_tree with safety annotations when sandbox mode is disabled', () => {
    const tools = getRegisteredTools(false)
    const directoryTree = tools.directory_tree

    expect(directoryTree).toBeTruthy()
    expect(directoryTree?.annotations?.title).toBeTruthy()
    expect(directoryTree?.annotations?.readOnlyHint).toBe(true)
    expect(directoryTree?.annotations?.destructiveHint).not.toBe(true)
  })
})
