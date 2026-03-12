#!/usr/bin/env node

/**
 * Nutrient DWS API MCP Server
 *
 * Supports stdio and Streamable HTTP MCP transports.
 */

import express, { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
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
import { createAuthMiddleware } from './http/authMiddleware.js'
import { createProtectedResourceHandler } from './http/protectedResource.js'
import { createRequestLoggerMiddleware, isMcpDebugLoggingEnabled } from './http/requestLogger.js'
import { TokenExchangeClient } from './http/tokenExchange.js'
import { getAllowedTools, getPrincipalFingerprint, isToolAllowed, RequestWithAuth } from './http/types.js'
import { Environment, getEnvironment } from './utils/environment.js'

type ServerMode = 'stdio' | 'http'

type HttpSessionContext = {
  server: McpServer
  transport: StreamableHTTPServerTransport
  principalFingerprint: string
}

type RunServerResult = {
  mode: ServerMode
  close: () => Promise<void>
}

function buildPermissionDeniedResponse(toolName: string) {
  return createErrorResponse(`Permission denied: Tool "${toolName}" is not allowed for this token.`)
}

function canInvokeTool(toolName: string, authInfo?: AuthInfo) {
  return isToolAllowed(toolName, authInfo)
}

function addToolsToServer(options: {
  server: McpServer
  sandboxEnabled: boolean
  apiClient: DwsApiClient
  allowedTools?: string[]
}) {
  const { server, sandboxEnabled, apiClient, allowedTools } = options
  const shouldRegisterTool = (toolName: string) => !allowedTools || allowedTools.includes(toolName)

  if (shouldRegisterTool('document_processor')) {
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
        if (!canInvokeTool('document_processor', extra.authInfo)) {
          return buildPermissionDeniedResponse('document_processor')
        }

        try {
          return await performBuildCall(instructions, outputPath, apiClient)
        } catch (error) {
          return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    )
  }

  if (shouldRegisterTool('document_signer')) {
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
        if (!canInvokeTool('document_signer', extra.authInfo)) {
          return buildPermissionDeniedResponse('document_signer')
        }

        try {
          return await performSignCall(
            filePath,
            outputPath,
            signatureOptions,
            watermarkImagePath,
            graphicImagePath,
            apiClient,
          )
        } catch (error) {
          return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    )
  }

  if (shouldRegisterTool('ai_redactor')) {
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
        if (!canInvokeTool('ai_redactor', extra.authInfo)) {
          return buildPermissionDeniedResponse('ai_redactor')
        }

        try {
          return await performAiRedactCall(filePath, criteria, outputPath, stage, apply, apiClient)
        } catch (error) {
          return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    )
  }

  if (shouldRegisterTool('check_credits')) {
    server.tool(
      'check_credits',
      `Check your Nutrient DWS API credit balance and usage for the current billing period.

Returns: subscription type, total credits, used credits, and remaining credits.`,
      CheckCreditsArgsSchema.shape,
      async (_args, extra) => {
        if (!canInvokeTool('check_credits', extra.authInfo)) {
          return buildPermissionDeniedResponse('check_credits')
        }

        try {
          return await performCheckCreditsCall(apiClient)
        } catch (error) {
          return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    )
  }

  if (sandboxEnabled) {
    if (shouldRegisterTool('sandbox_file_tree')) {
      server.tool(
        'sandbox_file_tree',
        'Returns the file tree of the sandbox directory. It will recurse into subdirectories and return a list of files and directories.',
        {},
        async (_args, extra) => {
          if (!canInvokeTool('sandbox_file_tree', extra.authInfo)) {
            return buildPermissionDeniedResponse('sandbox_file_tree')
          }

          return performDirectoryTreeCall('.')
        },
      )
    }
  } else if (shouldRegisterTool('directory_tree')) {
    server.tool(
      'directory_tree',
      'Returns the directory tree of a given path. All paths are resolved relative to root directory.',
      DirectoryTreeArgsSchema.shape,
      async ({ path }, extra) => {
        if (!canInvokeTool('directory_tree', extra.authInfo)) {
          return buildPermissionDeniedResponse('directory_tree')
        }

        return performDirectoryTreeCall(path)
      },
    )
  }
}

function createMcpServer(options: { sandboxEnabled: boolean; apiClient: DwsApiClient; allowedTools?: string[] }) {
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
    allowedTools: options.allowedTools,
  })

  return server
}

function getSessionId(req: Request): string | undefined {
  const headerValue = req.headers['mcp-session-id']

  if (Array.isArray(headerValue)) {
    return headerValue[0]
  }

  return headerValue
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false
  }

  const request = body as { method?: unknown }
  return request.method === 'initialize'
}

function sendJsonRpcError(res: Response, code: number, message: string, id: string | number | null = null) {
  res.status(400).json({
    jsonrpc: '2.0',
    error: {
      code,
      message,
    },
    id,
  })
}

function createSessionApiClient(options: {
  environment: Environment
  authInfo: AuthInfo
  principalFingerprint: string
  tokenExchangeClient?: TokenExchangeClient
}): DwsApiClient {
  const { environment, authInfo, principalFingerprint, tokenExchangeClient } = options

  if (environment.authMode === 'jwt') {
    if (!tokenExchangeClient) {
      throw new Error('Token exchange client is required in JWT mode')
    }

    return createApiClient({
      baseUrl: environment.dwsApiBaseUrl,
      tokenResolver: async () => tokenExchangeClient.getRuntimeToken(principalFingerprint, authInfo.token),
    })
  }

  if (!environment.nutrientApiKey) {
    throw new Error('NUTRIENT_DWS_API_KEY is required in static auth mode')
  }

  return createApiClient({
    apiKey: environment.nutrientApiKey,
    baseUrl: environment.dwsApiBaseUrl,
  })
}

export function createHttpApp(options: { environment: Environment; sandboxEnabled: boolean }) {
  const { environment, sandboxEnabled } = options

  const tokenExchangeClient =
    environment.authMode === 'jwt' && environment.clientId
      ? new TokenExchangeClient({
          authServerUrl: environment.authServerUrl,
          clientId: environment.clientId,
          tokenEndpointAuthMethod: environment.tokenEndpointAuthMethod,
          clientSecret: environment.clientSecret,
          clientAssertionPrivateKey: environment.clientAssertionPrivateKey,
          clientAssertionAlg: environment.clientAssertionAlg,
          clientAssertionKid: environment.clientAssertionKid,
        })
      : undefined

  const sessions = new Map<string, HttpSessionContext>()

  const app = createMcpExpressApp({
    host: environment.host,
    allowedHosts: environment.allowedHosts.length > 0 ? environment.allowedHosts : undefined,
  })

  app.use(express.json({ limit: '25mb' }))

  if (isMcpDebugLoggingEnabled(process.env)) {
    app.use(createRequestLoggerMiddleware())
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: getVersion() })
  })

  app.get(
    '/.well-known/oauth-protected-resource',
    createProtectedResourceHandler({
      resourceUrl: environment.resourceUrl,
      authServerUrl: environment.authServerUrl,
      resourceMetadataUrl: environment.protectedResourceMetadataUrl,
    }),
  )

  const authMiddleware = createAuthMiddleware(environment)

  const handleExistingSessionRequest = async (req: Request, res: Response, parsedBody?: unknown) => {
    const sessionId = getSessionId(req)
    if (!sessionId) {
      res.status(400).send('Missing MCP session ID')
      return
    }

    const sessionContext = sessions.get(sessionId)
    if (!sessionContext) {
      res.status(404).send('Unknown MCP session ID')
      return
    }

    const authInfo = (req as RequestWithAuth).auth
    const principalFingerprint = getPrincipalFingerprint(authInfo)
    if (!principalFingerprint) {
      res.status(401).send('Missing principal fingerprint')
      return
    }

    if (principalFingerprint !== sessionContext.principalFingerprint) {
      res.status(403).send('Session is bound to a different principal')
      return
    }

    await sessionContext.transport.handleRequest(req, res, parsedBody)
  }

  app.post('/mcp', authMiddleware, async (req, res) => {
    try {
      const sessionId = getSessionId(req)

      if (sessionId) {
        await handleExistingSessionRequest(req, res, req.body)
        return
      }

      if (!isInitializeRequest(req.body)) {
        sendJsonRpcError(res, -32000, 'Bad Request: No valid session ID provided', null)
        return
      }

      const authInfo = (req as RequestWithAuth).auth
      const principalFingerprint = getPrincipalFingerprint(authInfo)

      if (!authInfo || !principalFingerprint) {
        res.status(401).send('Missing auth context')
        return
      }

      const allowedTools = getAllowedTools(authInfo)
      const apiClient = createSessionApiClient({
        environment,
        authInfo,
        principalFingerprint,
        tokenExchangeClient,
      })

      const server = createMcpServer({
        sandboxEnabled,
        apiClient,
        allowedTools,
      })

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, {
            server,
            transport,
            principalFingerprint,
          })
        },
        onsessionclosed: async (closedSessionId) => {
          const context = sessions.get(closedSessionId)
          if (context) {
            sessions.delete(closedSessionId)
            await context.server.close().catch(() => {})
          }
        },
      })

      transport.onclose = () => {
        const currentSessionId = transport.sessionId
        if (!currentSessionId) {
          return
        }

        const context = sessions.get(currentSessionId)
        if (!context) {
          return
        }

        sessions.delete(currentSessionId)
        void context.server.close().catch(() => {})
      }

      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error('Error handling MCP POST request:', error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        })
      }
    }
  })

  app.get('/mcp', authMiddleware, async (req, res) => {
    try {
      await handleExistingSessionRequest(req, res)
    } catch (error) {
      console.error('Error handling MCP GET request:', error)
      if (!res.headersSent) {
        res.status(500).send('Internal server error')
      }
    }
  })

  app.delete('/mcp', authMiddleware, async (req, res) => {
    try {
      await handleExistingSessionRequest(req, res)
    } catch (error) {
      console.error('Error handling MCP DELETE request:', error)
      if (!res.headersSent) {
        res.status(500).send('Internal server error')
      }
    }
  })

  const close = async () => {
    const closePromises = [...sessions.values()].map(async (context) => {
      await context.transport.close().catch(() => {})
      await context.server.close().catch(() => {})
    })

    await Promise.all(closePromises)
    sessions.clear()
  }

  return { app, close }
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

async function runStdioServer(options: {
  sandboxEnabled: boolean
  environment: Environment
}): Promise<RunServerResult> {
  const { sandboxEnabled, environment } = options

  if (!environment.nutrientApiKey) {
    throw new Error('NUTRIENT_DWS_API_KEY is required in stdio mode')
  }

  const apiClient = createApiClient({
    apiKey: environment.nutrientApiKey,
    baseUrl: environment.dwsApiBaseUrl,
  })

  const server = createMcpServer({
    sandboxEnabled,
    apiClient,
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)

  await server.server.sendLoggingMessage({
    level: 'info',
    data: `Nutrient DWS MCP Server ${getVersion()} running on stdio transport.`,
  })

  return {
    mode: 'stdio',
    close: async () => {
      await server.close()
    },
  }
}

async function runHttpServer(options: { sandboxEnabled: boolean; environment: Environment }): Promise<RunServerResult> {
  const { sandboxEnabled, environment } = options
  const { app, close: closeSessions } = createHttpApp({ environment, sandboxEnabled })

  const httpServer = app.listen(environment.port, environment.host)

  await new Promise<void>((resolvePromise, rejectPromise) => {
    httpServer.once('listening', () => resolvePromise())
    httpServer.once('error', (error) => rejectPromise(error))
  })

  console.log(
    `Nutrient DWS MCP Server ${getVersion()} running on HTTP transport at http://${environment.host}:${environment.port}/mcp`,
  )

  return {
    mode: 'http',
    close: async () => {
      await closeSessions()
      await new Promise<void>((resolvePromise, rejectPromise) => {
        httpServer.close((error) => {
          if (error) {
            rejectPromise(error)
            return
          }

          resolvePromise()
        })
      })
    },
  }
}

export async function runServer(): Promise<RunServerResult> {
  const environment = getEnvironment()
  const { sandboxDir } = await parseCommandLineArgs()

  await prepareSandbox(sandboxDir)

  const sandboxEnabled = sandboxDir !== null

  if (environment.transportMode === 'http') {
    return runHttpServer({ sandboxEnabled, environment })
  }

  return runStdioServer({ sandboxEnabled, environment })
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
    if (activeServer?.mode === 'stdio') {
      await activeServer.close().catch(() => {})
    }
  })
}
