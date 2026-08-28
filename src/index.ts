#!/usr/bin/env node

/**
 * Nutrient DWS API MCP Server
 *
 * This server provides a Model Context Protocol (MCP) interface to the Nutrient DWS Processor API.
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  AiRedactArgsSchema,
  BuildAPIArgsSchema,
  CheckCreditsArgsSchema,
  DirectoryTreeArgsSchema,
  ExtractFieldsArgsSchema,
  ParseDocumentArgsSchema,
  SignAPIArgsSchema,
} from './schemas.js'
import { setSandboxDirectory } from './fs/sandbox.js'
import { getVersion } from './version.js'
import { parseSandboxPath } from './utils/sandbox.js'
import { createApiClient } from './dws/api.js'
import { DwsApiClient } from './dws/client.js'
import { Environment, getEnvironment } from './utils/environment.js'
import { logger } from './logger.js'
import { addPromptsToServer } from './prompts.js'
import { executeTool } from './tool-runner.js'
import { isCliCommand, runCli } from './cli.js'

function addToolsToServer(options: {
  server: McpServer
  sandboxEnabled: boolean
  apiClient: DwsApiClient
  startupReady: Promise<void>
}) {
  const { server, sandboxEnabled, apiClient, startupReady } = options

  server.tool(
    'document_processor',
    `Process, convert, and transform documents using the Nutrient API. Reads input files from the local file system or sandbox (if enabled) and writes results back locally.

Features:
• Import XFDF annotations
• Flatten annotations
• OCR processing
• Page rotation
• Watermarking (text/image)
• Redaction creation and application

Output formats: PDF, PDF/A, images (PNG, JPEG, WebP), Office (DOCX, XLSX, PPTX)

For structured data extraction (typed JSON or Markdown with bounding boxes and confidence scores), use the dedicated parse_document tool instead.`,
    BuildAPIArgsSchema.shape,
    {
      title: 'Nutrient Document Processor',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async (args) => executeTool('document_processor', args, { apiClient, startupReady }),
  )

  server.tool(
    'document_signer',
    `Digitally sign PDF files using the Nutrient Sign API. Reads input files from the local file system or sandbox (if enabled) and writes signed output back locally.

Signature types:
• CMS/PKCS#7 (standard digital signatures)
• CAdES (advanced electronic signatures)

Appearance options:
• Visible or invisible signatures
• Multiple display modes (signature only, description only, or both)
• Customizable elements (signer name, reason, location, date)
• Support for watermarks and custom graphics

Positioning:
• Place on specific page coordinates
• Use existing signature form fields`,
    SignAPIArgsSchema.shape,
    {
      title: 'Nutrient Document Signer',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async (args) => executeTool('document_signer', args, { apiClient, startupReady }),
  )

  server.tool(
    'ai_redactor',
    `Detect and permanently redact sensitive content using the Nutrient AI Redaction API. Reads input files from the local file system or sandbox (if enabled) and writes redacted output back locally.

Automatically detects and permanently removes sensitive information from documents using AI analysis.
Detected content types include:
• Personally identifiable information (names, addresses, phone numbers)
• Financial data (credit card numbers, bank accounts, SSNs)
• Email addresses and URLs
• Protected health information (PHI)
• Any custom criteria you specify

By default (when neither stage nor apply is set), redactions are detected and immediately applied. Set stage to true to detect and stage redactions without applying them. Set apply to true to apply previously staged redactions.`,
    AiRedactArgsSchema.shape,
    {
      title: 'Nutrient AI Redactor',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async (args) => executeTool('ai_redactor', args, { apiClient, startupReady }),
  )

  server.tool(
    'check_credits',
    `Check your Nutrient DWS API credit balance and usage for the current billing period.

This is a read-only account lookup. It does not upload any document content.

Returns: subscription type, total credits, used credits, and remaining credits.`,
    CheckCreditsArgsSchema.shape,
    {
      title: 'Nutrient Credit Balance',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async (args) => executeTool('check_credits', args, { apiClient, startupReady }),
  )

  server.tool(
    'parse_document',
    `Extract structured data from a document using the Nutrient DWS Data Extraction API. Reads the input file from the local file system or sandbox (if enabled), or fetches it directly from a URL — provide exactly one of filePath or url.

Output formats:
• spatial — typed elements (paragraphs, tables, key-value pairs, formulas, pictures, handwriting) with bounding boxes, confidence scores, and reading order. Written to outputPath (the list can be large).
• markdown — whole-document Markdown. Returned inline, or written to outputPath when provided (recommended for large documents). Good for RAG and search indexing.
• Both at once via formats: ["spatial", "markdown"] — a second format costs no extra credits, so ask for both up front instead of extracting twice.

Processing modes (cost per page): text = fast Markdown, no OCR (1 credit); structure = OCR spatial (1.5 credits); understand = AI-augmented, default (9 credits); agentic = VLM-augmented (18 credits).

Note: markdown output and any extracted content are returned into this conversation and may be logged by the host. For sensitive documents, prefer spatial output to a file plus targeted extract_fields calls.`,
    ParseDocumentArgsSchema.shape,
    {
      title: 'Nutrient Document Parser',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async (args) => executeTool('parse_document', args, { apiClient, startupReady }),
  )

  server.tool(
    'extract_fields',
    `Pull specific named fields out of a document into a JSON shape you define, using the Nutrient DWS Data Extraction API. Reads the input file from the local file system or sandbox (if enabled), or fetches it directly from a URL — provide exactly one of filePath or url.

Unlike parse_document, which parses a whole document into elements or Markdown, extract_fields takes a JSON schema (root type: "object", with properties) and returns only the values matching it — e.g. { invoiceNumber, total, lineItems: [...] } — each with a per-field citation (bounding box, confidence, and match quality) tying it back to where it was found.

Processing modes (cost per page, parse component only — no text mode here): structure = OCR spatial parse (1.5 credits); understand = AI-augmented, default (9 credits); agentic = VLM-augmented (18 credits). Total cost per page is this parse component plus a fixed extract component, billed in Data Extraction credits — a separate balance from the Processor API credits reported by check_credits.

output.data (the extracted values) is always returned inline. Per-field citations and page geometry are large and are only kept when outputPath is provided; otherwise a note says they were omitted.`,
    ExtractFieldsArgsSchema.shape,
    {
      title: 'Nutrient Field Extractor',
      // Writes to outputPath, like parse_document — not read-only, whatever the
      // "extractor" name suggests.
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async (args) => executeTool('extract_fields', args, { apiClient, startupReady }),
  )

  if (sandboxEnabled) {
    server.tool(
      'sandbox_file_tree',
      'Browse files already available in the configured sandbox directory. This is a read-only local filesystem operation and does not upload documents to Nutrient.',
      {},
      {
        title: 'Nutrient Sandbox Files',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async (args) => executeTool('sandbox_file_tree', args, { apiClient, startupReady }),
    )
  } else {
    server.tool(
      'directory_tree',
      'Browse local files when sandbox mode is disabled. This is a read-only local filesystem operation, but it can inspect any path visible to the current user. Sandbox mode is strongly recommended.',
      DirectoryTreeArgsSchema.shape,
      {
        title: 'Nutrient Directory Tree',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      async (args) => executeTool('directory_tree', args, { apiClient, startupReady }),
    )
  }
}

export function createMcpServer(options: {
  sandboxEnabled: boolean
  apiClient: DwsApiClient
  startupReady?: Promise<void>
}) {
  const server = new McpServer(
    {
      name: 'nutrient-dws-mcp-server',
      version: getVersion(),
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  )

  addToolsToServer({
    server,
    sandboxEnabled: options.sandboxEnabled,
    apiClient: options.apiClient,
    startupReady: options.startupReady ?? Promise.resolve(),
  })
  addPromptsToServer(server)

  return server
}

async function parseCommandLineArgs() {
  const args = process.argv.slice(2)
  const sandboxDir = parseSandboxPath(args, process.env.SANDBOX_PATH) || null
  return { sandboxDir }
}

async function prepareSandbox(sandboxDir: string | null) {
  if (sandboxDir) {
    await setSandboxDirectory(sandboxDir)
    return
  }

  console.warn(
    'Info: No sandbox directory specified. File operations will not be restricted.\n' +
      'Sandboxed mode is recommended - To enable sandboxed mode and restrict file operations, set SANDBOX_PATH environment variable',
  )
}

type RunServerResult = {
  close: () => Promise<void>
}

type RunServerOptions = {
  sandboxDir?: string | null
  transport?: Transport
  startupReady?: Promise<void>
}

const STDIO_PIPE_HINT =
  'MCP stdio transport expects piped stdin/stdout; if a client reports no response under npx shims, run via node directly'

export function warnIfStdioTransportIsInteractive(
  stdinIsTTY: boolean | undefined = process.stdin.isTTY,
  stdoutIsTTY: boolean | undefined = process.stdout.isTTY,
) {
  if (stdinIsTTY || stdoutIsTTY) {
    console.error(STDIO_PIPE_HINT)
  }
}

export async function runServer(environment: Environment, options: RunServerOptions = {}): Promise<RunServerResult> {
  const sandboxDir = options.sandboxDir === undefined ? (await parseCommandLineArgs()).sandboxDir : options.sandboxDir
  // Start sandbox validation without keeping the MCP handshake behind potentially slow filesystem I/O.
  // Tool handlers share this promise, so no tool can observe a partially prepared sandbox.
  const startupReady = options.startupReady ?? prepareSandbox(sandboxDir)
  void startupReady.catch(() => {})

  const sandboxEnabled = sandboxDir !== null

  // Keep construction side-effect free: OAuth cache reads, refresh, and browser auth belong to the first API tool call.
  const apiClient = createApiClient(environment)

  const staticKeyMode = Boolean(environment.nutrientApiKey || environment.nutrientExtractionApiKey)

  logger.info('Starting stdio transport', {
    version: getVersion(),
    authMethod: apiClient.supports('processor') ? (staticKeyMode ? 'api-key' : 'oauth-browser-flow') : 'unconfigured',
    extractAuthMethod: apiClient.supports('extraction')
      ? (staticKeyMode ? 'api-key' : 'oauth-browser-flow')
      : 'unconfigured',
    sandboxEnabled,
    dwsApiBaseUrl: environment.dwsApiBaseUrl,
  })

  const server = createMcpServer({
    sandboxEnabled,
    apiClient,
    startupReady,
  })

  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)

  logger.info('stdio transport connected')

  try {
    await startupReady
  } catch (startupError) {
    try {
      await server.close()
    } catch (closeError) {
      logger.error('Failed to close server after startup error', { err: closeError })
    }
    throw startupError
  }

  await server.server.sendLoggingMessage({
    level: 'info',
    data: `Nutrient DWS MCP Server ${getVersion()} running on stdio transport.`,
  })

  return {
    close: async () => {
      await server.close()
    },
  }
}

function isMainModule() {
  const entryFile = process.argv[1]
  if (!entryFile) {
    return false
  }

  return resolve(fileURLToPath(import.meta.url)) === resolve(entryFile)
}

export function isCliInvocation(args: string[]): boolean {
  const first = args[0]
  return first === 'cli' || first === '--help' || first === '-h' || first === '--version' || first === '-v' || isCliCommand(first)
}

if (isMainModule()) {
  const commandLineArgs = process.argv.slice(2)

  if (isCliInvocation(commandLineArgs)) {
    const cliArgs = commandLineArgs[0] === 'cli' ? commandLineArgs.slice(1) : commandLineArgs
    runCli(cliArgs)
      .then((exitCode) => {
        process.exitCode = exitCode
      })
      .catch((error) => {
        console.error(`Fatal CLI error: ${error instanceof Error ? error.message : error}`)
        process.exitCode = 2
      })
  } else {
    let activeServer: RunServerResult | undefined

    warnIfStdioTransportIsInteractive()

    let environment: Environment
    try {
      environment = getEnvironment()
    } catch (e) {
      console.error(`Invalid environment configuration: ${e instanceof Error ? e.message : e}`)
      process.exit(1)
    }

    runServer(environment)
      .then((result) => {
        activeServer = result
      })
      .catch((error) => {
        console.error('Fatal error running server:', error)
        process.exit(1)
      })

    process.on('SIGINT', async () => {
      if (activeServer) {
        await activeServer.close().catch(() => {})
      }

      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      if (activeServer) {
        await activeServer.close().catch(() => {})
      }

      process.exit(0)
    })

    process.stdin.on('close', async () => {
      if (activeServer) {
        await activeServer.close().catch(() => {})
      }
    })
  }
}
