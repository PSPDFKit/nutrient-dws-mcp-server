import FormData from 'form-data'
import axios from 'axios'
import { getApiKey } from './utils.js'
import { getVersion } from '../version.js'

/**
 * Makes an API call to the Nutrient API
 * @param endpoint The API endpoint to call (e.g., 'sign', 'build')
 * @param data The data to send (FormData or JSON object)
 * @param options Optional request settings (e.g. HTTP method)
 * @returns The API response
 */
export async function callNutrientApi(
  endpoint: string,
  data?: FormData | Record<string, unknown>,
  options: { method?: 'GET' | 'POST' } = {},
) {
  const apiKey = getApiKey()
  const isFormData = data instanceof FormData
  const method = options.method ?? 'POST'

  const defaultHeaders: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': `NutrientDWSMCPServer/${getVersion()}`,
  }

  const headers: Record<string, string> =
    isFormData || method === 'GET'
      ? defaultHeaders
      : {
          ...defaultHeaders,
          'Content-Type': 'application/json',
        }

  return axios.request({
    method,
    url: `https://api.nutrient.io/${endpoint}`,
    headers,
    responseType: 'stream',
    ...(method === 'GET' ? {} : { data: data ?? {} }),
  })
}
