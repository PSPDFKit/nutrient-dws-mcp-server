import axios from 'axios'
import { getApiKey, pipeToString } from './utils.js'
import { getVersion } from '../version.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * Account info response from DWS API (GET /account/info)
 *
 * Reference: https://www.nutrient.io/api/reference/public/#tag/Account/operation/get-account-info
 */
interface AccountInfoResponse {
  apiKeys?: {
    live?: string
  }
  signedIn?: boolean
  subscriptionType?: string
  usage?: {
    totalCredits?: number
    usedCredits?: number
  }
}

/**
 * Strips sensitive fields (API keys) from the account info response
 * before returning it to the LLM.
 */
export function sanitizeAccountInfo(data: AccountInfoResponse): Omit<AccountInfoResponse, 'apiKeys'> {
  const { apiKeys: _apiKeys, ...safe } = data
  return safe
}

/**
 * Calls the DWS /account/info endpoint and returns credit information.
 */
export async function performCheckCreditsCall(): Promise<CallToolResult> {
  const apiKey = getApiKey()

  const response = await axios.get('https://api.nutrient.io/account/info', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': `NutrientDWSMCPServer/${getVersion()}`,
    },
    responseType: 'stream',
  })

  const raw = await pipeToString(response.data)

  let parsed: AccountInfoResponse
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      content: [{ type: 'text', text: `Unexpected non-JSON response from /account/info: ${raw}` }],
      isError: true,
    }
  }

  const safe = sanitizeAccountInfo(parsed)

  const totalCredits = safe.usage?.totalCredits
  const usedCredits = safe.usage?.usedCredits
  const remainingCredits = totalCredits != null && usedCredits != null ? totalCredits - usedCredits : undefined

  const summary = {
    subscriptionType: safe.subscriptionType ?? 'unknown',
    totalCredits: totalCredits ?? 'unknown',
    usedCredits: usedCredits ?? 'unknown',
    remainingCredits: remainingCredits ?? 'unknown',
    signedIn: safe.signedIn,
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
    isError: false,
  }
}
