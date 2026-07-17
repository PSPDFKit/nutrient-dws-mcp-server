import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import FormData from 'form-data'
import { logger } from '../logger.js'
import { getVersion } from '../version.js'

/** Async function that returns a bearer token for authenticating with the DWS API. */
export type DwsTokenResolver = () => Promise<string>

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 10_000

export type DwsApiClientOptions = {
  /** DWS API base URL. Defaults to `https://api.nutrient.io`. */
  baseUrl?: string
  /** Provides the bearer token for each request. Called on every API call. */
  tokenResolver: DwsTokenResolver
  /** Optional custom Axios instance (useful for testing or proxy configuration). */
  httpClient?: AxiosInstance
  /** Request timeout in milliseconds. Defaults to 120000 (2 minutes). */
  timeoutMs?: number
  /**
   * Called when the API returns a 401 Unauthorized response. Use to invalidate
   * cached credentials so `tokenResolver` returns a fresh token on retry.
   * The client retries automatically with exponential backoff (max {@link MAX_RETRIES}).
   */
  onTokenRejected?: () => void | Promise<void>
  /** @internal Initial backoff delay in ms for 401 retries. Exposed for testing. */
  retryDelayMs?: number
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
      this.installTokenRejectedInterceptor(options.onTokenRejected, options.retryDelayMs ?? INITIAL_BACKOFF_MS)
    }
  }

  private installTokenRejectedInterceptor(onTokenRejected: () => void | Promise<void>, initialDelayMs: number) {
    this.httpClient.interceptors.response.use(undefined, async (error) => {
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status !== 401) {
        throw error
      }

      const config = error.config as InternalAxiosRequestConfig & { _retryCount?: number }
      const retryCount = config._retryCount ?? 0

      if (retryCount >= MAX_RETRIES) {
        logger.warn('Max 401 retries reached, giving up', { retryCount })
        throw error
      }

      config._retryCount = retryCount + 1
      const delay = Math.min(initialDelayMs * 2 ** retryCount, MAX_BACKOFF_MS)
      logger.info('401 response — invalidating token and retrying', { attempt: config._retryCount, delayMs: delay })

      await onTokenRejected()
      await new Promise((resolve) => setTimeout(resolve, delay))

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
  async post(
    endpoint: string,
    data: FormData | Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<AxiosResponse> {
    const headers = await this.buildHeaders(data)
    // Buffer the multipart body up front: a FormData stream is consumed after the first
    // request attempt, so the 401 interceptor's retry would otherwise replay an empty body.
    const body = data instanceof FormData ? data.getBuffer() : data

    return this.httpClient.post(this.buildUrl(endpoint), body, {
      // Built headers win: extraHeaders adds endpoint-specific keys and must not
      // be able to displace Authorization or the payload's Content-Type.
      headers: { ...extraHeaders, ...headers },
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
