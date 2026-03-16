import type { RequestHandler } from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { StaticPrincipal } from '../utils/environment.js'
import { RequestWithAuth } from './types.js'
import { buildWwwAuthenticateHeader } from './protectedResource.js'
import { hashPrincipal, parseBearerToken } from './authUtils.js'

function safeTokenEquals(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

function buildAuthInfo(principal: StaticPrincipal): AuthInfo {
  return {
    token: '[static]',
    clientId: principal.clientId,
    scopes: principal.scopes,
    extra: {
      allowedTools: principal.allowedTools,
      principalFingerprint: hashPrincipal(`${principal.clientId}:${principal.token}`),
    },
  }
}

export function createBearerAuthMiddleware(options: {
  principals: StaticPrincipal[]
  resourceMetadataUrl: string
}): RequestHandler {
  const { principals, resourceMetadataUrl } = options

  return (req, res, next) => {
    const token = parseBearerToken(req.headers.authorization)

    if (!token) {
      res.set('WWW-Authenticate', buildWwwAuthenticateHeader({ resourceMetadataUrl }))
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Missing or malformed Authorization header',
      })
      return
    }

    const principal = principals.find((candidate) => safeTokenEquals(candidate.token, token))

    if (!principal) {
      res.set(
        'WWW-Authenticate',
        buildWwwAuthenticateHeader({
          resourceMetadataUrl,
          error: 'invalid_token',
          errorDescription: 'Bearer token is invalid',
        }),
      )
      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Bearer token is invalid',
      })
      return
    }

    const authInfo = buildAuthInfo({ ...principal, token })
    ;(req as RequestWithAuth).auth = authInfo
    next()
  }
}
