import { describe, expect, it } from 'vitest'
import { DwsApiClient } from '../src/dws/client.js'

describe('DwsApiClient.buildUrl', () => {
  function buildUrl(baseUrl: string, endpoint: string): string {
    const client = new DwsApiClient({ baseUrl, tokenResolver: async () => 'tok' })
    return client['buildUrl'](endpoint)
  }

  it.each([
    ['https://api.nutrient.io', '/api/build', 'https://api.nutrient.io/api/build'],
    ['https://api.nutrient.io/', 'api/build', 'https://api.nutrient.io/api/build'],
    ['https://api.nutrient.io', 'api/build', 'https://api.nutrient.io/api/build'],
    ['https://api.nutrient.io/', '/api/build', 'https://api.nutrient.io/api/build'],
  ])('buildUrl(%s, %s) => %s', (baseUrl, endpoint, expected) => {
    expect(buildUrl(baseUrl, endpoint)).toBe(expected)
  })

  it('uses default base URL when not specified', () => {
    const client = new DwsApiClient({ tokenResolver: async () => 'tok' })
    expect(client['buildUrl']('/api/build')).toBe('https://api.nutrient.io/api/build')
  })
})
