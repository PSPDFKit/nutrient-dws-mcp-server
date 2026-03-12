import express from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AddressInfo } from 'node:net'
import { Server } from 'node:http'
import { exportJWK, exportPKCS8, generateKeyPair, importJWK, jwtVerify } from 'jose'
import { TokenExchangeClient } from '../src/http/tokenExchange.js'

describe('token exchange client', () => {
  let server: Server
  let tokenCounter = 0
  let callCount = 0
  let lastRequest:
    | {
        body: Record<string, string>
        headers: Record<string, string | string[] | undefined>
      }
    | undefined

  beforeEach(async () => {
    tokenCounter = 0
    callCount = 0
    lastRequest = undefined

    const app = express()
    app.use(express.urlencoded({ extended: false }))

    app.post('/oauth/token', (req, res) => {
      callCount += 1
      lastRequest = {
        body: req.body as Record<string, string>,
        headers: req.headers as Record<string, string | string[] | undefined>,
      }

      if (req.body.subject_token === 'bad-subject-token') {
        res.status(400).json({ error: 'invalid_subject_token' })
        return
      }

      tokenCounter += 1
      res.json({
        access_token: `runtime-token-${tokenCounter}`,
        expires_in: tokenCounter === 1 ? 1 : 120,
      })
    })

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve())
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  })

  function getAuthServerUrl() {
    const address = server.address() as AddressInfo
    return `http://127.0.0.1:${address.port}`
  }

  function createClient() {
    return new TokenExchangeClient({
      authServerUrl: getAuthServerUrl(),
      clientId: 'mcp-client',
      clientSecret: 'mcp-secret',
      earlyRefreshSeconds: 0,
    })
  }

  it('reuses cached runtime token for the same principal', async () => {
    const client = createClient()

    const first = await client.getRuntimeToken('principal-1', 'subject-token')
    const second = await client.getRuntimeToken('principal-1', 'subject-token')

    expect(first).toBe('runtime-token-1')
    expect(second).toBe('runtime-token-1')
    expect(callCount).toBe(1)
  })

  it('re-exchanges after cached token expiry', async () => {
    const client = createClient()

    const first = await client.getRuntimeToken('principal-1', 'subject-token')

    await new Promise((resolve) => setTimeout(resolve, 1100))

    const second = await client.getRuntimeToken('principal-1', 'subject-token')

    expect(first).toBe('runtime-token-1')
    expect(second).toBe('runtime-token-2')
    expect(callCount).toBe(2)
  })

  it('throws on token exchange failure', async () => {
    const client = createClient()

    await expect(client.getRuntimeToken('principal-1', 'bad-subject-token')).rejects.toThrow(/Token exchange failed/)
  })

  it('supports private_key_jwt for token exchange client authentication', async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true })
    const privateKeyPem = await exportPKCS8(keyPair.privateKey)
    const publicJwk = await exportJWK(keyPair.publicKey)

    const client = new TokenExchangeClient({
      authServerUrl: getAuthServerUrl(),
      clientId: 'mcp-client',
      tokenEndpointAuthMethod: 'private_key_jwt',
      clientAssertionPrivateKey: privateKeyPem,
      clientAssertionKid: 'test-kid',
      earlyRefreshSeconds: 0,
    })

    const token = await client.getRuntimeToken('principal-1', 'subject-token')

    expect(token).toBe('runtime-token-1')
    expect(callCount).toBe(1)
    expect(lastRequest).toBeDefined()
    expect(lastRequest?.headers.authorization).toBeUndefined()
    expect(lastRequest?.body.client_id).toBe('mcp-client')
    expect(lastRequest?.body.client_assertion_type).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
    expect(typeof lastRequest?.body.client_assertion).toBe('string')

    const verificationKey = await importJWK(publicJwk, 'RS256')
    const { payload, protectedHeader } = await jwtVerify(lastRequest?.body.client_assertion as string, verificationKey, {
      issuer: 'mcp-client',
      subject: 'mcp-client',
      audience: `${getAuthServerUrl()}/oauth/token`,
    })

    expect(protectedHeader.alg).toBe('RS256')
    expect(protectedHeader.kid).toBe('test-kid')
    expect(typeof payload.jti).toBe('string')
  })
})
