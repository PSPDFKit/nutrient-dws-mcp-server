import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import type { DwsApiClient } from '../src/dws/client.js'
import { createMcpServer } from '../src/index.js'
import { WORKFLOW_PROMPTS } from '../src/prompts.js'
import {
  AiRedactArgsSchema,
  BuildAPIArgsSchema,
  ExtractFieldsArgsSchema,
  ParseDocumentArgsSchema,
  SignAPIArgsSchema,
} from '../src/schemas.js'

type SupportedProducts = {
  processor: boolean
  extraction: boolean
}

type MockApiClient = {
  apiClient: DwsApiClient
  post: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

type RegisteredPrompt = {
  title?: string
  description?: string
  argsSchema?: {
    shape: Record<
      string,
      {
        description?: string
        isOptional: () => boolean
      }
    >
  }
}

const TOOL_SCHEMA_KEYS: Record<string, Set<string>> = {
  document_processor: new Set(Object.keys(BuildAPIArgsSchema.shape)),
  document_signer: new Set(Object.keys(SignAPIArgsSchema.shape)),
  ai_redactor: new Set(Object.keys(AiRedactArgsSchema.shape)),
  parse_document: new Set(Object.keys(ParseDocumentArgsSchema.shape)),
  extract_fields: new Set(Object.keys(ExtractFieldsArgsSchema.shape)),
}

const ALL_REGISTERED_TOOL_NAMES = [
  'document_processor',
  'document_signer',
  'ai_redactor',
  'parse_document',
  'extract_fields',
  'check_credits',
  'sandbox_file_tree',
  'directory_tree',
]

function createMockApiClient(supported: SupportedProducts = { processor: true, extraction: true }): MockApiClient {
  const post = vi.fn(async () => {
    throw new Error('prompt tests must not call the API')
  })
  const get = vi.fn(async () => {
    throw new Error('prompt tests must not call the API')
  })

  return {
    apiClient: {
      post,
      get,
      supports: (product: keyof SupportedProducts) => supported[product],
    } as unknown as DwsApiClient,
    post,
    get,
  }
}

function registeredPromptMetadata(sandboxEnabled: boolean) {
  const { apiClient } = createMockApiClient()
  const server = createMcpServer({ sandboxEnabled, apiClient })
  const registered = (server as unknown as { _registeredPrompts: Record<string, RegisteredPrompt> })._registeredPrompts

  return Object.entries(registered).map(([name, prompt]) => ({
    name,
    title: prompt.title,
    description: prompt.description,
    arguments: Object.entries(prompt.argsSchema?.shape ?? {}).map(([argumentName, schema]) => ({
      name: argumentName,
      description: schema.description,
      required: !schema.isOptional(),
    })),
  }))
}

function validArguments(promptName: string): Record<string, string> {
  const prompt = WORKFLOW_PROMPTS.find(({ name }) => name === promptName)
  if (!prompt) {
    throw new Error(`Unknown prompt: ${promptName}`)
  }

  return Object.fromEntries(
    prompt.arguments.map(({ name }) => {
      if (name === 'fields') {
        return [name, 'vendor_name, invoice_number']
      }
      if (name.endsWith('_path')) {
        return [name, `/documents/${prompt.name}-${name}.pdf`]
      }
      return [name, `${prompt.name}-${name}-value`]
    }),
  )
}

async function withConnectedClient<T>(
  supported: SupportedProducts,
  callback: (client: Client, mock: MockApiClient) => Promise<T>,
): Promise<T> {
  const mock = createMockApiClient(supported)
  const server = createMcpServer({ sandboxEnabled: true, apiClient: mock.apiClient })
  const client = new Client({ name: 'workflow-prompt-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    return await callback(client, mock)
  } finally {
    await client.close()
    await server.close()
  }
}

async function getPromptText(name: string, args: Record<string, string>): Promise<string> {
  return withConnectedClient({ processor: true, extraction: true }, async (client) => {
    const result = await client.getPrompt({ name, arguments: args })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe('user')

    const content = result.messages[0]?.content
    if (!content || content.type !== 'text') {
      throw new Error(`${name} did not return a text message`)
    }

    return content.text
  })
}

describe('MCP workflow prompts', () => {
  it('registers the same canonical prompt metadata with and without sandbox mode', () => {
    const expected = WORKFLOW_PROMPTS.map((prompt) => ({
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      arguments: prompt.arguments,
    }))

    expect(registeredPromptMetadata(true)).toEqual(expected)
    expect(registeredPromptMetadata(false)).toEqual(expected)
  })

  it.each(WORKFLOW_PROMPTS)('$name returns a valid ordered workflow message', async (prompt) => {
    const args = validArguments(prompt.name)
    const text = await getPromptText(prompt.name, args)
    let previousToolIndex = -1

    for (const step of prompt.toolSequence) {
      const toolIndex = text.indexOf(step.tool, previousToolIndex + 1)
      expect(toolIndex, `${step.tool} is missing or out of order`).toBeGreaterThan(previousToolIndex)
      previousToolIndex = toolIndex

      const schemaKeys = TOOL_SCHEMA_KEYS[step.tool]
      expect(schemaKeys, `${step.tool} does not have a test schema mapping`).toBeTruthy()
      for (const argumentKey of step.argumentKeys) {
        expect(schemaKeys?.has(argumentKey), `${step.tool}.${argumentKey} is not a registered input`).toBe(true)
      }
    }

    for (const value of Object.values(args)) {
      expect(text).toContain(value)
    }
  })

  it('orders watermark processing before signing', async () => {
    const text = await getPromptText('sign_and_watermark', validArguments('sign_and_watermark'))

    expect(text.indexOf('document_processor')).toBeLessThan(text.indexOf('document_signer'))
  })

  it('uses exactly one extraction tool and includes every requested field', async () => {
    const args = validArguments('extract_document_fields')
    const text = await getPromptText('extract_document_fields', args)

    expect(text.match(/extract_fields/g)).toHaveLength(1)
    for (const toolName of ALL_REGISTERED_TOOL_NAMES.filter((name) => name !== 'extract_fields')) {
      expect(text).not.toContain(toolName)
    }
    for (const field of args.fields.split(',').map((name) => name.trim())) {
      expect(text).toContain(field)
    }
  })

  it('parses Markdown to the requested RAG output path', async () => {
    const args = validArguments('parse_for_rag')
    const text = await getPromptText('parse_for_rag', args)

    expect(text).toContain('parse_document')
    expect(text).toContain(args.output_path)
  })

  it('returns InvalidParams when a required argument is missing', async () => {
    await withConnectedClient({ processor: true, extraction: true }, async (client) => {
      await expect(
        client.getPrompt({
          name: 'sign_and_watermark',
          arguments: {
            output_path: '/documents/signed.pdf',
            watermark_text: 'Confidential',
          },
        }),
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams })
    })
  })

  it('keeps prompt list/get results credential-independent without API calls', async () => {
    const modes: SupportedProducts[] = [
      { processor: true, extraction: true },
      { processor: true, extraction: false },
      { processor: false, extraction: true },
    ]
    const results = []

    for (const supported of modes) {
      results.push(
        await withConnectedClient(supported, async (client, mock) => {
          const listed = await client.listPrompts()
          const fetched = await client.getPrompt({
            name: 'parse_for_rag',
            arguments: validArguments('parse_for_rag'),
          })

          expect(mock.post).not.toHaveBeenCalled()
          expect(mock.get).not.toHaveBeenCalled()
          return { listed, fetched }
        }),
      )
    }

    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })

  it('advertises the prompts capability during initialize', async () => {
    await withConnectedClient({ processor: true, extraction: true }, async (client) => {
      expect(client.getServerCapabilities()).toHaveProperty('prompts')
    })
  })
})
