import type { RequestHandler } from 'express'
import { Environment } from '../utils/environment.js'
import { createBearerAuthMiddleware } from './bearerAuth.js'
import { createJwtAuthMiddleware } from './jwtAuth.js'

export function createAuthMiddleware(environment: Environment): RequestHandler {
  if (environment.authMode === 'jwt') {
    if (!environment.jwksUrl || !environment.issuer) {
      throw new Error('JWT auth mode requires both JWKS_URL and ISSUER')
    }

    const audiences = Array.from(new Set(['dws-mcp', environment.resourceUrl]))

    return createJwtAuthMiddleware({
      jwksUrl: environment.jwksUrl,
      issuer: environment.issuer,
      audience: audiences,
      requiredScope: 'mcp:invoke',
      resourceMetadataUrl: environment.protectedResourceMetadataUrl,
    })
  }

  return createBearerAuthMiddleware({
    principals: environment.staticPrincipals,
    resourceMetadataUrl: environment.protectedResourceMetadataUrl,
  })
}
