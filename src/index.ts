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
  DirectoryTreeArgsSchema,
  SignAPIArgsSchema,
} from './schemas.js'
import { performBuildCall } from './dws/build.js'
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
import { getToken, type NutrientOAuthConfig } from './auth/nutrient-oauth.js'
import { Environment, getEnvironment } from './utils/environment.js'
import { logger } from './logger.js'

function addToolsToServer(options: {
  server: McpServer
  sandboxEnabled: boolean
  apiClient: DwsApiClient
}) {
  const { server, sandboxEnabled, apiClient } = options

  server.tool(
    'document_processor',
    `Processes documents using Nutrient DWS Processor API. Reads from and writes to file system or sandbox (if enabled).

Features:
• Import XFDF annotations
• Flatten annotations
• OCR processing
• Page rotation
• Watermarking (text/image)
• Redaction creation and application

Output formats: PDF, PDF/A, images (PNG, JPEG, WebP), JSON extraction, Office (DOCX, XLSX, PPTX)`,
    BuildAPIArgsSchema.shape,
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
    `Digitally signs PDF files using Nutrient DWS Sign API. Reads from and writes to file system or sandbox (if enabled).

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
    `AI-powered document redaction using Nutrient DWS AI Redaction API. Reads from and writes to file system or sandbox (if enabled).

Automatically detects and permanently removes sensitive information from documents using AI analysis.
Detected content types include:
• Personally identifiable information (names, addresses, phone numbers)
• Financial data (credit card numbers, bank accounts, SSNs)
• Email addresses and URLs
• Protected health information (PHI)
• Any custom criteria you specify

By default (when neither stage nor apply is set), redactions are detected and immediately applied. Set stage to true to detect and stage redactions without applying them. Set apply to true to apply previously staged redactions.`,
    AiRedactArgsSchema.shape,
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

Returns: subscription type, total credits, used credits, and remaining credits.`,
    CheckCreditsArgsSchema.shape,
    async () => {
      try {
        return await performCheckCreditsCall(apiClient)
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  )

  if (sandboxEnabled) {
    server.tool(
      'sandbox_file_tree',
      'Returns the file tree of the sandbox directory. It will recurse into subdirectories and return a list of files and directories.',
      {},
      async () => performDirectoryTreeCall('.'),
    )
  } else {
    server.tool(
      'directory_tree',
      'Returns the directory tree of a given path. All paths are resolved relative to root directory.',
      DirectoryTreeArgsSchema.shape,
      async ({ path }) => performDirectoryTreeCall(path),
    )
  }
}

function createMcpServer(options: { sandboxEnabled: boolean; apiClient: DwsApiClient }) {
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
  })

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

function createStdioApiClient(environment: Environment): DwsApiClient {
  if (environment.nutrientApiKey) {
    return createApiClient({
      apiKey: environment.nutrientApiKey,
      baseUrl: environment.dwsApiBaseUrl,
    })
  }

  const oauthConfig: NutrientOAuthConfig = {
    authorizeUrl: `${environment.authServerUrl}/oauth/authorize`,
    tokenUrl: `${environment.authServerUrl}/oauth/token`,
    registrationUrl: `${environment.authServerUrl}/oauth/register`,
    clientId: environment.clientId,
    scopes: ['mcp:invoke', 'offline_access'],
    resource: environment.dwsApiBaseUrl,
  }

  return createApiClient({
    tokenResolver: () => getToken(oauthConfig),
    baseUrl: environment.dwsApiBaseUrl,
  })
}

type RunServerResult = {
  close: () => Promise<void>
}

export async function runServer(): Promise<RunServerResult> {
  let environment: Environment
  try {
    environment = getEnvironment()
  } catch (e) {
    throw new Error(`Invalid environment configuration: ${e instanceof Error ? e.message : e}`)
  }
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

  // Authenticate eagerly before accepting tool calls — in stdio mode there's
  // no transport-level mechanism to pause while waiting for browser auth
  if (!environment.nutrientApiKey) {
    logger.info('No API key set, authenticating via OAuth before accepting connections...')
    const oauthConfig: NutrientOAuthConfig = {
      authorizeUrl: `${environment.authServerUrl}/oauth/authorize`,
      tokenUrl: `${environment.authServerUrl}/oauth/token`,
      registrationUrl: `${environment.authServerUrl}/oauth/register`,
      clientId: environment.clientId,
      scopes: ['mcp:invoke', 'offline_access'],
      resource: environment.dwsApiBaseUrl,
    }
    await getToken(oauthConfig)
    logger.info('OAuth authentication completed')
  }

  const server = createMcpServer({
    sandboxEnabled,
    apiClient,
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

  runServer()
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
