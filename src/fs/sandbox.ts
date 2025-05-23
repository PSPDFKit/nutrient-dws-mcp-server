import fs from 'fs'
import path from 'path'

let sandboxDirectory: string | null = null

/**
 * Sets the sandbox directory for file operations
 * @param directory The directory to use as a sandbox
 */
export function setSandboxDirectory(directory: string | null = null) {
  if (!directory) {
    sandboxDirectory = null
    return
  }

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true })
  }

  sandboxDirectory = path.resolve(directory)
}

function isInsideSandboxDirectory(filePath: string) {
  if (!sandboxDirectory) {
    throw new Error('Sandbox directory not set')
  }
  const relativePath = path.relative(sandboxDirectory, filePath)
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function resolveFilePath(filePath: string): string {
  if (sandboxDirectory) {
    // If the path is absolute and already starts with the sandbox directory, use it as is
    // Otherwise, treat paths as relative to sandbox if sandbox is enabled
    const isAbsolutePath = path.isAbsolute(filePath)
    const absolutePath =
      isAbsolutePath && isInsideSandboxDirectory(filePath)
        ? path.resolve(filePath)
        : path.resolve(path.join(sandboxDirectory, filePath))

    if (!isInsideSandboxDirectory(absolutePath)) {
      throw new Error(
        `Invalid Path: ${filePath}. You may only access files within the sandbox directory, please use relative paths.`,
      )
    }
    return absolutePath
  } else {
    if (!path.isAbsolute(filePath)) {
      throw new Error(
        `Invalid Path: ${filePath}. Absolute paths are required when sandbox is not enabled. Use / (MacOS/Linux) or C:\\ (Windows) to start from the root directory.`,
      )
    }
    return path.resolve(filePath)
  }
}

/**
 * Resolves the absolute file path for a given file and ensures it exists within the specified sandbox directory
 * (if applicable). Throws an error if the file does not exist.
 *
 * @param {string} filePath - The relative or absolute path to the file to resolve.
 * @return {string} The resolved absolute file path.
 */
export function resolveSandboxFilePath(filePath: string): string {
  const absolutePath = resolveFilePath(filePath)

  if (!fs.existsSync(absolutePath)) {
    if (sandboxDirectory) {
      throw new Error(
        `Path not found in sandbox: ${filePath}. Please make sure the file exists in the sandbox directory: ${sandboxDirectory}.`,
      )
    }
    throw new Error(`Path not found: ${absolutePath}`)
  }

  return absolutePath
}

/**
 * Resolves and returns the output file path based on the provided file path.
 *
 * @param {string} filePath - The input file path to be resolved.
 * @return {string} The resolved output file path.
 */
export function resolveOutputFilePath(filePath: string): string {
  return resolveFilePath(filePath)
}
