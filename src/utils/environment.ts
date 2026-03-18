import { z } from 'zod'

export type Environment = {
  nutrientApiKey?: string
  dwsApiBaseUrl: string
  authServerUrl: string
  clientId?: string
}

const RawEnvironmentSchema = z.object({
  NUTRIENT_DWS_API_KEY: z.string().optional(),
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
    dwsApiBaseUrl: raw.DWS_API_BASE_URL,
    authServerUrl: raw.AUTH_SERVER_URL,
    clientId: raw.CLIENT_ID,
  }
}
