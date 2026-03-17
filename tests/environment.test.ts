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

  it('parses default configuration with API key', () => {
    process.env.NUTRIENT_DWS_API_KEY = 'dws-key'

    const environment = getEnvironment()

    expect(environment.nutrientApiKey).toBe('dws-key')
    expect(environment.dwsApiBaseUrl).toBe('https://api.nutrient.io')
    expect(environment.authServerUrl).toBe('https://api.nutrient.io')
  })

  it('allows overriding DWS API base URL', () => {
    process.env.DWS_API_BASE_URL = 'http://localhost:4000'

    const environment = getEnvironment()

    expect(environment.dwsApiBaseUrl).toBe('http://localhost:4000')
  })

  it('allows overriding auth server URL', () => {
    process.env.AUTH_SERVER_URL = 'http://localhost:4000'

    const environment = getEnvironment()

    expect(environment.authServerUrl).toBe('http://localhost:4000')
  })

  it('allows setting client ID', () => {
    process.env.CLIENT_ID = 'my-client'

    const environment = getEnvironment()

    expect(environment.clientId).toBe('my-client')
  })

  it('works without API key (OAuth mode)', () => {
    delete process.env.NUTRIENT_DWS_API_KEY

    const environment = getEnvironment()

    expect(environment.nutrientApiKey).toBeUndefined()
  })

  it('throws when DWS_API_BASE_URL is not a valid URL', () => {
    process.env.DWS_API_BASE_URL = 'not-a-url'

    expect(() => getEnvironment()).toThrow()
  })

  it('rejects non-HTTPS AUTH_SERVER_URL', () => {
    process.env.AUTH_SERVER_URL = 'http://example.com'

    expect(() => getEnvironment()).toThrow(/https/)
  })

  it('allows http://localhost AUTH_SERVER_URL for local development', () => {
    process.env.AUTH_SERVER_URL = 'http://localhost:4000'

    const environment = getEnvironment()

    expect(environment.authServerUrl).toBe('http://localhost:4000')
  })
})
