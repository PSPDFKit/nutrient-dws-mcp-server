import { createServer, type Server } from 'node:http'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createHttpApp } from '../src/index.js'
import { Environment } from '../src/utils/environment.js'

// ── Test JWKS server ──────────────────────────────────────────────────────────

let jwksServer: Server
let jwksUrl: string
let testKeyPair: Awaited<ReturnType<typeof generateKeyPair>>
let testKid: string

beforeAll(async () => {
  testKid = 'test-key-1'
  testKeyPair = await generateKeyPair('RS256')

  const publicJwk = await exportJWK(testKeyPair.publicKey)
  publicJwk.kid = testKid
  publicJwk.use = 'sig'
  publicJwk.alg = 'RS256'

  const jwksPayload = JSON.stringify({ keys: [publicJwk] })

  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(jwksPayload)
  })

  await new Promise<void>((resolve) => {
    jwksServer.listen(0, '127.0.0.1', () => resolve())
  })

  const address = jwksServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('JWKS server did not bind')
  }

  jwksUrl = `http://127.0.0.1:${address.port}/.well-known/jwks.json`
})

afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()))
})

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_ISSUER = 'https://auth.example.com'
const TEST_RESOURCE_URL = 'https://mcp.example.com/mcp'

async function signTestJwt(overrides: Record<string, unknown> = {}, subject = 'user-1') {
  const builder = new SignJWT({
    scope: 'mcp:invoke',
    azp: 'test-client',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: testKid })
    .setIssuer(TEST_ISSUER)
    .setSubject(subject)
    .setAudience(TEST_RESOURCE_URL)
    .setIssuedAt()
    .setExpirationTime('5m')

  return builder.sign(testKeyPair.privateKey)
}

function createEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    transportMode: 'http',
    port: 3000,
    host: '127.0.0.1',
    allowedHosts: [],
    nutrientApiKey: 'dws-api-key',
    dwsApiBaseUrl: 'https://api.nutrient.io',
    resourceUrl: TEST_RESOURCE_URL,
    authServerUrl: TEST_ISSUER,
    protectedResourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
    jwksUrl,
    issuer: TEST_ISSUER,
    tokenEndpointAuthMethod: 'client_secret_basic',
    clientId: undefined,
    clientSecret: undefined,
    clientAssertionPrivateKey: undefined,
    clientAssertionAlg: undefined,
    clientAssertionKid: undefined,
    ...overrides,
  }
}

const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {
      tools: {},
    },
    clientInfo: {
      name: 'vitest-client',
      version: '1.0.0',
    },
  },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('http transport', () => {
  let closeApp: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (closeApp) {
      await closeApp()
      closeApp = undefined
    }
  })

  async function initializeSession(app: Parameters<typeof request>[0], token: string) {
    const response = await request(app)
      .post('/mcp')
      .set('authorization', `Bearer ${token}`)
      .set('accept', 'application/json, text/event-stream')
      .send(initializeRequest)

    expect(response.status).toBe(200)

    const sessionId = response.headers['mcp-session-id']
    expect(typeof sessionId).toBe('string')

    await request(app)
      .post('/mcp')
      .set('authorization', `Bearer ${token}`)
      .set('mcp-session-id', sessionId as string)
      .set('accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      })

    return sessionId as string
  }

  it('serves health and protected resource metadata endpoints', async () => {
    const { app, close } = createHttpApp({ environment: createEnvironment(), sandboxEnabled: false })
    closeApp = close

    const healthResponse = await request(app).get('/health')
    expect(healthResponse.status).toBe(200)
    expect(healthResponse.body.status).toBe('ok')

    const metadataResponse = await request(app).get('/.well-known/oauth-protected-resource')
    expect(metadataResponse.status).toBe(200)
    expect(metadataResponse.body).toEqual({
      resource: TEST_RESOURCE_URL,
      authorization_servers: [TEST_ISSUER],
    })
  })

  it('returns 401 and WWW-Authenticate on unauthenticated /mcp', async () => {
    const { app, close } = createHttpApp({ environment: createEnvironment(), sandboxEnabled: false })
    closeApp = close

    const response = await request(app).post('/mcp').send(initializeRequest)

    expect(response.status).toBe(401)
    expect(response.headers['www-authenticate']).toContain('resource_metadata=')
  })

  it('binds MCP session to principal fingerprint', async () => {
    const { app, close } = createHttpApp({ environment: createEnvironment(), sandboxEnabled: false })
    closeApp = close

    const token1 = await signTestJwt({}, 'user-1')
    const token2 = await signTestJwt({}, 'user-2')

    const sessionId = await initializeSession(app, token1)

    const response = await request(app)
      .post('/mcp')
      .set('authorization', `Bearer ${token2}`)
      .set('mcp-session-id', sessionId)
      .set('accept', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      })

    expect(response.status).toBe(403)
    expect(response.text).toContain('different principal')
  })

  it('filters tools/list according to allowed tools in JWT', async () => {
    const { app, close } = createHttpApp({ environment: createEnvironment(), sandboxEnabled: false })
    closeApp = close

    const token = await signTestJwt({ allowed_tools: ['check_credits'] })
    const sessionId = await initializeSession(app, token)

    const response = await request(app)
      .post('/mcp')
      .set('authorization', `Bearer ${token}`)
      .set('mcp-session-id', sessionId)
      .set('accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      })

    expect(response.status).toBe(200)

    const toolsFromJson = response.body?.result?.tools
    let tools: Array<{ name: string }> = Array.isArray(toolsFromJson) ? toolsFromJson : []

    if (tools.length === 0 && response.text) {
      const dataLines = response.text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))

      for (const line of dataLines) {
        const payload = line.slice('data:'.length).trim()
        if (!payload) {
          continue
        }

        const parsed = JSON.parse(payload) as { result?: { tools?: Array<{ name: string }> } }
        if (Array.isArray(parsed.result?.tools)) {
          tools = parsed.result.tools
          break
        }
      }
    }

    const toolNames = tools.map((tool: { name: string }) => tool.name)

    expect(toolNames).toEqual(['check_credits'])
  })

  it('cleans up session on DELETE /mcp', async () => {
    const { app, close } = createHttpApp({ environment: createEnvironment(), sandboxEnabled: false })
    closeApp = close

    const token = await signTestJwt()
    const sessionId = await initializeSession(app, token)

    const deleteResponse = await request(app)
      .delete('/mcp')
      .set('authorization', `Bearer ${token}`)
      .set('mcp-session-id', sessionId)

    expect(deleteResponse.status).toBe(200)

    const postResponse = await request(app)
      .post('/mcp')
      .set('authorization', `Bearer ${token}`)
      .set('mcp-session-id', sessionId)
      .set('accept', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {},
      })

    expect(postResponse.status).toBe(404)
  })
})
