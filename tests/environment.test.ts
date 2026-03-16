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
    expect(environment.nutrientApiKey).toBe('dws-key')
  })

  it('defaults JWKS URL to api.nutrient.io in HTTP mode', () => {
    process.env.MCP_TRANSPORT = 'http'

    const environment = getEnvironment()

    expect(environment.jwksUrl).toBe('https://api.nutrient.io/.well-known/jwks.json')
  })

  it('accepts private_key_jwt mode without client secret', () => {
    process.env.MCP_TRANSPORT = 'http'
    process.env.JWKS_URL = 'https://auth.example.com/.well-known/jwks.json'
    process.env.CLIENT_ID = 'client-id'
    process.env.TOKEN_ENDPOINT_AUTH_METHOD = 'private_key_jwt'
    process.env.CLIENT_ASSERTION_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'

    const environment = getEnvironment()

    expect(environment.tokenEndpointAuthMethod).toBe('private_key_jwt')
    expect(environment.clientSecret).toBeUndefined()
    expect(environment.clientAssertionPrivateKey).toContain('BEGIN PRIVATE KEY')
  })

  it('defaults issuer to AUTH_SERVER_URL', () => {
    process.env.MCP_TRANSPORT = 'http'

    const environment = getEnvironment()

    expect(environment.issuer).toBe('https://api.nutrient.io')
  })

  it('allows overriding issuer', () => {
    process.env.MCP_TRANSPORT = 'http'
    process.env.ISSUER = 'https://custom-issuer.example.com'

    const environment = getEnvironment()

    expect(environment.issuer).toBe('https://custom-issuer.example.com')
  })
})
