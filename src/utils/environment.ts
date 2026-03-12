import { z } from 'zod'

export type TransportMode = 'stdio' | 'http'
export type AuthMode = 'static' | 'jwt'
export type TokenEndpointAuthMethod = 'client_secret_basic' | 'private_key_jwt'

export type StaticPrincipal = {
  token: string
  clientId: string
  scopes: string[]
  allowedTools?: string[]
}

export type Environment = {
  transportMode: TransportMode
  authMode: AuthMode
  port: number
  host: string
  allowedHosts: string[]
  nutrientApiKey?: string
  dwsApiBaseUrl: string
  resourceUrl: string
  authServerUrl: string
  protectedResourceMetadataUrl: string
  staticPrincipals: StaticPrincipal[]
  jwksUrl?: string
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
  AUTH_MODE: z.enum(['static', 'jwt']).default('static'),
  PORT: z.coerce.number().int().positive().default(3000),
  MCP_HOST: z.string().default('127.0.0.1'),
  MCP_ALLOWED_HOSTS: z.string().optional(),
  NUTRIENT_DWS_API_KEY: z.string().optional(),
  DWS_API_BASE_URL: z.string().url().default('https://api.nutrient.io'),
  RESOURCE_URL: z.string().url().default('https://mcp.nutrient.io/mcp'),
  AUTH_SERVER_URL: z.string().url().default('https://api.nutrient.io'),
  JWKS_URL: z.string().url().optional(),
  ISSUER: z.string().url().optional(),
  TOKEN_ENDPOINT_AUTH_METHOD: z.enum(['client_secret_basic', 'private_key_jwt']).default('client_secret_basic'),
  CLIENT_ID: z.string().optional(),
  CLIENT_SECRET: z.string().optional(),
  CLIENT_ASSERTION_PRIVATE_KEY: z.string().optional(),
  CLIENT_ASSERTION_ALG: z.string().default('RS256'),
  CLIENT_ASSERTION_KID: z.string().optional(),
  MCP_BEARER_TOKEN: z.string().optional(),
  MCP_BEARER_CLIENT_ID: z.string().default('default-client'),
  MCP_BEARER_SCOPES: z.string().optional(),
  MCP_BEARER_ALLOWED_TOOLS: z.string().optional(),
  MCP_BEARER_TOKENS_JSON: z.string().optional(),
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

function parseJsonConfiguredPrincipals(rawValue: string): StaticPrincipal[] {
  const parsed = JSON.parse(rawValue) as unknown

  if (Array.isArray(parsed)) {
    return parsed
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item, index) => {
        const token = typeof item.token === 'string' ? item.token : ''
        if (!token) {
          throw new Error(`MCP_BEARER_TOKENS_JSON[${index}] is missing required "token"`)
        }

        const clientId = typeof item.clientId === 'string' ? item.clientId : `json-client-${index}`
        const scopes = Array.isArray(item.scopes)
          ? item.scopes.filter((scope): scope is string => typeof scope === 'string')
          : splitList(typeof item.scopes === 'string' ? item.scopes : undefined)

        const allowedToolsRaw = Array.isArray(item.allowedTools)
          ? item.allowedTools.filter((tool): tool is string => typeof tool === 'string')
          : splitList(typeof item.allowedTools === 'string' ? item.allowedTools : undefined)

        return {
          token,
          clientId,
          scopes,
          allowedTools: allowedToolsRaw.length > 0 ? allowedToolsRaw : undefined,
        }
      })
  }

  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed).flatMap(([clientId, entry]) => {
      if (typeof entry === 'string') {
        return [
          {
            token: entry,
            clientId,
            scopes: [],
            allowedTools: undefined,
          },
        ]
      }

      if (!entry || typeof entry !== 'object') {
        return []
      }

      const entryRecord = entry as Record<string, unknown>
      const token = typeof entryRecord.token === 'string' ? entryRecord.token : ''
      if (!token) {
        throw new Error(`MCP_BEARER_TOKENS_JSON["${clientId}"] is missing required "token"`)
      }

      const scopes = Array.isArray(entryRecord.scopes)
        ? entryRecord.scopes.filter((scope): scope is string => typeof scope === 'string')
        : splitList(typeof entryRecord.scopes === 'string' ? entryRecord.scopes : undefined)

      const allowedToolsRaw = Array.isArray(entryRecord.allowedTools)
        ? entryRecord.allowedTools.filter((tool): tool is string => typeof tool === 'string')
        : splitList(typeof entryRecord.allowedTools === 'string' ? entryRecord.allowedTools : undefined)

      return [
        {
          token,
          clientId,
          scopes,
          allowedTools: allowedToolsRaw.length > 0 ? allowedToolsRaw : undefined,
        },
      ]
    })
  }

  throw new Error('MCP_BEARER_TOKENS_JSON must be a JSON object or array')
}

function parseEnvConfiguredPrincipals(raw: RawEnvironment, env: NodeJS.ProcessEnv): StaticPrincipal[] {
  const principals: StaticPrincipal[] = []

  if (raw.MCP_BEARER_TOKENS_JSON) {
    principals.push(...parseJsonConfiguredPrincipals(raw.MCP_BEARER_TOKENS_JSON))
  }

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('MCP_BEARER_TOKEN_') || key === 'MCP_BEARER_TOKENS_JSON') {
      continue
    }

    if (!value) {
      continue
    }

    const suffix = key.substring('MCP_BEARER_TOKEN_'.length)
    if (!suffix) {
      continue
    }

    const scopes = splitList(env[`MCP_BEARER_SCOPES_${suffix}`])
    const allowedTools = splitList(env[`MCP_BEARER_ALLOWED_TOOLS_${suffix}`])

    principals.push({
      token: value,
      clientId: suffix.toLowerCase(),
      scopes,
      allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    })
  }

  if (raw.MCP_BEARER_TOKEN) {
    const scopes = splitList(raw.MCP_BEARER_SCOPES)
    const allowedTools = splitList(raw.MCP_BEARER_ALLOWED_TOOLS)

    principals.push({
      token: raw.MCP_BEARER_TOKEN,
      clientId: raw.MCP_BEARER_CLIENT_ID,
      scopes,
      allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
    })
  }

  const uniqueByTokenAndClient = new Map<string, StaticPrincipal>()
  for (const principal of principals) {
    uniqueByTokenAndClient.set(`${principal.clientId}:${principal.token}`, principal)
  }

  return [...uniqueByTokenAndClient.values()]
}

function validateEnvironment(environment: Environment): Environment {
  if (environment.transportMode === 'stdio' && !environment.nutrientApiKey) {
    throw new Error('NUTRIENT_DWS_API_KEY is required when MCP_TRANSPORT=stdio')
  }

  if (environment.transportMode === 'http' && environment.authMode === 'static') {
    if (environment.staticPrincipals.length === 0) {
      throw new Error(
        'Static HTTP auth requires bearer tokens. Configure MCP_BEARER_TOKEN, MCP_BEARER_TOKEN_* or MCP_BEARER_TOKENS_JSON.',
      )
    }

    if (!environment.nutrientApiKey) {
      throw new Error('NUTRIENT_DWS_API_KEY is required when MCP_TRANSPORT=http and AUTH_MODE=static')
    }
  }

  if (environment.transportMode === 'http' && environment.authMode === 'jwt') {
    if (!environment.jwksUrl) {
      throw new Error('AUTH_MODE=jwt requires JWKS_URL to be configured')
    }

    if (!environment.clientId) {
      throw new Error('AUTH_MODE=jwt requires CLIENT_ID to be configured')
    }

    if (environment.tokenEndpointAuthMethod === 'client_secret_basic' && !environment.clientSecret) {
      throw new Error(
        'AUTH_MODE=jwt with TOKEN_ENDPOINT_AUTH_METHOD=client_secret_basic requires CLIENT_SECRET to be configured',
      )
    }

    if (environment.tokenEndpointAuthMethod === 'private_key_jwt' && !environment.clientAssertionPrivateKey) {
      throw new Error(
        'AUTH_MODE=jwt with TOKEN_ENDPOINT_AUTH_METHOD=private_key_jwt requires CLIENT_ASSERTION_PRIVATE_KEY to be configured',
      )
    }
  }

  return environment
}

function parseEnvironment(rawEnv: NodeJS.ProcessEnv): Environment {
  const raw = RawEnvironmentSchema.parse(rawEnv)

  const staticPrincipals = parseEnvConfiguredPrincipals(raw, rawEnv)
  const allowedHosts = splitList(raw.MCP_ALLOWED_HOSTS)

  const environment: Environment = {
    transportMode: raw.MCP_TRANSPORT,
    authMode: raw.AUTH_MODE,
    port: raw.PORT,
    host: raw.MCP_HOST,
    allowedHosts,
    nutrientApiKey: raw.NUTRIENT_DWS_API_KEY,
    dwsApiBaseUrl: raw.DWS_API_BASE_URL,
    resourceUrl: raw.RESOURCE_URL,
    authServerUrl: raw.AUTH_SERVER_URL,
    protectedResourceMetadataUrl: getProtectedResourceMetadataUrl(raw.RESOURCE_URL),
    staticPrincipals,
    jwksUrl: raw.JWKS_URL,
    issuer: raw.ISSUER ?? raw.AUTH_SERVER_URL,
    tokenEndpointAuthMethod: raw.TOKEN_ENDPOINT_AUTH_METHOD,
    clientId: raw.CLIENT_ID,
    clientSecret: raw.CLIENT_SECRET,
    clientAssertionPrivateKey: raw.CLIENT_ASSERTION_PRIVATE_KEY,
    clientAssertionAlg: raw.CLIENT_ASSERTION_ALG,
    clientAssertionKid: raw.CLIENT_ASSERTION_KID,
  }

  return validateEnvironment(environment)
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
