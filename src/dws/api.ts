import { DwsApiClient, createApiClientFromApiKey, createApiClientFromTokenResolver } from './client.js'

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
