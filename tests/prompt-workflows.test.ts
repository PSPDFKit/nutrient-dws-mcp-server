import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { config as dotenvConfig } from 'dotenv'
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApiClient } from '../src/dws/api.js'
import { setSandboxDirectory } from '../src/fs/sandbox.js'
import { createMcpServer } from '../src/index.js'
import { WORKFLOW_PROMPTS } from '../src/prompts.js'
import { getEnvironment } from '../src/utils/environment.js'

dotenvConfig()

const LIVE_CALL_TIMEOUT_MS = 120_000
const hasRequiredApiKeys = Boolean(process.env.NUTRIENT_DWS_API_KEY && process.env.NUTRIENT_DWS_EXTRACTION_API_KEY)
const describeWithApiKeys = hasRequiredApiKeys ? describe : describe.skip

let sandboxDirectory: string
let client: Client | undefined
let server: ReturnType<typeof createMcpServer> | undefined

function resultText(result: CallToolResult): string {
  return result.content.map((content) => (content.type === 'text' ? content.text : '')).join('\n')
}

function expectSuccessfulResult(result: CallToolResult): void {
  expect(result.isError).toBeFalsy()
}

async function expectValidPdf(relativePath: string): Promise<void> {
  const absolutePath = path.join(sandboxDirectory, relativePath)
  const [fileStats, contents] = await Promise.all([stat(absolutePath), readFile(absolutePath)])

  expect(fileStats.size).toBeGreaterThan(500)
  expect(contents.subarray(0, 5).toString('ascii')).toBe('%PDF-')
}

function parseInstructions(text: string): Record<string, unknown> {
  const marker = 'instructions = '
  const markerIndex = text.indexOf(marker)
  if (markerIndex === -1) {
    throw new Error('Prompt does not contain an instructions assignment')
  }

  const startIndex = text.indexOf('{', markerIndex + marker.length)
  if (startIndex === -1) {
    throw new Error('Prompt instructions assignment does not contain a JSON object')
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        return JSON.parse(text.slice(startIndex, index + 1)) as Record<string, unknown>
      }
    }
  }

  throw new Error('Prompt instructions assignment contains unbalanced JSON braces')
}

async function getWorkflowPromptText(name: string, args: Record<string, string>): Promise<string> {
  if (!client) {
    throw new Error('MCP client is not connected')
  }

  const definition = WORKFLOW_PROMPTS.find((prompt) => prompt.name === name)
  if (!definition) {
    throw new Error(`Unknown workflow prompt: ${name}`)
  }

  const result = await client.getPrompt({ name, arguments: args })
  const content = result.messages[0]?.content
  if (!content || content.type !== 'text') {
    throw new Error(`${name} did not return a text prompt`)
  }

  let previousToolIndex = -1
  for (const step of definition.toolSequence) {
    const toolIndex = content.text.indexOf(step.tool, previousToolIndex + 1)
    expect(toolIndex, `${name} must name ${step.tool} in workflow order`).toBeGreaterThan(previousToolIndex)
    previousToolIndex = toolIndex
  }

  return content.text
}

async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (!client) {
    throw new Error('MCP client is not connected')
  }

  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: LIVE_CALL_TIMEOUT_MS })
  if (!Array.isArray(result.content)) {
    throw new Error(`${name} returned a task result instead of a tool result`)
  }

  return result as CallToolResult
}

describeWithApiKeys(
  'live MCP workflow prompts (requires NUTRIENT_DWS_API_KEY and NUTRIENT_DWS_EXTRACTION_API_KEY)',
  () => {
    beforeAll(async () => {
      if (!hasRequiredApiKeys) {
        throw new Error('Both Nutrient DWS API keys are required for live workflow prompt tests')
      }

      sandboxDirectory = await mkdtemp(path.join(tmpdir(), 'nutrient-prompt-workflows-'))
      await Promise.all([
        copyFile(path.join(__dirname, 'assets', 'example.pdf'), path.join(sandboxDirectory, 'input.pdf')),
        copyFile(path.join(__dirname, 'assets', 'example.docx'), path.join(sandboxDirectory, 'input.docx')),
      ])
      await setSandboxDirectory(sandboxDirectory)

      const apiClient = createApiClient(getEnvironment())
      server = createMcpServer({ sandboxEnabled: true, apiClient })
      client = new Client({ name: 'live-workflow-prompt-test', version: '1.0.0' })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

      await server.connect(serverTransport)
      await client.connect(clientTransport)
    })

    afterAll(async () => {
      await client?.close()
      await server?.close()
      await setSandboxDirectory(null)
      if (sandboxDirectory) {
        await rm(sandboxDirectory, { recursive: true, force: true })
      }
    })

    it('executes sign_and_watermark', { timeout: LIVE_CALL_TIMEOUT_MS * 2 + 10_000 }, async () => {
      const text = await getWorkflowPromptText('sign_and_watermark', {
        input_path: 'input.pdf',
        output_path: 'signed.pdf',
        watermark_text: 'SMOKE',
      })
      const instructions = parseInstructions(text)

      const watermarkResult = await callTool('document_processor', {
        instructions,
        outputPath: 'signed.pdf.watermarked.pdf',
      })
      expectSuccessfulResult(watermarkResult)

      const signResult = await callTool('document_signer', {
        filePath: 'signed.pdf.watermarked.pdf',
        outputPath: 'signed.pdf',
      })
      expectSuccessfulResult(signResult)

      await expectValidPdf('signed.pdf.watermarked.pdf')
      await expectValidPdf('signed.pdf')
    })

    it('executes extract_document_fields', { timeout: LIVE_CALL_TIMEOUT_MS }, async () => {
      const fields = 'title, author, first_heading'
      await getWorkflowPromptText('extract_document_fields', {
        input_path: 'input.pdf',
        fields,
        output_path: 'fields.json',
      })
      const schema = {
        type: 'object',
        properties: Object.fromEntries(fields.split(',').map((field) => [field.trim(), { type: 'string' }])),
      }

      const result = await callTool('extract_fields', {
        filePath: 'input.pdf',
        schema,
        mode: 'understand',
        outputPath: 'fields.json',
      })

      expectSuccessfulResult(result)
      expect(resultText(result)).toContain('"title"')
      expect((await stat(path.join(sandboxDirectory, 'fields.json'))).size).toBeGreaterThan(2)
    })

    it('executes redact_pii', { timeout: LIVE_CALL_TIMEOUT_MS }, async () => {
      await getWorkflowPromptText('redact_pii', {
        input_path: 'input.pdf',
        output_path: 'redacted.pdf',
      })

      const result = await callTool('ai_redactor', {
        filePath: 'input.pdf',
        outputPath: 'redacted.pdf',
      })

      expectSuccessfulResult(result)
      await expectValidPdf('redacted.pdf')
    })

    it('executes parse_for_rag', { timeout: LIVE_CALL_TIMEOUT_MS }, async () => {
      await getWorkflowPromptText('parse_for_rag', {
        input_path: 'input.pdf',
        output_path: 'parsed.md',
      })

      const result = await callTool('parse_document', {
        filePath: 'input.pdf',
        format: 'markdown',
        mode: 'text',
        outputPath: 'parsed.md',
      })

      expectSuccessfulResult(result)
      expect((await readFile(path.join(sandboxDirectory, 'parsed.md'), 'utf8')).trim().length).toBeGreaterThan(0)
    })

    it('executes office_to_pdfa', { timeout: LIVE_CALL_TIMEOUT_MS }, async () => {
      const text = await getWorkflowPromptText('office_to_pdfa', {
        input_path: 'input.docx',
        output_path: 'archive.pdf',
      })
      const instructions = parseInstructions(text)

      const result = await callTool('document_processor', {
        instructions,
        outputPath: 'archive.pdf',
      })

      expectSuccessfulResult(result)
      await expectValidPdf('archive.pdf')
    })
  },
)
