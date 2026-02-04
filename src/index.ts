#!/usr/bin/env node

/**
 * Nutrient DWS API MCP Server
 *
 * This server provides a Model Context Protocol (MCP) interface to the Nutrient DWS Processor API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AiRedactArgsSchema, BuildAPIArgsSchema, CheckCreditsArgsSchema, DirectoryTreeArgsSchema, SignAPIArgsSchema } from './schemas.js'
import { getBalanceResult, getUsageSummaryAgg, getForecast, type Period } from './credits/index.js'
import { performBuildCall } from './dws/build.js'
import { performSignCall } from './dws/sign.js'
import { performAiRedactCall } from './dws/ai-redact.js'
import { performDirectoryTreeCall } from './fs/directoryTree.js'
import { setSandboxDirectory } from './fs/sandbox.js'
import { createErrorResponse } from './responses.js'
import { getVersion } from './version.js'
import { parseSandboxPath } from './utils/sandbox.js'

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

function addToolsToServer(server: McpServer, sandboxEnabled: boolean = false) {
  server.tool(
    'document_processor',
    `Processes documents using Nutrient DWS Processor API. Reads from and writes to file system or sandbox (if enabled).

Features:
• Import XFDF annotations
• Apply Instant JSON (form filling, form creation, annotation import)
• Flatten annotations
• OCR processing
• Page rotation
• Watermarking (text/image, with positioning control)
• Redaction creation and application (pattern-based: preset, regex, or text)
• HTML-to-PDF with page layout options (orientation, size, margins)

Output formats: PDF, PDF/A, PDF/UA, images (PNG, JPEG, WebP), JSON extraction, Office (DOCX, XLSX, PPTX), HTML, Markdown`,
    BuildAPIArgsSchema.shape,
    async ({ instructions, outputPath }) => {
      try {
        return performBuildCall(instructions, outputPath)
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
        return performSignCall(filePath, outputPath, signatureOptions, watermarkImagePath, graphicImagePath)
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

Important: This operation typically takes 60-120 seconds due to AI analysis.
The redaction is permanent and irreversible — the original content is completely removed from the PDF.`,
    AiRedactArgsSchema.shape,
    async ({ filePath, criteria, outputPath }) => {
      try {
        return performAiRedactCall(filePath, criteria, outputPath)
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  )

  server.tool(
    'check_credits',
    `Check Nutrient DWS API credit balance, usage, and forecasts.

Actions:
• balance — Returns remaining credits, daily usage rate, and projected days until exhaustion
• usage — Returns credit consumption breakdown by operation type (OCR, signing, redaction, etc.)
• forecast — Returns projected credit exhaustion date with confidence level

Usage data is collected automatically from API response headers. The first call after server start
may show limited data until more operations are logged.`,
    CheckCreditsArgsSchema.shape,
    async ({ action, period }) => {
      try {
        if (action === 'balance') {
          const result = getBalanceResult();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                remaining: result.remaining,
                asOf: result.asOf,
                usedToday: result.usedToday,
                usedThisWeek: result.usedThisWeek,
                usedThisMonth: result.usedThisMonth,
                dailyRate: Math.round(result.dailyRate * 100) / 100,
                daysRemaining: result.daysRemaining ? Math.round(result.daysRemaining) : null,
                exhaustionDate: result.exhaustionDate,
                confidence: result.confidence,
              }, null, 2),
            }],
          };
        }

        if (action === 'usage') {
          const summary = getUsageSummaryAgg(period as Period);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                period: summary.period,
                totalCredits: Math.round(summary.totalCredits * 100) / 100,
                totalOperations: summary.totalOperations,
                breakdown: summary.breakdown.map(b => ({
                  operation: b.operation,
                  count: b.count,
                  credits: Math.round(b.credits * 100) / 100,
                  avgCost: Math.round(b.avgCost * 100) / 100,
                })),
              }, null, 2),
            }],
          };
        }

        if (action === 'forecast') {
          const forecast = getForecast();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                dailyAverage: Math.round(forecast.dailyAverage * 100) / 100,
                daysRemaining: forecast.daysRemaining ? Math.round(forecast.daysRemaining) : null,
                exhaustionDate: forecast.exhaustionDate,
                confidence: forecast.confidence,
              }, null, 2),
            }],
          };
        }

        return createErrorResponse(`Unknown action: ${action}`);
      } catch (error) {
        return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`);
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

async function parseCommandLineArgs() {
  const args = process.argv.slice(2)

  try {
    const sandboxDir = parseSandboxPath(args, process.env.SANDBOX_PATH) || null
    return { sandboxDir }
  } catch (error) {
    await server.server.sendLoggingMessage({
      level: 'error',
      data: `Error: ${error instanceof Error ? error.message : String(error)}`,
    })
    process.exit(1)
  }
}

export async function runServer() {
  const { sandboxDir } = await parseCommandLineArgs()

  if (sandboxDir) {
    try {
      await setSandboxDirectory(sandboxDir)
    } catch (error) {
      console.error(`Error setting sandbox directory: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  } else {
    console.warn(
      'Info: No sandbox directory specified. File operations will not be restricted.\n' +
        'Sandboxed mode is recommended - To enable sandboxed mode and restrict file operations, set SANDBOX_PATH environment variable',
    )
  }

  addToolsToServer(server, sandboxDir !== null)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  return server
}

runServer()
  .then(async (server) => {
    server.server.getClientCapabilities()
    await server.server.sendLoggingMessage({
      level: 'info',
      data: `Nutrient DWS MCP Server ${getVersion()} running.`,
    })
  })
  .catch((error) => {
    console.error('Fatal error running server:', error)
    process.exit(1)
  })

process.stdin.on('close', async () => {
  await server.server.sendLoggingMessage({
    level: 'info',
    data: `Nutrient DWS MCP Server ${getVersion()} closed.`,
  })
  await server.close()
})
