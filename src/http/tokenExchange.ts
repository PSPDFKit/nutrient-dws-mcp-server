import axios, { AxiosInstance } from 'axios'

type CachedToken = {
  accessToken: string
  expiresAt: number
}

export type TokenExchangeClientOptions = {
  authServerUrl: string
  clientId: string
  clientSecret: string
  httpClient?: AxiosInstance
  earlyRefreshSeconds?: number
}

export class TokenExchangeClient {
  private readonly tokenEndpoint: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly httpClient: AxiosInstance
  private readonly earlyRefreshSeconds: number
  private readonly cache = new Map<string, CachedToken>()

  constructor(options: TokenExchangeClientOptions) {
    this.tokenEndpoint = new URL('/oauth/token', options.authServerUrl).toString()
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.httpClient = options.httpClient ?? axios.create()
    this.earlyRefreshSeconds = options.earlyRefreshSeconds ?? 10
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

    try {
      const response = await this.httpClient.post(this.tokenEndpoint, body.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        auth: {
          username: this.clientId,
          password: this.clientSecret,
        },
      })

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
}
