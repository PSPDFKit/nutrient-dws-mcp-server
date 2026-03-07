import { z } from 'zod'

const rawEnvironmentSchema = z.object({
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5100),
  MCP_ALLOWED_HOSTS: z.string().optional(),
  MCP_BEARER_TOKEN: z.string().optional(),
  MCP_BEARER_TOKEN_CLIENT_ID: z.string().default('cowork'),
  MCP_BEARER_TOKEN_SCOPES: z.string().optional(),
  MCP_BEARER_TOKEN_ALLOWED_TOOLS: z.string().optional(),
  MCP_BEARER_TOKENS_JSON: z.string().optional(),
})

const bearerPrincipalSchema = z.object({
  token: z.string().min(1, 'token is required'),
  clientId: z.string().min(1, 'clientId is required'),
  scopes: z.array(z.string().min(1)).default([]),
  allowedTools: z.array(z.string().min(1)).optional(),
})

type RawEnvironment = z.infer<typeof rawEnvironmentSchema>

export type BearerPrincipalConfig = z.infer<typeof bearerPrincipalSchema>

export interface ParsedEnvironment {
  MCP_TRANSPORT: 'stdio' | 'http'
  MCP_HOST: string
  PORT: number
  MCP_ALLOWED_HOSTS: string[]
  AUTH_PRINCIPALS: BearerPrincipalConfig[]
}

function parseCsvList(value?: string): string[] {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
}

function parseJsonPrincipals(value?: string): BearerPrincipalConfig[] {
  if (!value) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`MCP_BEARER_TOKENS_JSON must be valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  return z.array(bearerPrincipalSchema).parse(parsed)
}

function parsePrincipals(env: RawEnvironment): BearerPrincipalConfig[] {
  const principals = parseJsonPrincipals(env.MCP_BEARER_TOKENS_JSON)

  if (env.MCP_BEARER_TOKEN) {
    principals.unshift({
      token: env.MCP_BEARER_TOKEN,
      clientId: env.MCP_BEARER_TOKEN_CLIENT_ID.trim(),
      scopes: parseCsvList(env.MCP_BEARER_TOKEN_SCOPES),
      allowedTools: parseCsvList(env.MCP_BEARER_TOKEN_ALLOWED_TOOLS),
    })
  }

  return principals.map(principal => ({
    ...principal,
    scopes: principal.scopes.map(scope => scope.trim()).filter(Boolean),
    allowedTools: principal.allowedTools?.map(tool => tool.trim()).filter(Boolean),
  }))
}

/**
 * Validates and parses environment variables.
 */
export function validateEnvironment(): ParsedEnvironment {
  try {
    const parsed = rawEnvironmentSchema.parse(process.env)
    const principals = parsePrincipals(parsed)

    if (parsed.MCP_TRANSPORT === 'http' && principals.length === 0) {
      throw new Error('HTTP transport requires MCP_BEARER_TOKEN or MCP_BEARER_TOKENS_JSON')
    }

    return {
      MCP_TRANSPORT: parsed.MCP_TRANSPORT,
      MCP_HOST: parsed.MCP_HOST,
      PORT: parsed.PORT,
      MCP_ALLOWED_HOSTS: parseCsvList(parsed.MCP_ALLOWED_HOSTS),
      AUTH_PRINCIPALS: principals,
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors
        .map(entry => `${entry.path.join('.')}: ${entry.message}`)
        .join('\n')

      throw new Error(`Environment validation failed:\n${errorMessages}`)
    }

    throw error
  }
}

/**
 * Gets validated environment configuration with memoization.
 */
export const getEnvironment = (() => {
  let cachedEnvironment: ParsedEnvironment | undefined

  return (): ParsedEnvironment => {
    if (cachedEnvironment === undefined) {
      cachedEnvironment = validateEnvironment()
    }

    return cachedEnvironment
  }
})()
