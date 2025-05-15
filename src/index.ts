#!/usr/bin/env node

/**
 * Nutrient DWS API MCP Server
 *
 * This server provides a Model Context Protocol (MCP) interface to the Nutrient DWS Processor API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { BuildAPIArgsSchema, DirectoryTreeArgsSchema, SignAPIArgsSchema } from './schemas.js'
import { performBuildCall } from './dws/build.js'
import { performSignCall } from './dws/sign.js'
import { performDirectoryTreeCall } from './fs/directoryTree.js'
import { setSandboxDirectory } from './fs/sandbox.js'
import { createErrorResponse } from './responses.js'
import { getVersion } from './version.js'

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
• Flatten annotations
• OCR processing
• Page rotation
• Watermarking (text/image)
• Redaction creation and application

Output formats: PDF, PDF/A, images (PNG, JPEG, WebP), JSON extraction, Office (DOCX, XLSX, PPTX)`,
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
  let sandboxDir: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sandbox' || args[i] === '-s') {
      if (i + 1 < args.length) {
        sandboxDir = args[i + 1]
        i++ // Skip the next argument as it's the directory path
      } else {
        await server.server.sendLoggingMessage({
          level: 'error',
          data: 'Error: --sandbox flag requires a directory path',
        })
        process.exit(1)
      }
    }
  }

  return { sandboxDir }
}

export async function runServer() {
  const { sandboxDir } = await parseCommandLineArgs()

  if (sandboxDir) {
    try {
      setSandboxDirectory(sandboxDir)
    } catch (error) {
      console.error(`Error setting sandbox directory: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  } else {
    console.warn(
      'Info: No sandbox directory specified. File operations will not be restricted.\n' +
        'Sandboxed mode is recommended - To enable sandboxed mode and restrict file operations, use: --sandbox <directory_path>',
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
