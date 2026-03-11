import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, Server } from 'node:http'
import { createJwtAuthMiddleware } from '../src/http/jwtAuth.js'
import { RequestWithAuth } from '../src/http/types.js'
import { generateKeyPair, exportJWK, JWK, SignJWT } from 'jose'

describe('jwt auth middleware', () => {
  let jwksServer: Server
  let jwksUrl: string
  let issuer: string
  let privateKey: CryptoKey
  let publicJwk: JWK

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256')
    privateKey = keyPair.privateKey
    publicJwk = await exportJWK(keyPair.publicKey)
    publicJwk.kid = 'test-key'
    publicJwk.alg = 'RS256'
    publicJwk.use = 'sig'

    jwksServer = createServer((req, res) => {
      if (req.url === '/jwks') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ keys: [publicJwk] }))
        return
      }

      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve) => {
      jwksServer.listen(0, '127.0.0.1', () => resolve())
    })

    const address = jwksServer.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start JWKS server')
    }

    issuer = `http://127.0.0.1:${address.port}`
    jwksUrl = `${issuer}/jwks`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      jwksServer.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  })

  async function createToken(overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000)

    return new SignJWT({
      sub: 'user-1',
      azp: 'client-1',
      sid: 'session-1',
      iss: issuer,
      aud: 'dws-mcp',
      scope: 'mcp:invoke',
      exp: now + 300,
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .sign(privateKey)
  }

  function createApp() {
    const app = express()
    app.use(
      createJwtAuthMiddleware({
        jwksUrl,
        issuer,
        audience: 'dws-mcp',
        requiredScope: 'mcp:invoke',
        resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
      }),
    )

    app.get('/protected', (req, res) => {
      const authInfo = (req as RequestWithAuth).auth
      res.json({
        clientId: authInfo?.clientId,
        scopes: authInfo?.scopes,
        allowedTools: authInfo?.extra?.allowedTools,
      })
    })

    return app
  }

  it('accepts valid JWTs', async () => {
    const token = await createToken()
    const app = createApp()

    const response = await request(app).get('/protected').set('authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(response.body.clientId).toBe('client-1')
    expect(response.body.scopes).toContain('mcp:invoke')
  })

  it('rejects JWTs with wrong audience', async () => {
    const token = await createToken({ aud: 'wrong-audience' })
    const app = createApp()

    const response = await request(app).get('/protected').set('authorization', `Bearer ${token}`)

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('invalid_token')
  })

  it('rejects JWTs without required scope', async () => {
    const token = await createToken({ scope: 'other:scope' })
    const app = createApp()

    const response = await request(app).get('/protected').set('authorization', `Bearer ${token}`)

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('invalid_token')
  })

  it('rejects expired JWTs', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await createToken({ exp: now - 120 })
    const app = createApp()

    const response = await request(app).get('/protected').set('authorization', `Bearer ${token}`)

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('invalid_token')
  })

  it('maps allowed_tools claim to AuthInfo.extra.allowedTools', async () => {
    const token = await createToken({ allowed_tools: ['check_credits', 'document_processor'] })
    const app = createApp()

    const response = await request(app).get('/protected').set('authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(response.body.allowedTools).toEqual(['check_credits', 'document_processor'])
  })
})
