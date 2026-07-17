import { describe, expect, it, vi, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import FormData from 'form-data'
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

    let tokenCall = 0
    const onTokenRejected = vi.fn()
    const client = new DwsApiClient({
      baseUrl: srv.url,
      tokenResolver: async () => {
        tokenCall++
        return tokenCall === 1 ? 'stale-token' : 'fresh-token'
      },
      onTokenRejected,
      retryDelayMs: 0,
    })

    const response = await client.get('/test')
    expect(response.status).toBe(200)
    expect(onTokenRejected).toHaveBeenCalledOnce()
    expect(tokenCall).toBeGreaterThanOrEqual(2)
  })

  it('does not retry non-401 errors', async () => {
    const srv = await startTestServer(() => ({ status: 500, body: '{"error":"internal"}' }))
    server = srv.server

    const onTokenRejected = vi.fn()
    const client = new DwsApiClient({
      baseUrl: srv.url,
      tokenResolver: async () => 'tok',
      onTokenRejected,
      retryDelayMs: 0,
    })

    await expect(client.get('/test')).rejects.toThrow()
    expect(onTokenRejected).not.toHaveBeenCalled()
  })

  it('gives up after max retries on persistent 401', async () => {
    let requestCount = 0
    const srv = await startTestServer(() => {
      requestCount++
      return { status: 401, body: '{"error":"unauthorized"}' }
    })
    server = srv.server

    const onTokenRejected = vi.fn()
    const client = new DwsApiClient({
      baseUrl: srv.url,
      tokenResolver: async () => 'always-bad-token',
      onTokenRejected,
      retryDelayMs: 0,
    })

    await expect(client.get('/test')).rejects.toThrow()
    // 1 initial + 3 retries = 4 total requests
    expect(requestCount).toBe(4)
    expect(onTokenRejected).toHaveBeenCalledTimes(3)
  })

  it('calls tokenResolver for each retry to get a fresh token', async () => {
    const tokens: string[] = []
    let reqCount = 0

    const srv = await startTestServer(() => {
      reqCount++
      // Fail first 2, succeed on 3rd
      if (reqCount <= 2) return { status: 401, body: '{"error":"unauthorized"}' }
      return { status: 200, body: '{"ok":true}' }
    })
    server = srv.server

    let tokenCall = 0
    const client = new DwsApiClient({
      baseUrl: srv.url,
      tokenResolver: async () => {
        tokenCall++
        const token = `token-${tokenCall}`
        tokens.push(token)
        return token
      },
      onTokenRejected: vi.fn(),
      retryDelayMs: 0,
    })

    await client.get('/test')
    // Initial buildHeaders call + 2 retries = at least 3 token resolutions
    expect(tokens.length).toBeGreaterThanOrEqual(3)
    // Each retry should produce a different token
    const retryTokens = tokens.slice(1)
    expect(new Set(retryTokens).size).toBe(retryTokens.length)
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

    let tokenCall = 0
    const client = new DwsApiClient({
      baseUrl: `http://127.0.0.1:${addr.port}`,
      tokenResolver: async () => {
        tokenCall++
        return tokenCall === 1 ? 'stale-token' : 'fresh-token'
      },
      onTokenRejected: vi.fn(),
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

  it('works normally when no onTokenRejected is provided', async () => {
    const srv = await startTestServer(() => ({ status: 401, body: '{"error":"unauthorized"}' }))
    server = srv.server

    const client = new DwsApiClient({
      baseUrl: srv.url,
      tokenResolver: async () => 'tok',
      // no onTokenRejected — no interceptor installed
    })

    // Should fail immediately without retrying
    await expect(client.get('/test')).rejects.toThrow()
  })
})
