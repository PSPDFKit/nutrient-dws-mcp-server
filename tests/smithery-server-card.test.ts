import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import type { DwsApiClient } from '../src/dws/client.js'
import { createMcpServer } from '../src/index.js'
import {
  assertVersionsAgree,
  buildDeployPayload,
  buildServerInfo,
  shapePrompts,
  shapeTools,
  userConfigToConfigSchema,
  validateDeployPayload,
} from '../src/smithery/server-card.js'

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, unknown>
}

function createMockApiClient(): DwsApiClient {
  return {
    post: async () => {
      throw new Error('server-card tests must not call the API')
    },
    get: async () => {
      throw new Error('server-card tests must not call the API')
    },
    supports: () => true,
  } as unknown as DwsApiClient
}

describe('Smithery server card', () => {
  it('converts the actual optional sandbox user config to Smithery config schema', () => {
    const manifest = readJson('manifest.json')
    const schema = userConfigToConfigSchema(manifest.user_config)

    expect(schema.properties.sandbox_path).toEqual({
      type: 'string',
      title: 'Sandbox Directory',
      description: 'Directory the extension can read from and write to for document processing.',
      default: '${HOME}/Documents/Nutrient',
      'x-order': 0,
    })
    expect(schema.required ?? []).not.toContain('sandbox_path')
  })

  it('shapes tools without null annotations and forces a missing input schema type to object', () => {
    const [tool] = shapeTools([
      {
        name: 'example',
        description: 'Example tool',
        inputSchema: { properties: { path: { type: 'string' } } },
        annotations: null,
        title: 'not part of a Smithery tool',
      },
    ])

    expect(tool).toEqual({
      name: 'example',
      description: 'Example tool',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    })
    expect(tool).not.toHaveProperty('annotations')
  })

  it('keeps only Smithery prompt fields and argument fields', () => {
    const [prompt] = shapePrompts([
      {
        name: 'example',
        title: 'drop me',
        description: 'Example prompt',
        template: 'drop me too',
        arguments: [
          {
            name: 'path',
            description: 'Input path',
            required: true,
            schema: { type: 'string' },
          },
        ],
      },
    ])

    expect(prompt).toEqual({
      name: 'example',
      description: 'Example prompt',
      arguments: [{ name: 'path', description: 'Input path', required: true }],
    })
  })

  it('builds serverInfo from the fixed Smithery sources', () => {
    const serverJson = readJson('server.json')

    expect(
      buildServerInfo({
        name: 'nutrient-dws-mcp-server',
        version: '0.1.2',
        serverJsonDescription: String(serverJson.description),
      }),
    ).toEqual({
      name: 'nutrient-dws-mcp-server',
      version: '0.1.2',
      title: 'Nutrient DWS MCP Server',
      description: serverJson.description,
      websiteUrl: 'https://www.nutrient.io/api/',
    })
  })

  it('rejects invalid tool schemas and extra prompt keys', () => {
    const problems = validateDeployPayload({
      type: 'stdio',
      runtime: 'node',
      configSchema: { type: 'object', properties: {} },
      serverCard: {
        serverInfo: { name: 'example', version: '1.0.0' },
        tools: [{ name: 'broken', inputSchema: { type: 'string' } }],
        prompts: [{ name: 'broken', title: 'unsupported' }],
      },
    })

    expect(problems).toContain('serverCard.tools[0].inputSchema must be an object schema')
    expect(problems).toContain('serverCard.prompts[0] has unsupported key "title"')
  })

  it('accepts a payload built from a live in-memory MCP server', async () => {
    const manifest = readJson('manifest.json')
    const serverJson = readJson('server.json')
    const server = createMcpServer({ sandboxEnabled: true, apiClient: createMockApiClient() })
    const client = new Client({ name: 'smithery-server-card-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)

      const toolsResult = await client.listTools()
      const promptsResult = await client.listPrompts()
      const serverInfo = client.getServerVersion()
      if (!serverInfo) {
        throw new Error('initialize did not return serverInfo')
      }

      const payload = buildDeployPayload({
        initializeResult: { serverInfo },
        tools: toolsResult.tools,
        prompts: promptsResult.prompts,
        manifest: { user_config: manifest.user_config },
        serverJson: { description: String(serverJson.description) },
      })

      expect(payload.serverCard.tools).toHaveLength(7)
      expect(payload.serverCard.prompts).toHaveLength(5)
      expect(validateDeployPayload(payload)).toEqual([])
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('reports every compared version when they disagree', () => {
    expect(() =>
      assertVersionsAgree({ expected: '0.1.3', packageJsonVersion: '0.1.2', serverVersion: '0.1.1' }),
    ).toThrow('Version mismatch: expected=0.1.3, package.json=0.1.2, running server=0.1.1')
  })
})
