#!/usr/bin/env node

/**
 * Nutrient DWS API MCP Server
 *
 * This server provides a Model Context Protocol (MCP) interface to the Nutrient DWS Processor API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { setSandboxDirectory } from './fs/sandbox.js'
import { getVersion } from './version.js'
import { parseSandboxPath } from './utils/sandbox.js'
import { toolDefinitions } from './tool-definitions.js'

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

export function addToolsToServer(server: McpServer, sandboxEnabled: boolean = false) {
  // Add primary tools
  const documentProcessor = toolDefinitions.find(t => t.name === 'document_processor')!
  server.tool(documentProcessor.name, documentProcessor.mcpDescription, documentProcessor.schema, documentProcessor.handler)

  const documentSigner = toolDefinitions.find(t => t.name === 'document_signer')!
  server.tool(documentSigner.name, documentSigner.mcpDescription, documentSigner.schema, documentSigner.handler)

  // Add directory tools based on sandbox mode
  if (sandboxEnabled) {
    const sandboxFileTool = toolDefinitions.find(t => t.name === 'sandbox_file_tree')!
    server.tool(sandboxFileTool.name, sandboxFileTool.mcpDescription, sandboxFileTool.schema, sandboxFileTool.handler)
  } else {
    const directoryTool = toolDefinitions.find(t => t.name === 'directory_tree')!
    server.tool(directoryTool.name, directoryTool.mcpDescription, directoryTool.schema, directoryTool.handler)
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
  console.error('test')
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
