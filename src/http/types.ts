import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { Request } from 'express'

export type McpAuthInfoExtra = {
  allowedTools?: string[]
  principalFingerprint?: string
  subject?: string
  authorizedParty?: string
  sessionId?: string
  [key: string]: unknown
}

export type McpAuthInfo = AuthInfo & {
  extra?: McpAuthInfoExtra
}

export type RequestWithAuth = Request & {
  auth?: McpAuthInfo
}

export function getAllowedTools(authInfo?: AuthInfo): string[] | undefined {
  const tools = (authInfo?.extra as McpAuthInfoExtra | undefined)?.allowedTools
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined
  }

  const validTools = tools.filter((tool): tool is string => typeof tool === 'string' && tool.length > 0)
  return validTools.length > 0 ? validTools : undefined
}

export function getPrincipalFingerprint(authInfo?: AuthInfo): string | undefined {
  const fingerprint = (authInfo?.extra as McpAuthInfoExtra | undefined)?.principalFingerprint
  return typeof fingerprint === 'string' && fingerprint.length > 0 ? fingerprint : undefined
}

export function isToolAllowed(toolName: string, authInfo?: AuthInfo): boolean {
  const allowedTools = getAllowedTools(authInfo)
  if (!allowedTools) {
    return true
  }

  return allowedTools.includes(toolName)
}
