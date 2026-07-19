import { getToken, invalidateCachedToken, type NutrientOAuthConfig } from '../auth/nutrient-oauth.js'
import type { Environment } from '../utils/environment.js'

export type Product = 'processor' | 'extraction'

/** Resolves the bearer credential for a request, keyed by which DWS product the request targets. */
export interface CredentialProvider {
  /** Returns a raw bearer token/key for `product`. The caller wraps it as `Bearer ${token}`. */
  token(product: Product): Promise<string>
  /** Drops any cached credential for `product`, forcing the next `token` call to fetch a fresh one. */
  invalidate(product: Product): void | Promise<void>
  /** Whether a 401 for `product` can be resolved by re-resolving the credential (OAuth) vs. terminal (static key). */
  canRefresh(product: Product): boolean
  /** Whether `product` has a credential configured at all. */
  supports(product: Product): boolean
}

/** Authenticates with static, per-product API keys — each key is pinned to its own tenant. */
export class StaticKeyCredentialProvider implements CredentialProvider {
  private readonly keys: { processor?: string; extraction?: string }

  constructor(keys: { processor?: string; extraction?: string }) {
    this.keys = keys
  }

  async token(product: Product): Promise<string> {
    const key = this.keys[product]
    if (!key) {
      // Defensive: callers must gate on `supports` first. Reaching here is a bug at the call site.
      throw new Error(`No API key configured for product "${product}"`)
    }
    return key
  }

  invalidate(): void {
    // Static keys don't expire or rotate; nothing to invalidate.
  }

  canRefresh(): boolean {
    // A rejected static key stays rejected — a 401 is terminal, not worth retrying.
    return false
  }

  supports(product: Product): boolean {
    return Boolean(this.keys[product])
  }
}

/** Authenticates with a Nutrient OAuth token. `product:all` scope covers both products with one token. */
export class OAuthCredentialProvider implements CredentialProvider {
  private readonly config: NutrientOAuthConfig

  constructor(config: NutrientOAuthConfig) {
    this.config = config
  }

  async token(): Promise<string> {
    return getToken(this.config)
  }

  async invalidate(): Promise<void> {
    // Awaited by the client's 401 handler so the cached token is gone before the retry
    // re-resolves — otherwise the refetch could race the unlink and read the stale token.
    await invalidateCachedToken(this.config)
  }

  canRefresh(): boolean {
    return true
  }

  supports(): boolean {
    return true
  }
}

export function buildOAuthConfig(environment: Environment): NutrientOAuthConfig {
  return {
    authorizeUrl: `${environment.authServerUrl}/oauth/authorize`,
    tokenUrl: `${environment.authServerUrl}/oauth/token`,
    registrationUrl: `${environment.authServerUrl}/oauth/register`,
    clientId: environment.clientId,
    scopes: ['mcp:invoke', 'product:all', 'offline_access'],
    resource: environment.dwsApiBaseUrl,
  }
}

/**
 * Selects the credential strategy for an `Environment`.
 *
 * Any static key present locks the server into static-key mode: falling through to
 * OAuth here would silently discard the configured key and open a browser consent
 * flow on what may be a headless machine.
 */
export function createCredentialProvider(environment: Environment): CredentialProvider {
  if (environment.nutrientApiKey || environment.nutrientExtractApiKey) {
    return new StaticKeyCredentialProvider({
      processor: environment.nutrientApiKey,
      extraction: environment.nutrientExtractApiKey,
    })
  }

  return new OAuthCredentialProvider(buildOAuthConfig(environment))
}
