import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type PackagingSurface = 'smithery.yaml' | 'manifest.json' | 'server.json'

const environmentSource = readFileSync(resolve(process.cwd(), 'src/utils/environment.ts'), 'utf8')
const schemaBody = environmentSource.match(
  /const RawEnvironmentSchema = z\.object\(\{(?<body>[\s\S]*?)\n\}\)\n\nexport function getEnvironment/,
)?.groups?.body

if (!schemaBody) {
  throw new Error('Could not derive runtime environment variables from RawEnvironmentSchema')
}

const SCHEMA_ENVIRONMENT_VARIABLES = [...schemaBody.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map(([, name]) => name)

const RUNTIME_ENVIRONMENT_VARIABLES = new Set([
  ...SCHEMA_ENVIRONMENT_VARIABLES,
  'SANDBOX_PATH',
  'MCP_TRANSPORT',
  'MCP_LOG_FILE',
  'LOG_LEVEL',
  'XDG_CONFIG_HOME',
])

const COMMON_INTENTIONAL_OMISSIONS = {
  // Developer/operator endpoint override; every packaged surface uses the production default.
  DWS_API_BASE_URL: 'uses the production DWS endpoint default',
  // OAuth deployment override; packaged surfaces use Nutrient's production authorization server.
  AUTH_SERVER_URL: 'uses the production OAuth server default',
  // OAuth deployment internal; dynamic client registration supplies the client identity when needed.
  CLIENT_ID: 'uses OAuth dynamic client registration',
  // The packaging surfaces in this repository are all fixed to stdio transport.
  MCP_TRANSPORT: 'surface is fixed to stdio transport',
  // OS-level OAuth cache placement, inherited from the user's environment.
  XDG_CONFIG_HOME: 'inherits the operating-system config location',
} as const

const INTENTIONALLY_OMITTED_BY_SURFACE: Record<PackagingSurface, Record<string, string>> = {
  'smithery.yaml': {
    ...COMMON_INTENTIONAL_OMISSIONS,
    // Operator diagnostic inherited from the launching environment, not user-facing package configuration.
    LOG_LEVEL: 'inherits the operator logging level',
    // Operator diagnostic inherited from the launching environment, not user-facing package configuration.
    MCP_LOG_FILE: 'inherits the operator logging destination',
  },
  'manifest.json': {
    ...COMMON_INTENTIONAL_OMISSIONS,
    // Operator diagnostic inherited from the launching environment, not user-facing package configuration.
    LOG_LEVEL: 'inherits the operator logging level',
    // Operator diagnostic inherited from the launching environment, not user-facing package configuration.
    MCP_LOG_FILE: 'inherits the operator logging destination',
    // The desktop extension deliberately uses browser OAuth instead of collecting a Processor static key.
    NUTRIENT_DWS_API_KEY: 'desktop extension authenticates with browser OAuth',
    // The same product:all OAuth token covers Data Extraction, so no second static key is collected.
    NUTRIENT_DWS_EXTRACTION_API_KEY: 'desktop extension OAuth covers Data Extraction',
  },
  'server.json': {
    ...COMMON_INTENTIONAL_OMISSIONS,
  },
}

const EXPECTED_SMITHERY_CONFIG_BY_ENVIRONMENT_VARIABLE: Record<string, string> = {
  NUTRIENT_DWS_API_KEY: 'nutrientDwsApiKey',
  NUTRIENT_DWS_EXTRACTION_API_KEY: 'nutrientDwsExtractionApiKey',
  SANDBOX_PATH: 'sandboxPath',
}

const EXPECTED_MANIFEST_CONFIG_BY_ENVIRONMENT_VARIABLE: Record<string, string> = {
  NUTRIENT_DWS_API_KEY: 'nutrient_dws_api_key',
  NUTRIENT_DWS_EXTRACTION_API_KEY: 'nutrient_dws_extraction_api_key',
  SANDBOX_PATH: 'sandbox_path',
}

function assertSurfaceParity(surface: PackagingSurface, exposed: Set<string>) {
  const omissions = INTENTIONALLY_OMITTED_BY_SURFACE[surface]

  for (const omitted of Object.keys(omissions)) {
    expect(RUNTIME_ENVIRONMENT_VARIABLES.has(omitted), `${surface} allow-lists unknown variable ${omitted}`).toBe(true)
    expect(exposed.has(omitted), `${surface} both exposes and allow-lists ${omitted}`).toBe(false)
  }

  const missing = [...RUNTIME_ENVIRONMENT_VARIABLES].filter((name) => !exposed.has(name) && !(name in omissions)).sort()

  expect(missing, `${surface} is missing runtime environment variables`).toEqual([])
}

function smitheryEnvironmentVariables(): Set<string> {
  const source = readFileSync(resolve(process.cwd(), 'smithery.yaml'), 'utf8')
  const [schemaSource, commandFunctionSource] = source.split(/^ {2}commandFunction: \|-\n/m)

  if (!schemaSource || !commandFunctionSource) {
    throw new Error('Could not locate Smithery configSchema and commandFunction')
  }

  const schemaProperties = new Set(
    [...schemaSource.matchAll(/^\s{6}([a-z][A-Za-z0-9]*):$/gm)].map(([, property]) => property),
  )
  const mappings = [...commandFunctionSource.matchAll(/^\s{8}([A-Z][A-Z0-9_]+): config\.([a-z][A-Za-z0-9]*),?$/gm)]

  for (const [, environmentVariable, configProperty] of mappings) {
    expect(
      schemaProperties.has(configProperty),
      `smithery.yaml maps ${environmentVariable} from undeclared config property ${configProperty}`,
    ).toBe(true)
    expect(configProperty, `smithery.yaml maps ${environmentVariable} from the wrong config property`).toBe(
      EXPECTED_SMITHERY_CONFIG_BY_ENVIRONMENT_VARIABLE[environmentVariable],
    )
  }

  return new Set(mappings.map(([, environmentVariable]) => environmentVariable))
}

type McpbManifest = {
  server: {
    mcp_config: {
      args?: string[]
      env?: Record<string, string>
    }
  }
  user_config?: Record<string, unknown>
}

function manifestEnvironmentVariables(): Set<string> {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf8')) as McpbManifest
  const exposed = new Set<string>()

  for (const [environmentVariable, value] of Object.entries(manifest.server.mcp_config.env ?? {})) {
    const configProperty = value.match(/^\$\{user_config\.([a-z][a-z0-9_]*)\}$/)?.[1]
    expect(configProperty, `manifest.json ${environmentVariable} must map from user_config`).toBeTruthy()
    expect(
      configProperty && configProperty in (manifest.user_config ?? {}),
      `manifest.json maps ${environmentVariable} from undeclared user_config.${configProperty}`,
    ).toBe(true)
    expect(configProperty, `manifest.json maps ${environmentVariable} from the wrong user_config property`).toBe(
      EXPECTED_MANIFEST_CONFIG_BY_ENVIRONMENT_VARIABLE[environmentVariable],
    )
    exposed.add(environmentVariable)
  }

  const args = manifest.server.mcp_config.args ?? []
  const sandboxFlagIndex = args.indexOf('--sandbox')
  if (sandboxFlagIndex >= 0) {
    const configProperty = args[sandboxFlagIndex + 1]?.match(/^\$\{user_config\.([a-z][a-z0-9_]*)\}$/)?.[1]
    expect(configProperty, 'manifest.json maps --sandbox from the wrong user_config property').toBe(
      EXPECTED_MANIFEST_CONFIG_BY_ENVIRONMENT_VARIABLE.SANDBOX_PATH,
    )
    expect(manifest.user_config).toHaveProperty(configProperty as string)
    exposed.add('SANDBOX_PATH')
  }

  return exposed
}

describe('packaging-surface environment parity', () => {
  it('derives the canonical environment variables from the runtime Zod schema', () => {
    expect(SCHEMA_ENVIRONMENT_VARIABLES.sort()).toEqual([
      'AUTH_SERVER_URL',
      'CLIENT_ID',
      'DWS_API_BASE_URL',
      'NUTRIENT_DWS_API_KEY',
      'NUTRIENT_DWS_EXTRACTION_API_KEY',
    ])
  })

  it('keeps smithery.yaml configSchema and commandFunction env in parity with runtime', () => {
    assertSurfaceParity('smithery.yaml', smitheryEnvironmentVariables())
  })

  it('keeps manifest.json user_config mappings in parity with runtime', () => {
    assertSurfaceParity('manifest.json', manifestEnvironmentVariables())
  })

  const serverJsonPath = resolve(process.cwd(), 'server.json')
  if (existsSync(serverJsonPath)) {
    it('keeps server.json environmentVariables in parity with runtime', () => {
      const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf8')) as {
        packages?: Array<{ environmentVariables?: Array<{ name: string }> }>
      }
      const exposed = new Set(
        (serverJson.packages ?? []).flatMap((pkg) => pkg.environmentVariables ?? []).map(({ name }) => name),
      )
      assertSurfaceParity('server.json', exposed)
    })
  } else {
    it.skip('server.json packaging-surface parity — server.json is absent in this repository', () => {})
  }
})
