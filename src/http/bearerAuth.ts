import { createHash, timingSafeEqual } from 'node:crypto'
import type { Request, RequestHandler } from 'express'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { BearerPrincipalConfig } from '../utils/environment.js'

const FILE_TREE_TOOL_NAMES = new Set(['directory_tree', 'sandbox_file_tree'])

export interface PrincipalAuthExtra extends Record<string, unknown> {
  allowedTools?: string[]
  principalFingerprint: string
}

export type PrincipalAuthInfo = AuthInfo & {
  extra?: PrincipalAuthExtra
}

export type AuthenticatedRequest = Request & {
  auth?: PrincipalAuthInfo
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function sendUnauthorized(
  res: {
    setHeader(name: string, value: string): void
    status(code: number): { json(body: Record<string, string>): void }
  },
  error: string,
  description: string,
) {
  res.setHeader('WWW-Authenticate', `Bearer realm="nutrient-dws-mcp-server", error="${error}", error_description="${description}"`)
  res.status(401).json({ error, message: description })
}

export function expandAllowedTools(allowedTools?: readonly string[]): string[] | undefined {
  if (!allowedTools || allowedTools.length === 0) {
    return undefined
  }

  const expanded = new Set<string>()

  for (const toolName of allowedTools) {
    expanded.add(toolName)

    if (FILE_TREE_TOOL_NAMES.has(toolName)) {
      expanded.add('directory_tree')
      expanded.add('sandbox_file_tree')
    }
  }

  return [...expanded]
}

export function createPrincipalFingerprint(clientId: string, token: string): string {
  return createHash('sha256').update(`${clientId}:${token}`).digest('hex')
}

export function getPrincipalFingerprint(authInfo?: AuthInfo): string | undefined {
  const fingerprint = authInfo?.extra?.principalFingerprint

  if (typeof fingerprint === 'string' && fingerprint.length > 0) {
    return fingerprint
  }

  if (!authInfo?.clientId || !authInfo.token) {
    return undefined
  }

  return createPrincipalFingerprint(authInfo.clientId, authInfo.token)
}

export function getAllowedTools(authInfo?: AuthInfo): string[] | undefined {
  const allowedTools = authInfo?.extra?.allowedTools

  if (!Array.isArray(allowedTools)) {
    return undefined
  }

  return allowedTools.filter((tool): tool is string => typeof tool === 'string' && tool.trim().length > 0)
}

export function isToolAllowed(toolName: string, authInfo?: AuthInfo): boolean {
  const allowedTools = getAllowedTools(authInfo)

  if (!allowedTools || allowedTools.length === 0) {
    return true
  }

  const expanded = expandAllowedTools(allowedTools)
  return expanded?.includes(toolName) ?? true
}

export function createBearerAuthMiddleware(principals: readonly BearerPrincipalConfig[]): RequestHandler {
  return (req, res, next) => {
    const authorizationHeader = req.header('authorization')

    if (!authorizationHeader) {
      sendUnauthorized(res, 'invalid_request', 'Missing Authorization header.')
      return
    }

    const [scheme, token] = authorizationHeader.split(/\s+/, 2)

    if (scheme !== 'Bearer' || !token) {
      sendUnauthorized(res, 'invalid_request', 'Authorization header must use the Bearer scheme.')
      return
    }

    const principal = principals.find(candidate => constantTimeEquals(candidate.token, token))

    if (!principal) {
      sendUnauthorized(res, 'invalid_token', 'Bearer token is not recognized.')
      return
    }

    const authInfo: PrincipalAuthInfo = {
      token,
      clientId: principal.clientId,
      scopes: principal.scopes,
      extra: {
        allowedTools: expandAllowedTools(principal.allowedTools),
        principalFingerprint: createPrincipalFingerprint(principal.clientId, token),
      },
    }

    ;(req as AuthenticatedRequest).auth = authInfo
    next()
  }
}
