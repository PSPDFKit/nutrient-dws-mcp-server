import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getEnvironment, resetEnvironmentForTests } from '../src/utils/environment.js'

describe('environment', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    resetEnvironmentForTests()
  })

  afterEach(() => {
    process.env = originalEnv
    resetEnvironmentForTests()
  })

  it('parses default stdio configuration', () => {
    process.env.NUTRIENT_DWS_API_KEY = 'dws-key'

    const environment = getEnvironment()

    expect(environment.transportMode).toBe('stdio')
    expect(environment.authMode).toBe('static')
    expect(environment.nutrientApiKey).toBe('dws-key')
  })

  it('requires bearer token config in HTTP static mode', () => {
    process.env.MCP_TRANSPORT = 'http'
    process.env.AUTH_MODE = 'static'
    process.env.NUTRIENT_DWS_API_KEY = 'dws-key'

    expect(() => getEnvironment()).toThrow(/Static HTTP auth requires bearer tokens/)
  })

  it('requires JWKS URL in HTTP JWT mode', () => {
    process.env.MCP_TRANSPORT = 'http'
    process.env.AUTH_MODE = 'jwt'
    process.env.CLIENT_ID = 'client-id'
    process.env.CLIENT_SECRET = 'client-secret'

    expect(() => getEnvironment()).toThrow(/requires JWKS_URL/)
  })

  it('requires client credentials in HTTP JWT mode', () => {
    process.env.MCP_TRANSPORT = 'http'
    process.env.AUTH_MODE = 'jwt'
    process.env.JWKS_URL = 'https://auth.example.com/.well-known/jwks.json'

    expect(() => getEnvironment()).toThrow(/requires CLIENT_ID and CLIENT_SECRET/)
  })

  it('parses principals from MCP_BEARER_TOKENS_JSON', () => {
    process.env.MCP_TRANSPORT = 'http'
    process.env.AUTH_MODE = 'static'
    process.env.NUTRIENT_DWS_API_KEY = 'dws-key'
    process.env.MCP_BEARER_TOKENS_JSON = JSON.stringify([
      {
        token: 'abc123',
        clientId: 'co-work',
        scopes: ['mcp:invoke'],
        allowedTools: ['check_credits'],
      },
    ])

    const environment = getEnvironment()

    expect(environment.staticPrincipals).toHaveLength(1)
    expect(environment.staticPrincipals[0]).toEqual(
      expect.objectContaining({
        token: 'abc123',
        clientId: 'co-work',
        scopes: ['mcp:invoke'],
        allowedTools: ['check_credits'],
      }),
    )
  })
})
