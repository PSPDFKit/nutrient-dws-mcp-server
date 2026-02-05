import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { callNutrientApi } from './api.js'
import { handleApiError, pipeToString } from './utils.js'
import { createSuccessResponse } from '../responses.js'

export type CreditAction = 'balance' | 'usage'
export type CreditPeriod = 'day' | 'week' | 'month' | 'all'

const DEFAULT_USAGE_PERIOD: CreditPeriod = 'week'

const BALANCE_PATHS: string[][] = [
  ['credits', 'remaining'],
  ['credits', 'balance'],
  ['credits', 'remainingCredits'],
  ['credits', 'remaining_credits'],
  ['remainingCredits'],
  ['remaining_credits'],
  ['remaining'],
  ['balance'],
  ['creditBalance'],
  ['credit_balance'],
]

const USAGE_PATHS: string[][] = [
  ['usage'],
  ['credits', 'usage'],
  ['consumption'],
  ['creditUsage'],
  ['usageBreakdown'],
  ['usage_breakdown'],
]

/**
 * Fetches current account credit information from the Nutrient API.
 */
export async function performCheckCreditsCall(
  action: CreditAction,
  period?: CreditPeriod,
): Promise<CallToolResult> {
  try {
    const response = await callNutrientApi('account/info', undefined, { method: 'GET' })
    const responseString = await pipeToString(response.data)

    let payload: unknown
    try {
      payload = JSON.parse(responseString)
    } catch {
      return createSuccessResponse(responseString)
    }

    if (action === 'balance') {
      const balance = extractBalance(payload)
      if (balance !== null) {
        return createSuccessResponse(JSON.stringify({ balance }, null, 2))
      }
      return createSuccessResponse(JSON.stringify(payload, null, 2))
    }

    const usagePeriod = period ?? DEFAULT_USAGE_PERIOD
    const usage = extractUsage(payload, usagePeriod)
    if (usage !== null) {
      return createSuccessResponse(JSON.stringify({ period: usagePeriod, usage }, null, 2))
    }

    return createSuccessResponse(JSON.stringify(payload, null, 2))
  } catch (e: unknown) {
    return handleApiError(e)
  }
}

function extractBalance(payload: unknown): number | null {
  if (!isRecord(payload)) {
    return null
  }

  for (const path of BALANCE_PATHS) {
    const value = getNestedValue(payload, path)
    const numberValue = parseNumber(value)
    if (numberValue !== null) {
      return numberValue
    }
  }

  return null
}

function extractUsage(payload: unknown, period: CreditPeriod): unknown | null {
  if (!isRecord(payload)) {
    return null
  }

  for (const path of USAGE_PATHS) {
    const value = getNestedValue(payload, path)
    if (isRecord(value)) {
      if (period in value) {
        return value[period]
      }
      return value
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getNestedValue(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source

  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return undefined
    }
    current = current[key]
  }

  return current
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}
