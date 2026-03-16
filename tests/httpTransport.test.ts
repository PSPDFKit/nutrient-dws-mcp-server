import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createHttpApp } from '../src/index.js'
import { Environment } from '../src/utils/environment.js'

function createEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    transportMode: 'http',
    authMode: 'static',
    port: 3000,
    host: '127.0.0.1',
    allowedHosts: [],
    nutrientApiKey: 'dws-api-key',
    dwsApiBaseUrl: 'https://api.nutrient.io',
    resourceUrl: 'https://mcp.example.com/mcp',
    authServerUrl: 'https://auth.example.com',
    protectedResourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
    staticPrincipals: [
      {
        token: 'token-1',
        clientId: 'client-1',
        scopes: ['mcp:invoke'],
      },
      {
        token: 'token-2',
        clientId: 'client-2',
        scopes: ['mcp:invoke'],
      },
    ],
    jwksUrl: undefined,
    issuer: undefined,
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
      resource: 'https://mcp.example.com/mcp',
      authorization_servers: ['https://auth.example.com'],
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

    const sessionId = await initializeSession(app, 'token-1')

    const response = await request(app)
      .post('/mcp')
      .set('authorization', 'Bearer token-2')
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

  it('filters tools/list according to allowed tools', async () => {
    const environment = createEnvironment({
      staticPrincipals: [
        {
          token: 'token-1',
          clientId: 'client-1',
          scopes: ['mcp:invoke'],
          allowedTools: ['check_credits'],
        },
      ],
    })

    const { app, close } = createHttpApp({ environment, sandboxEnabled: false })
    closeApp = close

    const sessionId = await initializeSession(app, 'token-1')

    const response = await request(app)
      .post('/mcp')
      .set('authorization', 'Bearer token-1')
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

    const sessionId = await initializeSession(app, 'token-1')

    // DELETE the session
    const deleteResponse = await request(app)
      .delete('/mcp')
      .set('authorization', 'Bearer token-1')
      .set('mcp-session-id', sessionId)

    expect(deleteResponse.status).toBe(200)

    // Subsequent request to the same session should fail with 404
    const postResponse = await request(app)
      .post('/mcp')
      .set('authorization', 'Bearer token-1')
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
