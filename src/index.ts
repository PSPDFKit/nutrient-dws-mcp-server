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
import {
  AiRedactArgsSchema,
  BuildAPIArgsSchema,
  CheckCreditsArgsSchema,
  DataExtractorArgsSchema,
  DirectoryTreeArgsSchema,
  QueryExtractionArgsSchema,
  SignAPIArgsSchema,
} from './schemas.js'
import { performBuildCall } from './dws/build.js'
import { performExtractCall, performQueryCall } from './dws/extract.js'
import { performSignCall } from './dws/sign.js'
import { performAiRedactCall } from './dws/ai-redact.js'
import { performCheckCreditsCall } from './dws/credits.js'
import { performDirectoryTreeCall } from './fs/directoryTree.js'
import { setSandboxDirectory } from './fs/sandbox.js'
import { createErrorResponse } from './responses.js'
import { getVersion } from './version.js'
import { parseSandboxPath } from './utils/sandbox.js'
import { createApiClient } from './dws/api.js'
import { DwsApiClient } from './dws/client.js'
import { getToken, invalidateCachedToken, type NutrientOAuthConfig } from './auth/nutrient-oauth.js'
import { Environment, getEnvironment } from './utils/environment.js'
import { logger } from './logger.js'

function addToolsToServer(options: {
  server: McpServer
  sandboxEnabled: boolean
  apiClient: DwsApiClient
  extractionApiClient?: DwsApiClient
}) {
  const { server, sandboxEnabled, apiClient, extractionApiClient } = options

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

For structured data extraction (typed JSON or Markdown with bounding boxes and confidence scores), use the dedicated data_extractor tool instead.`,
    BuildAPIArgsSchema.shape,
    {
      title: 'Nutrient Document Processor',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ instructions, outputPath }) => {
      try {
        return await performBuildCall(instructions, outputPath, apiClient)
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
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
    async ({ filePath, signatureOptions, watermarkImagePath, graphicImagePath, outputPath }) => {
      try {
        return await performSignCall(
          filePath,
          outputPath,
          apiClient,
          signatureOptions,
          watermarkImagePath,
          graphicImagePath,
        )
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
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
    async ({ filePath, criteria, outputPath, stage, apply }) => {
      try {
        return await performAiRedactCall(filePath, criteria, outputPath, apiClient, stage, apply)
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
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
    async () => {
      try {
        return await performCheckCreditsCall(apiClient)
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  )

  server.tool(
    'data_extractor',
    `Extract structured data from a document using the Nutrient DWS Data Extraction API. Reads the input file from the local file system or sandbox (if enabled).

Output formats:
• spatial — typed elements (paragraphs, tables, key-value pairs, formulas, pictures, handwriting) with bounding boxes, confidence scores, and reading order. Written to outputPath (the list can be large); retrieve slices with the query_extraction tool.
• markdown — whole-document Markdown, returned inline. Good for RAG and search indexing.

Processing modes (cost per page): text = fast Markdown, no OCR (1 credit); structure = OCR spatial (1.5 credits); understand = AI-augmented, default (9 credits); agentic = VLM-augmented (18 credits).

Note: markdown output and any extracted content are returned into this conversation and may be logged by the host. For sensitive documents, prefer spatial output to a file plus scoped query_extraction calls.`,
    DataExtractorArgsSchema.shape,
    {
      title: 'Nutrient Data Extractor',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async (args) => {
      try {
        return await performExtractCall(args, extractionApiClient)
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  )

  server.tool(
    'query_extraction',
    `Query a spatial extraction file previously produced by data_extractor and return the matching elements inline. Reads the file from the local file system or sandbox (if enabled); does not call the Nutrient API.

Filter by any combination of:
• pages — 0-based page indices
• region — a bounding box {x, y, width, height} in render-space pixels (top-left origin); returns elements whose bounds intersect it
• minConfidence — only elements at or above this confidence (0-1)
• elementTypes — paragraph, table, formula, picture, keyValueRegion, handwriting

Use this to pull just the elements you need (e.g. low-confidence fields, or everything in a table region) instead of loading the whole extraction. Returned elements include their text and coordinates, which enter this conversation.`,
    QueryExtractionArgsSchema.shape,
    {
      title: 'Nutrient Extraction Query',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async (args) => {
      try {
        return await performQueryCall(args)
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
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
      async () => performDirectoryTreeCall('.'),
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
      async ({ path }) => performDirectoryTreeCall(path),
    )
  }
}

export function createMcpServer(options: {
  sandboxEnabled: boolean
  apiClient: DwsApiClient
  extractionApiClient?: DwsApiClient
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
    extractionApiClient: options.extractionApiClient,
  })

  return server
}

/**
 * Builds the Data Extraction API client when NUTRIENT_EXTRACTION_API_KEY is set.
 * Returns undefined otherwise, in which case data_extractor reports a clear
 * "set NUTRIENT_EXTRACTION_API_KEY" error when invoked.
 */
function createExtractionApiClient(environment: Environment): DwsApiClient | undefined {
  if (!environment.extractionApiKey) {
    return undefined
  }

  return createApiClient({
    apiKey: environment.extractionApiKey,
    baseUrl: environment.dwsApiBaseUrl,
  })
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

function buildOAuthConfig(environment: Environment): NutrientOAuthConfig {
  return {
    authorizeUrl: `${environment.authServerUrl}/oauth/authorize`,
    tokenUrl: `${environment.authServerUrl}/oauth/token`,
    registrationUrl: `${environment.authServerUrl}/oauth/register`,
    clientId: environment.clientId,
    scopes: ['mcp:invoke', 'offline_access'],
    resource: environment.dwsApiBaseUrl,
  }
}

function createStdioApiClient(environment: Environment): DwsApiClient {
  if (environment.nutrientApiKey) {
    return createApiClient({
      apiKey: environment.nutrientApiKey,
      baseUrl: environment.dwsApiBaseUrl,
    })
  }

  const oauthConfig = buildOAuthConfig(environment)

  return createApiClient({
    tokenResolver: () => getToken(oauthConfig),
    onTokenRejected: () => invalidateCachedToken(oauthConfig),
    baseUrl: environment.dwsApiBaseUrl,
  })
}

type RunServerResult = {
  close: () => Promise<void>
}

export async function runServer(environment: Environment): Promise<RunServerResult> {
  const { sandboxDir } = await parseCommandLineArgs()

  await prepareSandbox(sandboxDir)

  const sandboxEnabled = sandboxDir !== null

  logger.info('Starting stdio transport', {
    version: getVersion(),
    authMethod: environment.nutrientApiKey ? 'api-key' : 'oauth-browser-flow',
    sandboxEnabled,
    dwsApiBaseUrl: environment.dwsApiBaseUrl,
  })

  const apiClient = createStdioApiClient(environment)
  const extractionApiClient = createExtractionApiClient(environment)

  const server = createMcpServer({
    sandboxEnabled,
    apiClient,
    extractionApiClient,
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)

  logger.info('stdio transport connected')

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

if (isMainModule()) {
  let activeServer: RunServerResult | undefined

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
