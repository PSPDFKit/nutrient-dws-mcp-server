import { z } from 'zod'

export type Environment = {
  nutrientApiKey?: string
  nutrientExtractApiKey?: string
  dwsApiBaseUrl: string
  authServerUrl: string
  clientId?: string
}

/** Trims whitespace and collapses an empty result to `undefined`, so a blank env var reads as unset. */
function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const RawEnvironmentSchema = z.object({
  NUTRIENT_DWS_API_KEY: z.string().optional(),
  // Data Extraction is a separate product with its own tenant; a Processor
  // static key is bound to the :dws_api tenant and gets a 403 at
  // /extraction/parse, so it needs its own key when not using OAuth.
  NUTRIENT_DWS_EXTRACT_API_KEY: z.string().optional().transform(trimmedOrUndefined),
  DWS_API_BASE_URL: z.string().url().default('https://api.nutrient.io'),
  AUTH_SERVER_URL: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('https://') || u.startsWith('http://localhost'),
      'AUTH_SERVER_URL must use https:// (except localhost for local development)',
    )
    .default('https://api.nutrient.io'),
  CLIENT_ID: z.string().optional(),
})

export function getEnvironment(rawEnv: NodeJS.ProcessEnv = process.env): Environment {
  const raw = RawEnvironmentSchema.parse(rawEnv)

  return {
    nutrientApiKey: raw.NUTRIENT_DWS_API_KEY,
    nutrientExtractApiKey: raw.NUTRIENT_DWS_EXTRACT_API_KEY,
    dwsApiBaseUrl: raw.DWS_API_BASE_URL,
    authServerUrl: raw.AUTH_SERVER_URL,
    clientId: raw.CLIENT_ID,
  }
}
