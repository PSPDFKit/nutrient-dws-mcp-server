import type { RequestHandler } from 'express'
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose'
import { RequestWithAuth } from './types.js'
import { buildWwwAuthenticateHeader } from './protectedResource.js'
import { hashPrincipal, parseBearerToken } from './authUtils.js'

function parseScopes(payload: JWTPayload): string[] {
  if (typeof payload.scope !== 'string') {
    return []
  }

  return payload.scope
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
}

function parseAllowedTools(payload: JWTPayload): string[] | undefined {
  const rawClaim = payload.allowed_tools

  if (Array.isArray(rawClaim)) {
    const tools = rawClaim.filter((tool): tool is string => typeof tool === 'string' && tool.trim().length > 0)
    return tools.length > 0 ? tools : undefined
  }

  if (typeof rawClaim === 'string') {
    const tools = rawClaim
      .split(/[\s,]+/)
      .map((tool) => tool.trim())
      .filter(Boolean)

    return tools.length > 0 ? tools : undefined
  }

  return undefined
}

function toAuthInfo(token: string, payload: JWTPayload): AuthInfo {
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const azp = typeof payload.azp === 'string' ? payload.azp : ''
  const sid = typeof payload.sid === 'string' ? payload.sid : ''

  return {
    token,
    clientId: azp || sub || 'unknown-client',
    scopes: parseScopes(payload),
    expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
    extra: {
      allowedTools: parseAllowedTools(payload),
      principalFingerprint: hashPrincipal(`${sub}|${azp}|${sid}`),
      subject: sub,
      authorizedParty: azp,
      sessionId: sid,
    },
  }
}

export function createJwtAuthMiddleware(options: {
  jwksUrl: string
  issuer: string
  audience: string | string[]
  requiredScope: string
  resourceMetadataUrl: string
}): RequestHandler {
  const jwks = createRemoteJWKSet(new URL(options.jwksUrl))

  return async (req, res, next) => {
    const token = parseBearerToken(req.headers.authorization)

    if (!token) {
      res.set('WWW-Authenticate', buildWwwAuthenticateHeader({ resourceMetadataUrl: options.resourceMetadataUrl }))
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Missing or malformed Authorization header',
      })
      return
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: options.issuer,
        audience: options.audience,
        clockTolerance: '30s',
      })

      const scopes = parseScopes(payload)
      if (!scopes.includes(options.requiredScope)) {
        res.set(
          'WWW-Authenticate',
          buildWwwAuthenticateHeader({
            resourceMetadataUrl: options.resourceMetadataUrl,
            error: 'invalid_token',
            errorDescription: `Required scope "${options.requiredScope}" is missing`,
            scope: options.requiredScope,
          }),
        )
        res.status(401).json({
          error: 'invalid_token',
          error_description: `Required scope "${options.requiredScope}" is missing`,
        })
        return
      }

      ;(req as RequestWithAuth).auth = toAuthInfo(token, payload)
      next()
    } catch (error) {
      const errorDescription = error instanceof Error ? error.message : 'Invalid token'
      res.set(
        'WWW-Authenticate',
        buildWwwAuthenticateHeader({
          resourceMetadataUrl: options.resourceMetadataUrl,
          error: 'invalid_token',
          errorDescription,
        }),
      )
      res.status(401).json({
        error: 'invalid_token',
        error_description: errorDescription,
      })
    }
  }
}
