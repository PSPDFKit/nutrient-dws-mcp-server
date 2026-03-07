import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Environment Validation', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.resetModules()
  })

  it('uses secure defaults for stdio transport', async () => {
    process.env = {}

    const { validateEnvironment } = await import('../src/utils/environment.js')
    const result = validateEnvironment()

    expect(result).toEqual({
      MCP_TRANSPORT: 'stdio',
      MCP_HOST: '127.0.0.1',
      PORT: 5100,
      MCP_ALLOWED_HOSTS: [],
      AUTH_PRINCIPALS: [],
    })
  })

  it('requires inbound auth in http mode', async () => {
    process.env = {
      MCP_TRANSPORT: 'http',
    }

    const { validateEnvironment } = await import('../src/utils/environment.js')

    expect(() => validateEnvironment()).toThrow('HTTP transport requires MCP_BEARER_TOKEN or MCP_BEARER_TOKENS_JSON')
  })

  it('parses single-token bearer auth settings', async () => {
    process.env = {
      MCP_TRANSPORT: 'http',
      MCP_HOST: '0.0.0.0',
      PORT: '8080',
      MCP_ALLOWED_HOSTS: 'mcp.internal.example, connector.example.com ',
      MCP_BEARER_TOKEN: 'secret-token',
      MCP_BEARER_TOKEN_CLIENT_ID: 'cowork-prod',
      MCP_BEARER_TOKEN_SCOPES: 'mcp,documents',
      MCP_BEARER_TOKEN_ALLOWED_TOOLS: 'check_credits,sandbox_file_tree',
    }

    const { validateEnvironment } = await import('../src/utils/environment.js')
    const result = validateEnvironment()

    expect(result).toEqual({
      MCP_TRANSPORT: 'http',
      MCP_HOST: '0.0.0.0',
      PORT: 8080,
      MCP_ALLOWED_HOSTS: ['mcp.internal.example', 'connector.example.com'],
      AUTH_PRINCIPALS: [
        {
          token: 'secret-token',
          clientId: 'cowork-prod',
          scopes: ['mcp', 'documents'],
          allowedTools: ['check_credits', 'sandbox_file_tree'],
        },
      ],
    })
  })

  it('parses multi-principal json config', async () => {
    process.env = {
      MCP_TRANSPORT: 'http',
      MCP_BEARER_TOKENS_JSON: JSON.stringify([
        {
          token: 'token-a',
          clientId: 'cowork-a',
          scopes: ['mcp'],
          allowedTools: ['check_credits'],
        },
        {
          token: 'token-b',
          clientId: 'cowork-b',
          scopes: ['mcp', 'documents'],
        },
      ]),
    }

    const { validateEnvironment } = await import('../src/utils/environment.js')
    const result = validateEnvironment()

    expect(result.AUTH_PRINCIPALS).toEqual([
      {
        token: 'token-a',
        clientId: 'cowork-a',
        scopes: ['mcp'],
        allowedTools: ['check_credits'],
      },
      {
        token: 'token-b',
        clientId: 'cowork-b',
        scopes: ['mcp', 'documents'],
      },
    ])
  })

  it('caches validated environment', async () => {
    process.env = {
      MCP_BEARER_TOKEN: 'secret-token',
      MCP_TRANSPORT: 'http',
    }

    const { getEnvironment } = await import('../src/utils/environment.js')
    const first = getEnvironment()
    const second = getEnvironment()

    expect(first).toBe(second)
  })
})
