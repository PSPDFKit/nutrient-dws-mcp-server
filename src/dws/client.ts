import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import FormData from 'form-data'
import { logger } from '../logger.js'
import { getVersion } from '../version.js'
import { CredentialProvider, Product, StaticKeyCredentialProvider } from './credential-provider.js'

// Carries the product a request was authenticated for through to the 401 interceptor,
// so a retry invalidates and re-resolves the same credential the failed request used.
declare module 'axios' {
  interface AxiosRequestConfig {
    __dwsProduct?: Product
  }
}

const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 10_000

type DwsRequestConfig = InternalAxiosRequestConfig & { _retryCount?: number }

export type DwsApiClientOptions = {
  /** DWS API base URL. Defaults to `https://api.nutrient.io`. */
  baseUrl?: string
  /** Resolves the bearer credential for each request, per DWS product. */
  provider: CredentialProvider
  /** Optional custom Axios instance (useful for testing or proxy configuration). */
  httpClient?: AxiosInstance
  /** Request timeout in milliseconds. Defaults to 120000 (2 minutes). */
  timeoutMs?: number
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
  private readonly provider: CredentialProvider
  private readonly httpClient: AxiosInstance

  constructor(options: DwsApiClientOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.nutrient.io'
    this.provider = options.provider
    this.httpClient = options.httpClient ?? axios.create({ timeout: options.timeoutMs ?? 120_000 })

    this.installTokenRejectedInterceptor(options.retryDelayMs ?? INITIAL_BACKOFF_MS)
  }

  /** Whether the underlying credential provider has a credential configured for `product`. */
  supports(product: Product): boolean {
    return this.provider.supports(product)
  }

  /** `'extraction/parse'` and `/extraction/parse'` both target the extraction product; everything else is processor. */
  private productFor(endpoint: string): Product {
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint
    return normalizedEndpoint.startsWith('extraction/') ? 'extraction' : 'processor'
  }

  private installTokenRejectedInterceptor(initialDelayMs: number) {
    this.httpClient.interceptors.response.use(undefined, async (error) => {
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status !== 401) {
        throw error
      }

      const config = error.config as DwsRequestConfig
      // Stashed by post/get when the request was issued — the failed request's own
      // product, not a re-guess, so retrying a processor request never invalidates
      // (or re-resolves) the extraction credential and vice versa. The fallback below
      // only fires for requests issued outside post/get; config.url is the FULL url
      // (baseUrl + endpoint), so it must be tested as a path segment, not a prefix.
      const product = config.__dwsProduct ?? (/\/extraction\//.test(config.url ?? '') ? 'extraction' : 'processor')

      // A static API key can't be refreshed — re-resolving yields the same rejected key,
      // so a 401 is terminal. Fail fast instead of spending the retry budget and backoff
      // on a request that cannot succeed.
      if (!this.provider.canRefresh(product)) {
        throw error
      }

      const retryCount = config._retryCount ?? 0
      if (retryCount >= MAX_RETRIES) {
        logger.warn('Max 401 retries reached, giving up', { retryCount })
        throw error
      }

      config._retryCount = retryCount + 1
      const delay = Math.min(initialDelayMs * 2 ** retryCount, MAX_BACKOFF_MS)
      logger.info('401 response — invalidating token and retrying', {
        attempt: config._retryCount,
        delayMs: delay,
        product,
      })

      await this.provider.invalidate(product)
      await new Promise((resolve) => setTimeout(resolve, delay))

      const token = await this.provider.token(product)
      config.headers.Authorization = `Bearer ${token}`
      return this.httpClient.request(config)
    })
  }

  private async buildHeaders(product: Product, payload?: FormData | Record<string, unknown>) {
    const token = await this.provider.token(product)

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
    const product = this.productFor(endpoint)
    const headers = await this.buildHeaders(product, data)
    // Buffer the multipart body up front: a FormData stream is consumed after the first
    // request attempt, so the 401 interceptor's retry would otherwise replay an empty body.
    const body = data instanceof FormData ? data.getBuffer() : data

    return this.httpClient.post(this.buildUrl(endpoint), body, {
      // Built headers win: extraHeaders adds endpoint-specific keys and must not
      // be able to displace Authorization or the payload's Content-Type.
      headers: { ...extraHeaders, ...headers },
      responseType: 'stream',
      __dwsProduct: product,
    })
  }

  /** GET a DWS endpoint. */
  async get(endpoint: string): Promise<AxiosResponse> {
    const product = this.productFor(endpoint)
    const headers = await this.buildHeaders(product)

    return this.httpClient.get(this.buildUrl(endpoint), {
      headers,
      responseType: 'stream',
      __dwsProduct: product,
    })
  }
}

/** Creates a {@link DwsApiClient} that authenticates with a static API key against the processor product. */
export function createApiClientFromApiKey(apiKey: string, baseUrl?: string): DwsApiClient {
  return new DwsApiClient({
    baseUrl,
    provider: new StaticKeyCredentialProvider({ processor: apiKey }),
  })
}
