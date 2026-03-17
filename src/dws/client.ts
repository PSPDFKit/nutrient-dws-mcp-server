import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import FormData from 'form-data'
import { logger } from '../logger.js'
import { getVersion } from '../version.js'

/** Async function that returns a bearer token for authenticating with the DWS API. */
export type DwsTokenResolver = () => Promise<string>

export type DwsApiClientOptions = {
  /** DWS API base URL. Defaults to `https://api.nutrient.io`. */
  baseUrl?: string
  /** Provides the bearer token for each request. Called on every API call. */
  tokenResolver: DwsTokenResolver
  /** Optional custom Axios instance (useful for testing or proxy configuration). */
  httpClient?: AxiosInstance
  /** Request timeout in milliseconds. Defaults to 120000 (2 minutes). */
  timeoutMs?: number
  /** Called when the API returns 401, before retrying with a fresh token. Use to invalidate cached credentials. */
  onTokenRejected?: () => void | Promise<void>
}

/**
 * HTTP client for the Nutrient Document Web Services (DWS) API.
 *
 * Handles authentication, content-type negotiation, and streaming responses.
 * All responses are returned as streams (`responseType: 'stream'`).
 */
export class DwsApiClient {
  private readonly baseUrl: string
  private readonly tokenResolver: DwsTokenResolver
  private readonly httpClient: AxiosInstance

  constructor(options: DwsApiClientOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.nutrient.io'
    this.tokenResolver = options.tokenResolver
    this.httpClient = options.httpClient ?? axios.create({ timeout: options.timeoutMs ?? 120_000 })

    if (options.onTokenRejected) {
      this.install401Interceptor(options.onTokenRejected)
    }
  }

  private install401Interceptor(onTokenRejected: () => void | Promise<void>) {
    this.httpClient.interceptors.response.use(undefined, async (error) => {
      const config = error.config as InternalAxiosRequestConfig & { _retried?: boolean }
      if (error.response?.status !== 401 || config._retried) {
        throw error
      }

      // Don't retry requests with streaming/FormData bodies — they can't be replayed
      if (config.data instanceof FormData) {
        logger.warn('401 on FormData request — cannot retry, invalidating token for next call')
        await onTokenRejected()
        throw error
      }

      logger.info('401 response — invalidating token and retrying with fresh credentials')
      config._retried = true
      await onTokenRejected()

      const token = await this.tokenResolver()
      config.headers.Authorization = `Bearer ${token}`
      return this.httpClient.request(config)
    })
  }

  private async buildHeaders(payload?: FormData | Record<string, unknown>) {
    const token = await this.tokenResolver()

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'User-Agent': `NutrientDWSMCPServer/${getVersion()}`,
    }

    if (payload instanceof FormData) {
      return {
        ...headers,
        ...payload.getHeaders(),
      }
    }

    if (payload) {
      headers['Content-Type'] = 'application/json'
    }

    return headers
  }

  private buildUrl(endpoint: string): string {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
    return new URL(normalizedEndpoint, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).toString()
  }

  /** POST to a DWS endpoint. Automatically sets Content-Type based on the payload type. */
  async post(endpoint: string, data: FormData | Record<string, unknown>): Promise<AxiosResponse> {
    const headers = await this.buildHeaders(data)

    return this.httpClient.post(this.buildUrl(endpoint), data, {
      headers,
      responseType: 'stream',
    })
  }

  /** GET a DWS endpoint. */
  async get(endpoint: string): Promise<AxiosResponse> {
    const headers = await this.buildHeaders()

    return this.httpClient.get(this.buildUrl(endpoint), {
      headers,
      responseType: 'stream',
    })
  }
}

/** Creates a {@link DwsApiClient} that authenticates with a static API key. */
export function createApiClientFromApiKey(apiKey: string, baseUrl?: string): DwsApiClient {
  return new DwsApiClient({
    baseUrl,
    tokenResolver: async () => apiKey,
  })
}

/** Creates a {@link DwsApiClient} that resolves a fresh token on each request (e.g. for JWT/OAuth flows). */
export function createApiClientFromTokenResolver(
  tokenResolver: DwsTokenResolver,
  baseUrl?: string,
  onTokenRejected?: () => void | Promise<void>,
): DwsApiClient {
  return new DwsApiClient({
    baseUrl,
    tokenResolver,
    onTokenRejected,
  })
}
