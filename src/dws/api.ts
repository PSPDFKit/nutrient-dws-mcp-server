import FormData from 'form-data'
import { DwsApiClient, createApiClientFromApiKey, createApiClientFromTokenResolver } from './client.js'
import { getApiKey } from './utils.js'

export type ApiClientAuthContext =
  | {
      apiKey: string
      baseUrl?: string
    }
  | {
      tokenResolver: () => Promise<string>
      baseUrl?: string
    }

export function createApiClient(context: ApiClientAuthContext): DwsApiClient {
  if ('apiKey' in context) {
    return createApiClientFromApiKey(context.apiKey, context.baseUrl)
  }

  return createApiClientFromTokenResolver(context.tokenResolver, context.baseUrl)
}

/**
 * Legacy helper retained for backwards compatibility with tests/imports.
 * Prefer using DwsApiClient directly.
 */
export async function callNutrientApi(endpoint: string, data: FormData | Record<string, unknown>) {
  const client = createApiClientFromApiKey(getApiKey())
  return client.post(endpoint, data)
}
