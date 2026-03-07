#!/usr/bin/env node

/**
 * Nutrient DWS API MCP Server
 *
 * This server provides a Model Context Protocol (MCP) interface to the Nutrient DWS Processor API.
 */

import type { Server as HttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Express, Request, Response } from 'express'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
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
import { createBearerAuthMiddleware, getAllowedTools, getPrincipalFingerprint, isToolAllowed, type AuthenticatedRequest } from './http/bearerAuth.js'
import { createErrorResponse } from './responses.js'
import { getEnvironment, type ParsedEnvironment } from './utils/environment.js'
import { getVersion } from './version.js'
import { parseSandboxPath } from './utils/sandbox.js'

type AllowedToolSet = ReadonlySet<string> | undefined

interface HttpSessionContext {
  principalFingerprint?: string
  server: McpServer
  transport: StreamableHTTPServerTransport
}

export interface HttpAppContext {
  app: Express
  close: () => Promise<void>
}

interface RuntimeOptions {
  env?: ParsedEnvironment
  sandboxDir?: string | null
}

function createServerInfo() {
  return {
    name: 'nutrient-dws-mcp-server',
    version: getVersion(),
  }
}

function shouldRegisterTool(toolName: string, allowedTools: AllowedToolSet): boolean {
  return allowedTools?.has(toolName) ?? true
}

function toolErrorMessage(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`
}

function unauthorizedTool(toolName: string) {
  return createErrorResponse(`Tool "${toolName}" is not permitted for this principal.`)
}

function createAllowedToolSet(allowedTools?: readonly string[]): AllowedToolSet {
  if (!allowedTools || allowedTools.length === 0) {
    return undefined
  }

  return new Set(allowedTools)
}

function addToolsToServer(server: McpServer, sandboxEnabled: boolean, allowedTools?: readonly string[]) {
  const allowedToolSet = createAllowedToolSet(allowedTools)

  if (shouldRegisterTool('document_processor', allowedToolSet)) {
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
      async ({ instructions, outputPath }, extra) => {
        if (!isToolAllowed('document_processor', extra.authInfo)) {
          return unauthorizedTool('document_processor')
        }

        try {
          return await performBuildCall(instructions, outputPath)
        } catch (error) {
          return createErrorResponse(toolErrorMessage(error))
        }
      },
    )
  }

  if (shouldRegisterTool('document_signer', allowedToolSet)) {
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
      async ({ filePath, signatureOptions, watermarkImagePath, graphicImagePath, outputPath }, extra) => {
        if (!isToolAllowed('document_signer', extra.authInfo)) {
          return unauthorizedTool('document_signer')
        }

        try {
          return await performSignCall(filePath, outputPath, signatureOptions, watermarkImagePath, graphicImagePath)
        } catch (error) {
          return createErrorResponse(toolErrorMessage(error))
        }
      },
    )
  }

  if (shouldRegisterTool('ai_redactor', allowedToolSet)) {
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
      async ({ filePath, criteria, outputPath, stage, apply }, extra) => {
        if (!isToolAllowed('ai_redactor', extra.authInfo)) {
          return unauthorizedTool('ai_redactor')
        }

        try {
          return await performAiRedactCall(filePath, criteria, outputPath, stage, apply)
        } catch (error) {
          return createErrorResponse(toolErrorMessage(error))
        }
      },
    )
  }

  if (shouldRegisterTool('check_credits', allowedToolSet)) {
    server.tool(
      'check_credits',
      `Check your Nutrient DWS API credit balance and usage for the current billing period.

Returns: subscription type, total credits, used credits, and remaining credits.`,
      CheckCreditsArgsSchema.shape,
      async (_args, extra) => {
        if (!isToolAllowed('check_credits', extra.authInfo)) {
          return unauthorizedTool('check_credits')
        }

        try {
          return await performCheckCreditsCall()
        } catch (error) {
          return createErrorResponse(toolErrorMessage(error))
        }
      },
    )
  }

  if (sandboxEnabled) {
    if (shouldRegisterTool('sandbox_file_tree', allowedToolSet)) {
      server.tool(
        'sandbox_file_tree',
        'Returns the file tree of the sandbox directory. It will recurse into subdirectories and return a list of files and directories.',
        {},
        async (_args, extra) => {
          if (!isToolAllowed('sandbox_file_tree', extra.authInfo)) {
            return unauthorizedTool('sandbox_file_tree')
          }

          return performDirectoryTreeCall('.')
        },
      )
    }
  } else if (shouldRegisterTool('directory_tree', allowedToolSet)) {
    server.tool(
      'directory_tree',
      'Returns the directory tree of a given path. All paths are resolved relative to root directory.',
      DirectoryTreeArgsSchema.shape,
      async ({ path }, extra) => {
        if (!isToolAllowed('directory_tree', extra.authInfo)) {
          return unauthorizedTool('directory_tree')
        }

        return performDirectoryTreeCall(path)
      },
    )
  }
}

export function createMcpServer(options: { sandboxEnabled?: boolean; allowedTools?: readonly string[] } = {}) {
  const { sandboxEnabled = false, allowedTools } = options

  const server = new McpServer(createServerInfo(), {
    capabilities: {
      tools: {},
      logging: {},
    },
  })

  addToolsToServer(server, sandboxEnabled, allowedTools)
  return server
}

function parseCommandLineArgs() {
  const args = process.argv.slice(2)
  return {
    sandboxDir: parseSandboxPath(args, process.env.SANDBOX_PATH) || null,
  }
}

async function configureSandbox(sandboxDir: string | null) {
  if (!sandboxDir) {
    console.warn(
      'Info: No sandbox directory specified. File operations will not be restricted.\n' +
        'Sandboxed mode is recommended - To enable sandboxed mode and restrict file operations, set SANDBOX_PATH environment variable',
    )
    return
  }

  await setSandboxDirectory(sandboxDir)
}

function getSessionId(headerValue: string | string[] | undefined): string | undefined {
  if (Array.isArray(headerValue)) {
    return headerValue[0]
  }

  return headerValue
}

function sendJsonRpcError(res: Response, statusCode: number, code: number, message: string) {
  res.status(statusCode).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  })
}

function sendHttpError(res: Response, statusCode: number, message: string) {
  res.status(statusCode).json({ error: message })
}

function samePrincipal(session: HttpSessionContext, authInfo?: AuthInfo): boolean {
  const sessionFingerprint = session.principalFingerprint
  const requestFingerprint = getPrincipalFingerprint(authInfo)

  if (!sessionFingerprint || !requestFingerprint) {
    return sessionFingerprint === requestFingerprint
  }

  return sessionFingerprint === requestFingerprint
}

function resolveSession(
  req: AuthenticatedRequest,
  res: Response,
  sessions: Map<string, HttpSessionContext>,
): HttpSessionContext | undefined {
  const sessionId = getSessionId(req.headers['mcp-session-id'])

  if (!sessionId) {
    sendHttpError(res, 400, 'Missing mcp-session-id header.')
    return undefined
  }

  const session = sessions.get(sessionId)

  if (!session) {
    sendHttpError(res, 404, 'Unknown MCP session.')
    return undefined
  }

  if (!samePrincipal(session, req.auth)) {
    sendHttpError(res, 403, 'Session belongs to a different principal.')
    return undefined
  }

  return session
}

export function createHttpApp(options: RuntimeOptions = {}): HttpAppContext {
  const env = options.env ?? getEnvironment()
  const sandboxEnabled = options.sandboxDir !== null && options.sandboxDir !== undefined
  const app = createMcpExpressApp({
    host: env.MCP_HOST,
    allowedHosts: env.MCP_ALLOWED_HOSTS.length > 0 ? env.MCP_ALLOWED_HOSTS : undefined,
  })

  const sessions = new Map<string, HttpSessionContext>()

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      name: createServerInfo().name,
      version: getVersion(),
      transport: 'http',
      sandboxEnabled,
    })
  })

  app.use('/mcp', createBearerAuthMiddleware(env.AUTH_PRINCIPALS))

  app.post('/mcp', async (req: Request, res: Response) => {
    const authenticatedRequest = req as AuthenticatedRequest

    try {
      const sessionId = getSessionId(authenticatedRequest.headers['mcp-session-id'])

      if (sessionId) {
        const session = resolveSession(authenticatedRequest, res, sessions)

        if (!session) {
          return
        }

        await session.transport.handleRequest(authenticatedRequest, res, authenticatedRequest.body)
        return
      }

      if (!isInitializeRequest(authenticatedRequest.body)) {
        sendJsonRpcError(res, 400, -32000, 'Bad Request: initialize is required when no session is provided.')
        return
      }

      const allowedTools = getAllowedTools(authenticatedRequest.auth)
      const server = createMcpServer({ sandboxEnabled, allowedTools })
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: initializedSessionId => {
          sessions.set(initializedSessionId, {
            principalFingerprint: getPrincipalFingerprint(authenticatedRequest.auth),
            server,
            transport,
          })
        },
      })

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId)
        }
      }

      await server.connect(transport)
      await transport.handleRequest(authenticatedRequest, res, authenticatedRequest.body)
    } catch (error) {
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, `Internal server error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  })

  const handleSessionRequest = async (req: Request, res: Response) => {
    const authenticatedRequest = req as AuthenticatedRequest
    const session = resolveSession(authenticatedRequest, res, sessions)

    if (!session) {
      return
    }

    await session.transport.handleRequest(authenticatedRequest, res)
  }

  app.get('/mcp', handleSessionRequest)
  app.delete('/mcp', handleSessionRequest)

  return {
    app,
    close: async () => {
      const sessionServers = [...new Set([...sessions.values()].map(session => session.server))]
      sessions.clear()
      await Promise.all(sessionServers.map(server => server.close().catch(() => undefined)))
    },
  }
}

export async function startStdioServer(options: RuntimeOptions = {}) {
  const sandboxEnabled = options.sandboxDir !== null && options.sandboxDir !== undefined
  const server = createMcpServer({ sandboxEnabled })
  const transport = new StdioServerTransport()

  process.once('SIGINT', async () => {
    await server.close()
    process.exit(0)
  })

  process.stdin.once('close', async () => {
    await server.close()
  })

  await server.connect(transport)
  await server.server.sendLoggingMessage({
    level: 'info',
    data: `Nutrient DWS MCP Server ${getVersion()} running.`,
  })

  return server
}

export async function startHttpServer(options: RuntimeOptions = {}) {
  const env = options.env ?? getEnvironment()
  const { app, close } = createHttpApp({ ...options, env })

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const listener = app
      .listen(env.PORT, env.MCP_HOST, () => resolve(listener))
      .on('error', reject)
  })

  const shutdown = async () => {
    await close()
    await new Promise<void>((resolve, reject) => {
      httpServer.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  process.once('SIGINT', async () => {
    await shutdown()
    process.exit(0)
  })

  console.info(`Nutrient DWS MCP Server ${getVersion()} running on HTTP at http://${env.MCP_HOST}:${env.PORT}/mcp`)

  return { app, httpServer, close: shutdown }
}

export async function runServer(options: RuntimeOptions = {}) {
  const env = options.env ?? getEnvironment()
  const runtimeOptions = { ...options, env }

  await configureSandbox(runtimeOptions.sandboxDir ?? null)

  if (env.MCP_TRANSPORT === 'http') {
    return startHttpServer(runtimeOptions)
  }

  return startStdioServer(runtimeOptions)
}

async function main() {
  const { sandboxDir } = parseCommandLineArgs()
  await runServer({ sandboxDir })
}

const entrypointPath = process.argv[1] ? resolve(process.argv[1]) : null

if (entrypointPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Fatal error running server:', error)
    process.exit(1)
  })
}
