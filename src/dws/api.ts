import { DwsApiClient, createApiClientFromApiKey, createApiClientFromTokenResolver } from './client.js'

/**
 * Discriminated union describing how to authenticate with the DWS API.
 *
 * - Provide `apiKey` for static API-key auth (stdio mode, static HTTP mode).
 * - Provide `tokenResolver` for dynamic token auth (JWT/OAuth mode).
 */
export type ApiClientAuthContext =
  | {
      apiKey: string
      baseUrl?: string
    }
  | {
      tokenResolver: () => Promise<string>
      baseUrl?: string
    }

/**
 * Factory that creates a {@link DwsApiClient} from an auth context.
 * Selects the appropriate authentication strategy based on the context shape.
 */
export function createApiClient(context: ApiClientAuthContext): DwsApiClient {
  if ('apiKey' in context) {
    return createApiClientFromApiKey(context.apiKey, context.baseUrl)
  }

  return createApiClientFromTokenResolver(context.tokenResolver, context.baseUrl)
}
