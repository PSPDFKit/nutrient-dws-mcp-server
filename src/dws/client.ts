import axios, { AxiosInstance, AxiosResponse } from 'axios'
import FormData from 'form-data'
import { getVersion } from '../version.js'

export type DwsTokenResolver = () => Promise<string>

export type DwsApiClientOptions = {
  baseUrl?: string
  tokenResolver: DwsTokenResolver
  httpClient?: AxiosInstance
}

export class DwsApiClient {
  private readonly baseUrl: string
  private readonly tokenResolver: DwsTokenResolver
  private readonly httpClient: AxiosInstance

  constructor(options: DwsApiClientOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.nutrient.io'
    this.tokenResolver = options.tokenResolver
    this.httpClient = options.httpClient ?? axios.create()
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

  async post(endpoint: string, data: FormData | Record<string, unknown>): Promise<AxiosResponse> {
    const headers = await this.buildHeaders(data)

    return this.httpClient.post(this.buildUrl(endpoint), data, {
      headers,
      responseType: 'stream',
    })
  }

  async get(endpoint: string): Promise<AxiosResponse> {
    const headers = await this.buildHeaders()

    return this.httpClient.get(this.buildUrl(endpoint), {
      headers,
      responseType: 'stream',
    })
  }
}

export function createApiClientFromApiKey(apiKey: string, baseUrl?: string): DwsApiClient {
  return new DwsApiClient({
    baseUrl,
    tokenResolver: async () => apiKey,
  })
}

export function createApiClientFromTokenResolver(tokenResolver: DwsTokenResolver, baseUrl?: string): DwsApiClient {
  return new DwsApiClient({
    baseUrl,
    tokenResolver,
  })
}
