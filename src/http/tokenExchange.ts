import axios, { AxiosInstance } from 'axios'
import { randomUUID } from 'node:crypto'
import { importJWK, importPKCS8, SignJWT } from 'jose'
import type { JWK } from 'jose'

const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
type TokenEndpointAuthMethod = 'client_secret_basic' | 'private_key_jwt'
type AssertionSigningKey = Parameters<SignJWT['sign']>[0]

type CachedToken = {
  accessToken: string
  expiresAt: number
}

export type TokenExchangeClientOptions = {
  authServerUrl: string
  clientId: string
  tokenEndpointAuthMethod?: TokenEndpointAuthMethod
  clientSecret?: string
  clientAssertionPrivateKey?: string
  clientAssertionAlg?: string
  clientAssertionKid?: string
  httpClient?: AxiosInstance
  earlyRefreshSeconds?: number
}

export class TokenExchangeClient {
  private readonly tokenEndpoint: string
  private readonly clientId: string
  private readonly tokenEndpointAuthMethod: TokenEndpointAuthMethod
  private readonly clientSecret?: string
  private readonly clientAssertionPrivateKey?: string
  private readonly clientAssertionAlg: string
  private readonly clientAssertionKid?: string
  private readonly httpClient: AxiosInstance
  private readonly earlyRefreshSeconds: number
  private assertionSigningKey?: Promise<AssertionSigningKey>
  private readonly cache = new Map<string, CachedToken>()

  constructor(options: TokenExchangeClientOptions) {
    this.tokenEndpoint = new URL('/oauth/token', options.authServerUrl).toString()
    this.clientId = options.clientId
    this.tokenEndpointAuthMethod = options.tokenEndpointAuthMethod ?? 'client_secret_basic'
    this.clientSecret = options.clientSecret
    this.clientAssertionPrivateKey = options.clientAssertionPrivateKey
    this.clientAssertionAlg = options.clientAssertionAlg ?? 'RS256'
    this.clientAssertionKid = options.clientAssertionKid
    this.httpClient = options.httpClient ?? axios.create()
    this.earlyRefreshSeconds = options.earlyRefreshSeconds ?? 10

    if (this.tokenEndpointAuthMethod === 'client_secret_basic' && !this.clientSecret) {
      throw new Error('clientSecret is required when tokenEndpointAuthMethod is client_secret_basic')
    }

    if (this.tokenEndpointAuthMethod === 'private_key_jwt' && !this.clientAssertionPrivateKey) {
      throw new Error('clientAssertionPrivateKey is required when tokenEndpointAuthMethod is private_key_jwt')
    }
  }

  private getFromCache(principalFingerprint: string): string | undefined {
    const cached = this.cache.get(principalFingerprint)
    if (!cached) {
      return undefined
    }

    const now = Math.floor(Date.now() / 1000)
    if (cached.expiresAt <= now + this.earlyRefreshSeconds) {
      this.cache.delete(principalFingerprint)
      return undefined
    }

    return cached.accessToken
  }

  async getRuntimeToken(principalFingerprint: string, subjectToken: string): Promise<string> {
    const cachedToken = this.getFromCache(principalFingerprint)
    if (cachedToken) {
      return cachedToken
    }

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    })

    const requestConfig: {
      headers: Record<string, string>
      auth?: { username: string; password: string }
    } = {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }

    if (this.tokenEndpointAuthMethod === 'private_key_jwt') {
      body.set('client_id', this.clientId)
      body.set('client_assertion_type', CLIENT_ASSERTION_TYPE)
      body.set('client_assertion', await this.createClientAssertion())
    } else {
      requestConfig.auth = {
        username: this.clientId,
        password: this.clientSecret as string,
      }
    }

    try {
      const response = await this.httpClient.post(this.tokenEndpoint, body.toString(), requestConfig)

      const accessToken = response.data?.access_token
      if (typeof accessToken !== 'string' || accessToken.length === 0) {
        throw new Error('Token exchange response did not include access_token')
      }

      const now = Math.floor(Date.now() / 1000)
      const expiresIn = Number(response.data?.expires_in)
      const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn : now + 60

      this.cache.set(principalFingerprint, {
        accessToken,
        expiresAt,
      })

      return accessToken
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.data) {
          const message =
            typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)
          throw new Error(`Token exchange failed: ${message}`)
        }

        throw new Error(`Token exchange failed: ${error.message}`)
      }

      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  clearCache() {
    this.cache.clear()
  }

  private async createClientAssertion() {
    const now = Math.floor(Date.now() / 1000)
    const signingKey = await this.getAssertionSigningKey()

    const claims = {
      iss: this.clientId,
      sub: this.clientId,
      aud: this.tokenEndpoint,
      iat: now,
      exp: now + 120,
      jti: randomUUID(),
    }

    const header: { alg: string; kid?: string } = {
      alg: this.clientAssertionAlg,
    }

    if (this.clientAssertionKid) {
      header.kid = this.clientAssertionKid
    }

    return new SignJWT(claims).setProtectedHeader(header).sign(signingKey)
  }

  private async getAssertionSigningKey(): Promise<AssertionSigningKey> {
    if (!this.assertionSigningKey) {
      this.assertionSigningKey = this.importAssertionSigningKey()
    }

    return this.assertionSigningKey
  }

  private async importAssertionSigningKey(): Promise<AssertionSigningKey> {
    const rawKey = this.clientAssertionPrivateKey
    if (!rawKey) {
      throw new Error('clientAssertionPrivateKey is required when tokenEndpointAuthMethod is private_key_jwt')
    }

    const normalizedKey = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey
    const trimmedKey = normalizedKey.trim()

    if (trimmedKey.startsWith('{')) {
      return importJWK(JSON.parse(trimmedKey) as JWK, this.clientAssertionAlg)
    }

    return importPKCS8(trimmedKey, this.clientAssertionAlg)
  }
}
