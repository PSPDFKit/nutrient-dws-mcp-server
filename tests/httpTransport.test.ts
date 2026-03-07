import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHttpApp, type HttpAppContext } from '../src/index.js'
import type { ParsedEnvironment } from '../src/utils/environment.js'

const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0',
    },
  },
}

function withDefaultHeaders(token?: string) {
  const headers: Record<string, string> = {
    Host: '127.0.0.1',
    Accept: 'application/json, text/event-stream',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

describe('HTTP Transport', () => {
  let httpContext: HttpAppContext

  beforeEach(() => {
    const env: ParsedEnvironment = {
      MCP_TRANSPORT: 'http',
      MCP_HOST: '127.0.0.1',
      PORT: 5100,
      MCP_ALLOWED_HOSTS: [],
      AUTH_PRINCIPALS: [
        {
          token: 'token-a',
          clientId: 'cowork-a',
          scopes: ['mcp'],
          allowedTools: ['check_credits'],
        },
        {
          token: 'token-b',
          clientId: 'cowork-b',
          scopes: ['mcp'],
          allowedTools: ['document_processor'],
        },
      ],
    }

    httpContext = createHttpApp({ env, sandboxDir: null })
  })

  afterEach(async () => {
    await httpContext.close()
  })

  async function initializeSession(token: string) {
    const response = await request(httpContext.app)
      .post('/mcp')
      .set(withDefaultHeaders(token))
      .send(initializeRequest)

    return {
      response,
      sessionId: response.headers['mcp-session-id'] as string | undefined,
    }
  }

  async function sendInitializedNotification(sessionId: string, token: string) {
    return request(httpContext.app)
      .post('/mcp')
      .set({ ...withDefaultHeaders(token), 'mcp-session-id': sessionId })
      .send({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      })
  }

  it('serves health without authentication', async () => {
    const response = await request(httpContext.app).get('/health').set('Host', '127.0.0.1')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'ok',
      transport: 'http',
    })
  })

  it('initializes an authenticated session and filters tools by principal', async () => {
    const { response, sessionId } = await initializeSession('token-a')

    expect(response.status).toBe(200)
    expect(sessionId).toBeTruthy()

    await sendInitializedNotification(sessionId!, 'token-a')

    const toolsResponse = await request(httpContext.app)
      .post('/mcp')
      .set({ ...withDefaultHeaders('token-a'), 'mcp-session-id': sessionId! })
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      })

    expect(toolsResponse.status).toBe(200)
    expect(toolsResponse.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['check_credits'])
  })

  it('reuses sessions for subsequent requests from the same principal', async () => {
    const { sessionId } = await initializeSession('token-a')
    await sendInitializedNotification(sessionId!, 'token-a')

    const pingResponse = await request(httpContext.app)
      .post('/mcp')
      .set({ ...withDefaultHeaders('token-a'), 'mcp-session-id': sessionId! })
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping',
      })

    expect(pingResponse.status).toBe(200)
    expect(pingResponse.body.result).toEqual({})
  })

  it('rejects requests with unknown session ids', async () => {
    const postResponse = await request(httpContext.app)
      .post('/mcp')
      .set({ ...withDefaultHeaders('token-a'), 'mcp-session-id': 'missing-session' })
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping',
      })

    const getResponse = await request(httpContext.app)
      .get('/mcp')
      .set({ ...withDefaultHeaders('token-a'), 'mcp-session-id': 'missing-session' })

    expect(postResponse.status).toBe(404)
    expect(getResponse.status).toBe(404)
  })

  it('rejects session reuse by a different principal', async () => {
    const { sessionId } = await initializeSession('token-a')
    await sendInitializedNotification(sessionId!, 'token-a')

    const response = await request(httpContext.app)
      .post('/mcp')
      .set({ ...withDefaultHeaders('token-b'), 'mcp-session-id': sessionId! })
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping',
      })

    expect(response.status).toBe(403)
  })

  it('closes sessions through DELETE /mcp', async () => {
    const { sessionId } = await initializeSession('token-a')
    await sendInitializedNotification(sessionId!, 'token-a')

    const deleteResponse = await request(httpContext.app)
      .delete('/mcp')
      .set({ ...withDefaultHeaders('token-a'), 'mcp-session-id': sessionId! })

    expect(deleteResponse.status).toBe(200)

    const pingResponse = await request(httpContext.app)
      .post('/mcp')
      .set({ ...withDefaultHeaders('token-a'), 'mcp-session-id': sessionId! })
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping',
      })

    expect(pingResponse.status).toBe(404)
  })
})
