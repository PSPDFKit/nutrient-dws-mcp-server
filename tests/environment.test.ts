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

  it('defaults JWKS URL to api.nutrient.io in HTTP JWT mode', () => {
    process.env.MCP_TRANSPORT = 'http'
    process.env.AUTH_MODE = 'jwt'

    const environment = getEnvironment()

    expect(environment.jwksUrl).toBe('https://api.nutrient.io/.well-known/jwks.json')
  })

  it('accepts private_key_jwt mode without client secret', () => {
    process.env.MCP_TRANSPORT = 'http'
    process.env.AUTH_MODE = 'jwt'
    process.env.JWKS_URL = 'https://auth.example.com/.well-known/jwks.json'
    process.env.CLIENT_ID = 'client-id'
    process.env.TOKEN_ENDPOINT_AUTH_METHOD = 'private_key_jwt'
    process.env.CLIENT_ASSERTION_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'

    const environment = getEnvironment()

    expect(environment.tokenEndpointAuthMethod).toBe('private_key_jwt')
    expect(environment.clientSecret).toBeUndefined()
    expect(environment.clientAssertionPrivateKey).toContain('BEGIN PRIVATE KEY')
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
