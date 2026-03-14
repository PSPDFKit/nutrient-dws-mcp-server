import fs from 'fs'
import path from 'path'
import { createErrorResponse, createSuccessResponse } from '../responses.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { getSandboxFilesystemEpoch, isSandboxEnabled, isValidatedReadablePath, resolveReadDirectoryPath } from './sandbox.js'

/**
 * Tree entry interface for directory structure
 */
interface TreeEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeEntry[]
}

const directoryTreeResponseCache = new Map<string, string>()

/**
 * Performs a directory tree operation to list files and directories
 */
export async function performDirectoryTreeCall(directoryPath: string): Promise<CallToolResult> {
  try {
    const validPath = await resolveReadDirectoryPath(directoryPath)

    if (isSandboxEnabled()) {
      const cacheKey = `${getSandboxFilesystemEpoch()}:${validPath}`
      const cachedResponse = directoryTreeResponseCache.get(cacheKey)
      if (cachedResponse) {
        return createSuccessResponse(cachedResponse)
      }

      const treeData = await buildDirectoryTree('root', validPath)
      if (treeData) {
        const responseText = JSON.stringify(treeData.children, null, 2)
        if (directoryTreeResponseCache.size >= 64) {
          directoryTreeResponseCache.clear()
        }
        directoryTreeResponseCache.set(cacheKey, responseText)
        return createSuccessResponse(responseText)
      } else {
        return createErrorResponse(
          `Cannot read the directory tree, make sure to allow this application access to ${validPath}`,
        )
      }
    }

    const treeData = await buildDirectoryTree('root', validPath)
    if (treeData) {
      return createSuccessResponse(JSON.stringify(treeData.children, null, 2))
    } else {
      return createErrorResponse(
        `Cannot read the directory tree, make sure to allow this application access to ${validPath}`,
      )
    }
  } catch (error) {
    return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Builds a tree structure of the directory
 */
async function buildDirectoryTree(name: string, directoryPath: string): Promise<TreeEntry | null> {
  try {
    const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true })
    const promises = entries.map(async (entry) => {
      let entryData: TreeEntry | null
      const subPath = `${entry.parentPath}${path.sep}${entry.name}`
      if (entry.isDirectory()) {
        entryData = await buildDirectoryTree(entry.name, subPath)
      } else if (entry.isFile()) {
        try {
          if (!isValidatedReadablePath(subPath)) {
            const fd = await fs.promises.open(subPath, 'r')
            await fd.close()
          }

          entryData = {
            name: entry.name,
            path: subPath,
            type: 'file',
          }
        } catch {
          // If the file is not readable, it should be included in the tree
          entryData = null
        }
      } else {
        // If the item is not a file or a directory, it should not be included in the tree
        entryData = null
      }
      return entryData
    })

    // Run the build Tree node for all the children concurrently
    const results = await Promise.all(promises)

    return {
      name: name,
      path: directoryPath,
      type: 'directory',
      children: results.filter((res) => res !== null),
    }
  } catch {
    // This is for the case where the folder doesn't allow us to list it's content
    return null
  }
}
