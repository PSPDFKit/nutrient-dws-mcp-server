import express from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AddressInfo } from 'node:net'
import { Server } from 'node:http'
import { TokenExchangeClient } from '../src/http/tokenExchange.js'

describe('token exchange client', () => {
  let server: Server
  let tokenCounter = 0
  let callCount = 0

  beforeEach(async () => {
    tokenCounter = 0
    callCount = 0

    const app = express()
    app.use(express.urlencoded({ extended: false }))

    app.post('/oauth/token', (req, res) => {
      callCount += 1

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

  function createClient() {
    const address = server.address() as AddressInfo
    const authServerUrl = `http://127.0.0.1:${address.port}`

    return new TokenExchangeClient({
      authServerUrl,
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
})
