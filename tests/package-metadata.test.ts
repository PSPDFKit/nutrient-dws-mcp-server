import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  version: string
  mcpName: string
}

const manifestJson = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf8')) as {
  version: string
}

const serverJson = JSON.parse(readFileSync(resolve(process.cwd(), 'server.json'), 'utf8')) as {
  $schema: string
  name: string
  version: string
  packages: Array<{
    version: string
    transport: { type: string }
    environmentVariables: Array<{
      name: string
      isRequired: boolean
      isSecret: boolean
    }>
  }>
}

describe('package metadata', () => {
  it('keeps all release versions in sync', () => {
    expect(manifestJson.version).toBe(packageJson.version)
    expect(serverJson.version).toBe(packageJson.version)
    expect(serverJson.packages[0]?.version).toBe(packageJson.version)
  })

  it('keeps the published npm package name aligned with the registry server name', () => {
    expect(packageJson.mcpName).toBe('io.github.PSPDFKit/nutrient-dws-mcp-server')
    expect(serverJson.name).toBe(packageJson.mcpName)
  })

  it('keeps the registry package on stdio with its supported install-time environment variables', () => {
    expect(serverJson.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json')
    expect(serverJson.packages[0]?.transport.type).toBe('stdio')
    expect(
      serverJson.packages[0]?.environmentVariables.map(({ name, isRequired, isSecret }) => ({
        name,
        isRequired,
        isSecret,
      })),
    ).toEqual([
      { name: 'NUTRIENT_DWS_API_KEY', isRequired: false, isSecret: true },
      { name: 'NUTRIENT_DWS_EXTRACTION_API_KEY', isRequired: false, isSecret: true },
      { name: 'SANDBOX_PATH', isRequired: false, isSecret: false },
      { name: 'LOG_LEVEL', isRequired: false, isSecret: false },
      { name: 'MCP_LOG_FILE', isRequired: false, isSecret: false },
    ])
  })
})
