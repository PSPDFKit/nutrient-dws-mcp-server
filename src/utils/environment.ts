import { z } from 'zod'

export type TransportMode = 'stdio' | 'http'
export type TokenEndpointAuthMethod = 'client_secret_basic' | 'private_key_jwt'

export type Environment = {
  transportMode: TransportMode
  port: number
  host: string
  allowedHosts: string[]
  nutrientApiKey?: string
  dwsApiBaseUrl: string
  resourceUrl: string
  authServerUrl: string
  protectedResourceMetadataUrl: string
  jwksUrl: string
  issuer?: string
  tokenEndpointAuthMethod: TokenEndpointAuthMethod
  clientId?: string
  clientSecret?: string
  clientAssertionPrivateKey?: string
  clientAssertionAlg?: string
  clientAssertionKid?: string
}

const RawEnvironmentSchema = z.object({
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  PORT: z.coerce.number().int().positive().default(3000),
  MCP_HOST: z.string().default('127.0.0.1'),
  MCP_ALLOWED_HOSTS: z.string().optional(),
  NUTRIENT_DWS_API_KEY: z.string().optional(),
  DWS_API_BASE_URL: z.string().url().default('https://api.nutrient.io'),
  RESOURCE_URL: z.string().url().default('http://localhost:3000/mcp'),
  AUTH_SERVER_URL: z.string().url().default('https://api.nutrient.io'),
  JWKS_URL: z.string().url().default('https://api.nutrient.io/.well-known/jwks.json'),
  ISSUER: z.string().url().optional(),
  TOKEN_ENDPOINT_AUTH_METHOD: z.enum(['client_secret_basic', 'private_key_jwt']).default('client_secret_basic'),
  CLIENT_ID: z.string().optional(),
  CLIENT_SECRET: z.string().optional(),
  CLIENT_ASSERTION_PRIVATE_KEY: z.string().optional(),
  CLIENT_ASSERTION_ALG: z.string().default('RS256'),
  CLIENT_ASSERTION_KID: z.string().optional(),
})

type RawEnvironment = z.infer<typeof RawEnvironmentSchema>

let cachedEnvironment: Environment | undefined

function splitList(value?: string): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function getProtectedResourceMetadataUrl(resourceUrl: string): string {
  return new URL('/.well-known/oauth-protected-resource', resourceUrl).toString()
}


function parseEnvironment(rawEnv: NodeJS.ProcessEnv): Environment {
  const raw = RawEnvironmentSchema.parse(rawEnv)

  const allowedHosts = splitList(raw.MCP_ALLOWED_HOSTS)

  return {
    transportMode: raw.MCP_TRANSPORT,
    port: raw.PORT,
    host: raw.MCP_HOST,
    allowedHosts,
    nutrientApiKey: raw.NUTRIENT_DWS_API_KEY,
    dwsApiBaseUrl: raw.DWS_API_BASE_URL,
    resourceUrl: raw.RESOURCE_URL,
    authServerUrl: raw.AUTH_SERVER_URL,
    protectedResourceMetadataUrl: getProtectedResourceMetadataUrl(raw.RESOURCE_URL),
    jwksUrl: raw.JWKS_URL,
    issuer: raw.ISSUER ?? raw.AUTH_SERVER_URL,
    tokenEndpointAuthMethod: raw.TOKEN_ENDPOINT_AUTH_METHOD,
    clientId: raw.CLIENT_ID,
    clientSecret: raw.CLIENT_SECRET,
    clientAssertionPrivateKey: raw.CLIENT_ASSERTION_PRIVATE_KEY,
    clientAssertionAlg: raw.CLIENT_ASSERTION_ALG,
    clientAssertionKid: raw.CLIENT_ASSERTION_KID,
  }
}

export function getEnvironment(): Environment {
  if (!cachedEnvironment) {
    cachedEnvironment = parseEnvironment(process.env)
  }

  return cachedEnvironment
}

export function resetEnvironmentForTests() {
  cachedEnvironment = undefined
}

export function getAllowedToolsFromEnvironmentList(value?: string): string[] | undefined {
  const tools = splitList(value)
  return tools.length > 0 ? tools : undefined
}
