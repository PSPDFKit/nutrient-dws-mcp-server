import type { RequestHandler } from 'express'
import { Environment } from '../utils/environment.js'
import { createBearerAuthMiddleware } from './bearerAuth.js'
import { createJwtAuthMiddleware } from './jwtAuth.js'

function addAudienceWithTrailingSlashVariants(target: Set<string>, value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return
  }

  target.add(trimmed)
  target.add(`${trimmed}/`)
}

export function buildJwtAudiences(resourceUrl: string): string[] {
  const audiences = new Set<string>(['dws-mcp'])
  addAudienceWithTrailingSlashVariants(audiences, resourceUrl)

  try {
    const parsed = new URL(resourceUrl)
    addAudienceWithTrailingSlashVariants(audiences, parsed.origin)

    const normalizedPath = parsed.pathname.replace(/\/+$/, '')
    if (normalizedPath && normalizedPath !== '/') {
      addAudienceWithTrailingSlashVariants(audiences, `${parsed.origin}${normalizedPath}`)
    }
  } catch {
    // Keep best-effort audience list when resourceUrl is not a valid URL.
  }

  return Array.from(audiences)
}

export function createAuthMiddleware(environment: Environment): RequestHandler {
  if (environment.authMode === 'jwt') {
    if (!environment.jwksUrl || !environment.issuer) {
      throw new Error('JWT auth mode requires both JWKS_URL and ISSUER')
    }

    return createJwtAuthMiddleware({
      jwksUrl: environment.jwksUrl,
      issuer: environment.issuer,
      audience: buildJwtAudiences(environment.resourceUrl),
      requiredScope: 'mcp:invoke',
      resourceMetadataUrl: environment.protectedResourceMetadataUrl,
    })
  }

  return createBearerAuthMiddleware({
    principals: environment.staticPrincipals,
    resourceMetadataUrl: environment.protectedResourceMetadataUrl,
  })
}
