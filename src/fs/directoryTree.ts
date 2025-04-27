import fs from 'fs'
import path from 'path'
import { createErrorResponse, createSuccessResponse } from '../responses.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { resolveSandboxFilePath } from './sandbox.js'

/**
 * Tree entry interface for directory structure
 */
interface TreeEntry {
  name: string
  type: 'file' | 'directory'
  children?: TreeEntry[]
}

/**
 * Performs a directory tree operation to list files and directories
 */
export async function performDirectoryTreeCall(directoryPath: string): Promise<CallToolResult> {
  try {
    const validPath = resolveSandboxFilePath(directoryPath)
    const treeData = await buildDirectoryTree(validPath)
    return createSuccessResponse(JSON.stringify(treeData, null, 2))
  } catch (error) {
    return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Builds a tree structure of the directory
 */
async function buildDirectoryTree(directoryPath: string): Promise<TreeEntry[]> {
  const stats = fs.statSync(directoryPath)
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${directoryPath}`)
  }

  const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true })
  const result: TreeEntry[] = []

  for (const entry of entries) {
    const entryData: TreeEntry = {
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }

    if (entry.isDirectory()) {
      const subPath = path.join(directoryPath, entry.name)
      entryData.children = await buildDirectoryTree(subPath)
    }

    result.push(entryData)
  }

  return result
}
