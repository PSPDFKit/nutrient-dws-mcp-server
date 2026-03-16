import { createHash } from 'node:crypto'

export function hashPrincipal(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function parseBearerToken(authHeader?: string): string | undefined {
  if (!authHeader) {
    return undefined
  }

  const [scheme, token] = authHeader.split(/\s+/, 2)
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return undefined
  }

  return token
}
