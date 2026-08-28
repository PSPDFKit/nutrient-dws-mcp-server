import { describe, expect, it, vi, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import FormData from 'form-data'
import { DwsApiClient } from '../src/dws/client.js'
import { StaticKeyCredentialProvider } from '../src/dws/credential-provider.js'
import type { CredentialProvider, Product } from '../src/dws/credential-provider.js'

/** A `CredentialProvider` fake: static tokens by product, with an `invalidate` spy. */
function fakeProvider(tokens: Partial<Record<Product, string[]>>): CredentialProvider {
  const calls: Record<Product, number> = { processor: 0, extraction: 0 }
  return {
    token: vi.fn(async (product: Product) => {
      const sequence = tokens[product] ?? []
      const token = sequence[Math.min(calls[product], sequence.length - 1)]
      calls[product]++
      if (!token) throw new Error(`fakeProvider: no token configured for ${product}`)
      return token
    }),
    invalidate: vi.fn(),
    canRefresh: () => true,
    supports: () => true,
  }
}

describe('DwsApiClient.buildUrl', () => {
  function buildUrl(baseUrl: string, endpoint: string): string {
    const client = new DwsApiClient({ baseUrl, provider: fakeProvider({ processor: ['tok'] }) })
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
    const client = new DwsApiClient({ provider: fakeProvider({ processor: ['tok'] }) })
    expect(client['buildUrl']('/api/build')).toBe('https://api.nutrient.io/api/build')
  })
})

describe('DwsApiClient.productFor', () => {
  function productFor(endpoint: string): Product {
    const client = new DwsApiClient({ provider: fakeProvider({ processor: ['tok'], extraction: ['tok'] }) })
    return client['productFor'](endpoint)
  }

  it.each([
    ['extraction/parse', 'extraction'],
    ['/extraction/parse', 'extraction'],
    ['extraction/extract', 'extraction'],
    ['build', 'processor'],
    ['/build', 'processor'],
    ['sign', 'processor'],
    ['ai/redact', 'processor'],
    ['account/info', 'processor'],
  ] as const)('productFor(%s) => %s', (endpoint, expected) => {
    expect(productFor(endpoint)).toBe(expected)
  })
})

describe('DwsApiClient.authenticate', () => {
  it('resolves and caches a credential without making an HTTP request', async () => {
    const provider = fakeProvider({ processor: ['oauth-token'] })
    const client = new DwsApiClient({ provider })

    await client.authenticate()

    expect(provider.token).toHaveBeenCalledOnce()
    expect(provider.token).toHaveBeenCalledWith('processor')
  })

  it('fails before resolving a credential when the product is unsupported', async () => {
    const provider = fakeProvider({ processor: ['oauth-token'] })
    provider.supports = () => false
    const client = new DwsApiClient({ provider })

    await expect(client.authenticate('extraction')).rejects.toThrow('No credential configured for product "extraction"')
    expect(provider.token).not.toHaveBeenCalled()
  })
})

/** Start a tiny HTTP server that calls `handler` for each request. */
function startTestServer(handler: (reqCount: number) => { status: number; body: string }): Promise<{
  server: Server
  url: string
}> {
  return new Promise((resolve) => {
    let reqCount = 0
    const server = createServer((_req, res) => {
      reqCount++
      const { status, body } = handler(reqCount)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(body)
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()!
      const port = typeof addr === 'string' ? 0 : addr.port
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

describe('DwsApiClient token rotation (401 retry)', () => {
  let server: Server | undefined

  afterEach(() => {
    server?.close()
    server = undefined
  })

  it('retries on 401 and succeeds with a fresh token', async () => {
    const srv = await startTestServer((reqCount) => {
      if (reqCount === 1) return { status: 401, body: '{"error":"unauthorized"}' }
      return { status: 200, body: '{"ok":true}' }
    })
    server = srv.server

    const provider = fakeProvider({ processor: ['stale-token', 'fresh-token'] })
    const client = new DwsApiClient({
      baseUrl: srv.url,
      provider,
      retryDelayMs: 0,
    })

    const response = await client.get('/test')
    expect(response.status).toBe(200)
    expect(provider.invalidate).toHaveBeenCalledOnce()
    expect(provider.invalidate).toHaveBeenCalledWith('processor')
    expect(provider.token).toHaveBeenCalledTimes(2)
  })

  it('awaits invalidate before re-resolving the token on a 401 retry', async () => {
    const srv = await startTestServer((reqCount) =>
      reqCount === 1 ? { status: 401, body: '{"error":"unauthorized"}' } : { status: 200, body: '{"ok":true}' },
    )
    server = srv.server

    let invalidateResolved = false
    let tokenCalls = 0
    let retrySawInvalidateResolved: boolean | undefined
    const provider: CredentialProvider = {
      token: vi.fn(async () => {
        tokenCalls++
        if (tokenCalls === 2) retrySawInvalidateResolved = invalidateResolved
        return 'token'
      }),
      // Resolves on a later tick; with retryDelayMs 0, only a real `await` on invalidate
      // makes the retry's token() observe it as done.
      invalidate: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        invalidateResolved = true
      }),
      canRefresh: () => true,
      supports: () => true,
    }

    const client = new DwsApiClient({ baseUrl: srv.url, provider, retryDelayMs: 0 })
    const response = await client.get('/test')

    expect(response.status).toBe(200)
    expect(provider.invalidate).toHaveBeenCalledOnce()
    expect(retrySawInvalidateResolved).toBe(true)
  })

  it('does not retry non-401 errors', async () => {
    const srv = await startTestServer(() => ({ status: 500, body: '{"error":"internal"}' }))
    server = srv.server

    const provider = fakeProvider({ processor: ['tok'] })
    const client = new DwsApiClient({
      baseUrl: srv.url,
      provider,
      retryDelayMs: 0,
    })

    await expect(client.get('/test')).rejects.toThrow()
    expect(provider.invalidate).not.toHaveBeenCalled()
  })

  it('does not retry a 401 for a static (non-refreshable) credential', async () => {
    let requestCount = 0
    const srv = await startTestServer(() => {
      requestCount++
      return { status: 401, body: '{"error":"unauthorized"}' }
    })
    server = srv.server

    const client = new DwsApiClient({
      baseUrl: srv.url,
      provider: new StaticKeyCredentialProvider({ processor: 'bad-key' }),
      retryDelayMs: 0,
    })

    await expect(client.get('/test')).rejects.toThrow()
    expect(requestCount).toBe(1)
  })

  it('gives up after max retries on persistent 401', async () => {
    let requestCount = 0
    const srv = await startTestServer(() => {
      requestCount++
      return { status: 401, body: '{"error":"unauthorized"}' }
    })
    server = srv.server

    const provider = fakeProvider({ processor: ['always-bad-token'] })
    const client = new DwsApiClient({
      baseUrl: srv.url,
      provider,
      retryDelayMs: 0,
    })

    await expect(client.get('/test')).rejects.toThrow()
    // 1 initial + 3 retries = 4 total requests
    expect(requestCount).toBe(4)
    expect(provider.invalidate).toHaveBeenCalledTimes(3)
  })

  it('calls the provider for each retry to get a fresh token', async () => {
    let reqCount = 0

    const srv = await startTestServer(() => {
      reqCount++
      // Fail first 2, succeed on 3rd
      if (reqCount <= 2) return { status: 401, body: '{"error":"unauthorized"}' }
      return { status: 200, body: '{"ok":true}' }
    })
    server = srv.server

    const provider = fakeProvider({ processor: ['token-1', 'token-2', 'token-3'] })
    const client = new DwsApiClient({
      baseUrl: srv.url,
      provider,
      retryDelayMs: 0,
    })

    await client.get('/test')
    // Initial buildHeaders call + 2 retries = 3 token resolutions
    expect(provider.token).toHaveBeenCalledTimes(3)
  })

  it('retries a FormData POST with the same non-empty body after a 401', async () => {
    const bodies: Buffer[] = []
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks))
        const status = bodies.length === 1 ? 401 : 200
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(status === 401 ? '{"error":"unauthorized"}' : '{"ok":true}')
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    if (addr === null || typeof addr === 'string') throw new Error('expected a bound TCP address')

    const provider = fakeProvider({ processor: ['stale-token', 'fresh-token'] })
    const client = new DwsApiClient({
      baseUrl: `http://127.0.0.1:${addr.port}`,
      provider,
      retryDelayMs: 0,
    })

    const form = new FormData()
    form.append('file', Buffer.from('file-contents'), { filename: 'test.pdf' })

    try {
      const response = await client.post('/upload', form)
      expect(response.status).toBe(200)
      expect(bodies).toHaveLength(2)
      expect(bodies[0].length).toBeGreaterThan(0)
      expect(bodies[1]).toEqual(bodies[0])
    } finally {
      server.close()
    }
  })

  it('invalidates the extraction credential (not processor) when an extraction request 401s', async () => {
    const srv = await startTestServer((reqCount) => {
      if (reqCount === 1) return { status: 401, body: '{"error":"unauthorized"}' }
      return { status: 200, body: '{"ok":true}' }
    })
    server = srv.server

    const provider = fakeProvider({ extraction: ['stale-token', 'fresh-token'] })
    const client = new DwsApiClient({
      baseUrl: srv.url,
      provider,
      retryDelayMs: 0,
    })

    const response = await client.get('/extraction/parse')
    expect(response.status).toBe(200)
    expect(provider.invalidate).toHaveBeenCalledWith('extraction')
  })
})
