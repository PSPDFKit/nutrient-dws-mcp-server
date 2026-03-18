import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  getDefaultCredentialsPath,
  isTokenExpired,
  readCachedCredentials,
} from '../src/auth/nutrient-oauth.js'
import type { NutrientOAuthConfig } from '../src/auth/nutrient-oauth.js'

// Stub `open` so the browser never launches during getToken integration tests
vi.mock('open', () => ({ default: vi.fn() }))

describe('generateCodeVerifier', () => {
  it('produces a valid base64url string', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/) // no +, /, or =
    expect(verifier.length).toBeGreaterThanOrEqual(43) // RFC 7636 minimum
  })

  it('produces different values on each call', () => {
    const a = generateCodeVerifier()
    const b = generateCodeVerifier()
    expect(a).not.toBe(b)
  })
})

describe('generateCodeChallenge', () => {
  it('produces RFC 7636-compliant S256 challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(generateCodeChallenge(verifier)).toBe(expected)
  })

  it('produces a valid base64url string', () => {
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/) // no +, /, or =
  })

  it('is deterministic for the same input', () => {
    const verifier = 'test-verifier'
    expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier))
  })
})

describe('isTokenExpired', () => {
  it('treats missing expiresAt as expired', () => {
    expect(isTokenExpired({ accessToken: 'tok' })).toBe(true)
  })

  it('treats token expiring in 30s as expired (within 60s buffer)', () => {
    expect(isTokenExpired({ accessToken: 'tok', expiresAt: Date.now() + 30_000 })).toBe(true)
  })

  it('treats token expiring in 90s as valid (outside 60s buffer)', () => {
    expect(isTokenExpired({ accessToken: 'tok', expiresAt: Date.now() + 90_000 })).toBe(false)
  })

  it('treats token already past expiresAt as expired', () => {
    expect(isTokenExpired({ accessToken: 'tok', expiresAt: Date.now() - 1000 })).toBe(true)
  })

  it('treats token expiring far in the future as valid', () => {
    expect(isTokenExpired({ accessToken: 'tok', expiresAt: Date.now() + 3600_000 })).toBe(false)
  })
})

describe('readCachedCredentials', () => {
  const testDir = join(tmpdir(), `nutrient-oauth-test-${Date.now()}`)
  const testPath = join(testDir, 'credentials.json')

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('returns null for non-existent file', async () => {
    const result = await readCachedCredentials(join(testDir, 'nonexistent.json'))
    expect(result).toBeNull()
  })

  it('returns parsed credentials for valid file', async () => {
    const creds = { accessToken: 'tok123', refreshToken: 'ref456', expiresAt: 9999999999999 }
    await writeFile(testPath, JSON.stringify(creds))
    const result = await readCachedCredentials(testPath)
    expect(result).toEqual(creds)
  })

  it('returns null for malformed JSON', async () => {
    await writeFile(testPath, 'not-json')
    const result = await readCachedCredentials(testPath)
    expect(result).toBeNull()
  })

  it('returns null for valid JSON missing required fields', async () => {
    await writeFile(testPath, JSON.stringify({ refreshToken: 'ref' }))
    const result = await readCachedCredentials(testPath)
    expect(result).toBeNull()
  })

  it('includes clientId when present', async () => {
    const creds = { accessToken: 'tok', clientId: 'my-client' }
    await writeFile(testPath, JSON.stringify(creds))
    const result = await readCachedCredentials(testPath)
    expect(result?.clientId).toBe('my-client')
  })
})

describe('getDefaultCredentialsPath', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    const path = getDefaultCredentialsPath({ XDG_CONFIG_HOME: '/tmp/xdg-config' }, '/home/tester')

    expect(path).toBe('/tmp/xdg-config/nutrient/credentials.json')
  })

  it('falls back to ~/.config when XDG_CONFIG_HOME is not set', () => {
    const path = getDefaultCredentialsPath({}, '/home/tester')

    expect(path).toBe('/home/tester/.config/nutrient/credentials.json')
  })
})

// ---------------------------------------------------------------------------
// getToken integration helpers
// ---------------------------------------------------------------------------

/** Spin up a tiny HTTP server that responds to token requests. */
function startFakeTokenServer(handler: (params: URLSearchParams) => object | [number, string]): Promise<{
  server: Server
  url: string
}> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = Buffer.concat(chunks).toString()
      const params = new URLSearchParams(body)

      const result = handler(params)
      if (Array.isArray(result)) {
        const [status, text] = result
        res.writeHead(status, { 'Content-Type': 'text/plain' })
        res.end(text)
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()!
      const port = typeof addr === 'string' ? 0 : addr.port
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

function makeConfig(overrides: Partial<NutrientOAuthConfig> & { tokenUrl: string; credentialsPath: string }): NutrientOAuthConfig {
  return {
    authorizeUrl: 'http://localhost/authorize',
    scopes: ['dws'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// getToken integration tests
// ---------------------------------------------------------------------------

describe('getToken integration', () => {
  const testDir = join(tmpdir(), `gettoken-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const credsPath = join(testDir, 'credentials.json')
  let tokenServer: Server | undefined

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
    vi.resetModules()
  })

  afterEach(async () => {
    tokenServer?.close()
    tokenServer = undefined
    await rm(testDir, { recursive: true, force: true })
  })

  it('returns cached token when it is still valid', async () => {
    const creds = {
      accessToken: 'cached-access-token',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3600_000,
      clientId: 'cid',
    }
    await writeFile(credsPath, JSON.stringify(creds))

    const { getToken } = await import('../src/auth/nutrient-oauth.js')
    const config = makeConfig({
      tokenUrl: 'http://should-not-be-called',
      credentialsPath: credsPath,
    })

    const token = await getToken(config)
    expect(token).toBe('cached-access-token')
  })

  it('refreshes an expired token via the token endpoint', async () => {
    const creds = {
      accessToken: 'old-access-token',
      refreshToken: 'my-refresh-token',
      expiresAt: Date.now() - 60_000,
      clientId: 'test-client',
    }
    await writeFile(credsPath, JSON.stringify(creds))

    const refreshHandler = vi.fn((params: URLSearchParams) => {
      expect(params.get('grant_type')).toBe('refresh_token')
      expect(params.get('client_id')).toBe('test-client')
      expect(params.get('refresh_token')).toBe('my-refresh-token')
      return {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 7200,
      }
    })
    const srv = await startFakeTokenServer(refreshHandler)
    tokenServer = srv.server

    const { getToken } = await import('../src/auth/nutrient-oauth.js')
    const config = makeConfig({
      tokenUrl: `${srv.url}/token`,
      credentialsPath: credsPath,
    })

    const token = await getToken(config)

    expect(token).toBe('new-access-token')
    expect(refreshHandler).toHaveBeenCalledOnce()

    // Verify credentials were persisted to disk
    const saved = JSON.parse(await readFile(credsPath, 'utf-8'))
    expect(saved.accessToken).toBe('new-access-token')
    expect(saved.refreshToken).toBe('new-refresh-token')
    expect(saved.clientId).toBe('test-client')
    expect(saved.expiresAt).toBeGreaterThan(Date.now())
  })

  it('falls back to browser flow when refresh fails', async () => {
    const creds = {
      accessToken: 'stale-token',
      refreshToken: 'bad-refresh',
      expiresAt: Date.now() - 60_000,
      clientId: 'test-client',
    }
    await writeFile(credsPath, JSON.stringify(creds))

    const srv = await startFakeTokenServer(() => [401, 'invalid_grant'] as [number, string])
    tokenServer = srv.server

    const { getToken } = await import('../src/auth/nutrient-oauth.js')
    const config = makeConfig({
      tokenUrl: `${srv.url}/token`,
      credentialsPath: credsPath,
      clientId: 'test-client',
      registrationUrl: undefined,
    })

    const openMock = (await import('open')).default as ReturnType<typeof vi.fn>
    openMock.mockClear()

    const result = getToken(config)
    await vi.waitFor(() => {
      expect(openMock).toHaveBeenCalled()
    }, { timeout: 5_000 })

    const authorizeUrl = new URL(openMock.mock.calls[0][0] as string)
    expect(authorizeUrl.searchParams.get('client_id')).toBe('test-client')
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code')
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')

    result.catch(() => {})
  })

  it('concurrent calls all receive the same refreshed token', async () => {
    const creds = {
      accessToken: 'expired-token',
      refreshToken: 'rt-concurrent',
      expiresAt: Date.now() - 60_000,
      clientId: 'concurrent-client',
    }
    await writeFile(credsPath, JSON.stringify(creds))

    let refreshCallCount = 0
    const srv = await startFakeTokenServer((_params) => {
      refreshCallCount++
      return {
        access_token: 'concurrent-new-token',
        refresh_token: 'concurrent-new-rt',
        expires_in: 7200,
      }
    })
    tokenServer = srv.server

    const { getToken } = await import('../src/auth/nutrient-oauth.js')
    const config = makeConfig({
      tokenUrl: `${srv.url}/token`,
      credentialsPath: credsPath,
    })

    const results = await Promise.all([
      getToken(config),
      getToken(config),
      getToken(config),
      getToken(config),
      getToken(config),
    ])

    for (const token of results) {
      expect(token).toBe('concurrent-new-token')
    }

    // NOTE: Without dedup, each call makes its own refresh request.
    // This test documents the current behavior. If dedup is added,
    // change the assertion to: expect(refreshCallCount).toBe(1)
    expect(refreshCallCount).toBeGreaterThanOrEqual(1)
  })

  it('goes straight to browser flow when no refresh token is cached', async () => {
    const creds = {
      accessToken: 'expired-no-refresh',
      expiresAt: Date.now() - 60_000,
      clientId: 'test-client',
    }
    await writeFile(credsPath, JSON.stringify(creds))

    const srv = await startFakeTokenServer(() => {
      throw new Error('Token server should not be called')
    })
    tokenServer = srv.server

    const { getToken } = await import('../src/auth/nutrient-oauth.js')
    const config = makeConfig({
      tokenUrl: `${srv.url}/token`,
      credentialsPath: credsPath,
      clientId: 'test-client',
    })

    const openMock = (await import('open')).default as ReturnType<typeof vi.fn>
    openMock.mockClear()

    const result = getToken(config)
    await vi.waitFor(() => {
      expect(openMock).toHaveBeenCalled()
    }, { timeout: 5_000 })

    result.catch(() => {})
  })

  it('starts browser flow when no credentials file exists', async () => {
    const { getToken } = await import('../src/auth/nutrient-oauth.js')
    const config = makeConfig({
      tokenUrl: 'http://localhost:1/token',
      credentialsPath: join(testDir, 'nonexistent.json'),
      clientId: 'fresh-client',
    })

    const openMock = (await import('open')).default as ReturnType<typeof vi.fn>
    openMock.mockClear()

    const result = getToken(config)
    await vi.waitFor(() => {
      expect(openMock).toHaveBeenCalled()
    }, { timeout: 5_000 })

    result.catch(() => {})
  })
})
