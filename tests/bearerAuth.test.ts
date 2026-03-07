import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createBearerAuthMiddleware, getAllowedTools, type AuthenticatedRequest } from '../src/http/bearerAuth.js'

function createTestApp() {
  const app = express()
  app.use(createBearerAuthMiddleware([{ token: 'secret-token', clientId: 'cowork', scopes: ['mcp'], allowedTools: ['check_credits'] }]))
  app.get('/mcp', (req, res) => {
    const authenticatedRequest = req as AuthenticatedRequest

    res.status(200).json({
      clientId: authenticatedRequest.auth?.clientId,
      scopes: authenticatedRequest.auth?.scopes,
      allowedTools: getAllowedTools(authenticatedRequest.auth),
    })
  })

  return app
}

describe('Bearer Auth Middleware', () => {
  it('rejects missing authorization headers', async () => {
    const response = await request(createTestApp()).get('/mcp').set('Host', '127.0.0.1')

    expect(response.status).toBe(401)
    expect(response.headers['www-authenticate']).toContain('Bearer realm="nutrient-dws-mcp-server"')
  })

  it('rejects invalid bearer tokens', async () => {
    const response = await request(createTestApp())
      .get('/mcp')
      .set('Host', '127.0.0.1')
      .set('Authorization', 'Bearer wrong-token')

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('invalid_token')
  })

  it('accepts valid bearer tokens and attaches auth info', async () => {
    const response = await request(createTestApp())
      .get('/mcp')
      .set('Host', '127.0.0.1')
      .set('Authorization', 'Bearer secret-token')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      clientId: 'cowork',
      scopes: ['mcp'],
      allowedTools: ['check_credits'],
    })
  })
})
