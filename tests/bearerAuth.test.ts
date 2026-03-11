import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createBearerAuthMiddleware } from '../src/http/bearerAuth.js'
import { RequestWithAuth } from '../src/http/types.js'

describe('static bearer auth middleware', () => {
  const app = express()

  app.use(
    createBearerAuthMiddleware({
      principals: [
        {
          token: 'token-1',
          clientId: 'client-1',
          scopes: ['mcp:invoke'],
          allowedTools: ['check_credits'],
        },
      ],
      resourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
    }),
  )

  app.get('/protected', (req, res) => {
    const authInfo = (req as RequestWithAuth).auth
    res.json({
      clientId: authInfo?.clientId,
      allowedTools: authInfo?.extra?.allowedTools,
    })
  })

  it('returns 401 for missing authorization header', async () => {
    const response = await request(app).get('/protected')

    expect(response.status).toBe(401)
    expect(response.headers['www-authenticate']).toContain('resource_metadata=')
  })

  it('returns 401 for invalid bearer token', async () => {
    const response = await request(app).get('/protected').set('authorization', 'Bearer wrong-token')

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('invalid_token')
  })

  it('attaches auth info for a valid bearer token', async () => {
    const response = await request(app).get('/protected').set('authorization', 'Bearer token-1')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      clientId: 'client-1',
      allowedTools: ['check_credits'],
    })
  })
})
