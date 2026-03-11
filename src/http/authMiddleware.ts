import type { RequestHandler } from 'express'
import { Environment } from '../utils/environment.js'
import { createBearerAuthMiddleware } from './bearerAuth.js'
import { createJwtAuthMiddleware } from './jwtAuth.js'

export function createAuthMiddleware(environment: Environment): RequestHandler {
  if (environment.authMode === 'jwt') {
    if (!environment.jwksUrl || !environment.issuer) {
      throw new Error('JWT auth mode requires both JWKS_URL and ISSUER')
    }

    return createJwtAuthMiddleware({
      jwksUrl: environment.jwksUrl,
      issuer: environment.issuer,
      audience: 'dws-mcp',
      requiredScope: 'mcp:invoke',
      resourceMetadataUrl: environment.protectedResourceMetadataUrl,
    })
  }

  return createBearerAuthMiddleware({
    principals: environment.staticPrincipals,
    resourceMetadataUrl: environment.protectedResourceMetadataUrl,
  })
}
