import { DwsApiClient } from './client.js'
import { createCredentialProvider } from './credential-provider.js'
import type { Environment } from '../utils/environment.js'

/** Creates a single {@link DwsApiClient} that routes each request to the credential for its product. */
export function createApiClient(environment: Environment): DwsApiClient {
  return new DwsApiClient({
    provider: createCredentialProvider(environment),
    baseUrl: environment.dwsApiBaseUrl,
  })
}
