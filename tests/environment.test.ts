import { describe, expect, it } from 'vitest'
import { getEnvironment } from '../src/utils/environment.js'

describe('environment', () => {
  it('parses default configuration with API key', () => {
    const environment = getEnvironment({ NUTRIENT_DWS_API_KEY: 'dws-key' })

    expect(environment.nutrientApiKey).toBe('dws-key')
    expect(environment.dwsApiBaseUrl).toBe('https://api.nutrient.io')
    expect(environment.authServerUrl).toBe('https://api.nutrient.io')
  })

  it('allows overriding DWS API base URL', () => {
    const environment = getEnvironment({ DWS_API_BASE_URL: 'http://localhost:4000' })

    expect(environment.dwsApiBaseUrl).toBe('http://localhost:4000')
  })

  it('allows overriding auth server URL', () => {
    const environment = getEnvironment({ AUTH_SERVER_URL: 'http://localhost:4000' })

    expect(environment.authServerUrl).toBe('http://localhost:4000')
  })

  it('allows setting client ID', () => {
    const environment = getEnvironment({ CLIENT_ID: 'my-client' })

    expect(environment.clientId).toBe('my-client')
  })

  it('works without API key (OAuth mode)', () => {
    const environment = getEnvironment({})

    expect(environment.nutrientApiKey).toBeUndefined()
  })

  it('throws when DWS_API_BASE_URL is not a valid URL', () => {
    expect(() => getEnvironment({ DWS_API_BASE_URL: 'not-a-url' })).toThrow()
  })

  it('rejects non-HTTPS AUTH_SERVER_URL', () => {
    expect(() => getEnvironment({ AUTH_SERVER_URL: 'http://example.com' })).toThrow(/https/)
  })

  it('allows http://localhost AUTH_SERVER_URL for local development', () => {
    const environment = getEnvironment({ AUTH_SERVER_URL: 'http://localhost:4000' })

    expect(environment.authServerUrl).toBe('http://localhost:4000')
  })
})
