import FormData from 'form-data'
import axios from 'axios'
import { getApiKey } from './utils.js'
import { getVersion } from '../version.js'

/**
 * Makes an API call to the Nutrient API
 * @param endpoint The API endpoint to call (e.g., 'sign', 'build', 'ai/redact')
 * @param data The data to send (FormData or JSON object)
 * @param options Optional request configuration (e.g., timeout for slow endpoints)
 * @returns The API response
 */
export async function callNutrientApi(
  endpoint: string,
  data: FormData | Record<string, unknown>,
  options?: { timeout?: number },
) {
  const apiKey = getApiKey()
  const isFormData = data instanceof FormData

  const defaultHeaders: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': `NutrientDWSMCPServer/${getVersion()}`,
  }

  const headers: Record<string, string> = isFormData
    ? defaultHeaders
    : {
        ...defaultHeaders,
        'Content-Type': 'application/json',
      }
  return axios.post(`https://api.nutrient.io/${endpoint}`, data, {
    headers,
    responseType: 'stream',
    timeout: options?.timeout,
  })
}
