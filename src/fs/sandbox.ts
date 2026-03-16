import fs from 'fs'
import path from 'path'

let sandboxDirectory: string | null = null
let sandboxDirectoryComparisonPath: string | null = null
let sandboxDirectoryComparisonPrefix: string | null = null
let sandboxFilesystemEpoch = 0
let validatedReadableDirectoryInputPaths: Record<string, string | undefined> = Object.create(null)
let activeValidatedReadableDirectoryInputPaths: Record<string, string | undefined> | null = null
let validatedReadableDirectoryInputPathsSize = 0
let validatedReadableInputPathPromises: Record<string, Promise<string> | undefined> = Object.create(null)
let activeValidatedReadableInputPathPromises: Record<string, Promise<string> | undefined> | null = null
let validatedReadableInputPathsSize = 0
const validatedReadablePaths = new Set<string>()
const validatedWritableDirectories = new Set<string>()
let validatedWritableInputPathPromises: Record<string, Promise<string> | undefined> = Object.create(null)
let activeValidatedWritableInputPathPromises: Record<string, Promise<string> | undefined> | null = null
let validatedWritableInputPathsSize = 0
const validatedWritablePaths = new Set<string>()
const resolvedPathCache = new Map<string, string>()

function cacheResolvedPath(pathStr: string, resolvedPath: string) {
  if (resolvedPathCache.size >= 1024) {
    resolvedPathCache.clear()
  }

  resolvedPathCache.set(pathStr, resolvedPath)
  return resolvedPath
}

export function isSandboxEnabled() {
  return sandboxDirectory !== null
}

export function getSandboxFilesystemEpoch() {
  return sandboxFilesystemEpoch
}

export function isValidatedReadablePath(resolvedPath: string) {
  return validatedReadablePaths.has(resolvedPath)
}

function cacheValidatedReadablePath(pathStr: string, resolvedPath: string) {
  if (validatedReadablePaths.size >= 4096) {
    validatedReadablePaths.clear()
  }

  validatedReadablePaths.add(resolvedPath)

  if (validatedReadableInputPathsSize >= 4096) {
    validatedReadableInputPathPromises = Object.create(null)
    activeValidatedReadableInputPathPromises = validatedReadableInputPathPromises
    validatedReadableInputPathsSize = 0
  }

  if (validatedReadableInputPathPromises[pathStr] === undefined) {
    validatedReadableInputPathsSize += 1
  }

  validatedReadableInputPathPromises[pathStr] = Promise.resolve(resolvedPath)
  return resolvedPath
}

function cacheValidatedWritablePath(pathStr: string, resolvedPath: string) {
  if (validatedWritablePaths.size >= 4096) {
    validatedWritablePaths.clear()
  }

  if (validatedWritableInputPathsSize >= 4096) {
    validatedWritableInputPathPromises = Object.create(null)
    activeValidatedWritableInputPathPromises = validatedWritableInputPathPromises
    validatedWritableInputPathsSize = 0
  }

  if (validatedWritableInputPathPromises[pathStr] === undefined) {
    validatedWritableInputPathsSize += 1
  }

  validatedWritablePaths.add(resolvedPath)
  validatedWritableInputPathPromises[pathStr] = Promise.resolve(resolvedPath)
  return resolvedPath
}

function normalizePathForComparison(filePath: string) {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath
}

/**
 * Sets the sandbox directory for file operations
 * @param directory The directory to use as a sandbox
 */
export async function setSandboxDirectory(directory: string | null = null) {
  const previousSandboxDirectory = sandboxDirectory

  if (!directory) {
    sandboxFilesystemEpoch += 1
    validatedReadableDirectoryInputPaths = Object.create(null)
    activeValidatedReadableDirectoryInputPaths = null
    validatedReadableDirectoryInputPathsSize = 0
    validatedReadableInputPathPromises = Object.create(null)
    activeValidatedReadableInputPathPromises = null
    validatedReadableInputPathsSize = 0
    validatedReadablePaths.clear()
    validatedWritableDirectories.clear()
    validatedWritableInputPathPromises = Object.create(null)
    activeValidatedWritableInputPathPromises = null
    validatedWritableInputPathsSize = 0
    validatedWritablePaths.clear()
    resolvedPathCache.clear()
    sandboxDirectory = null
    sandboxDirectoryComparisonPath = null
    sandboxDirectoryComparisonPrefix = null
    return
  }

  const resolvedDirectory = previousSandboxDirectory !== null && directory === previousSandboxDirectory
    ? previousSandboxDirectory
    : path.resolve(directory)
  const sameSandboxDirectory = previousSandboxDirectory === resolvedDirectory

  if (!sameSandboxDirectory) {
    sandboxFilesystemEpoch += 1
    validatedReadableDirectoryInputPaths = Object.create(null)
    activeValidatedReadableDirectoryInputPaths = validatedReadableDirectoryInputPaths
    validatedReadableDirectoryInputPathsSize = 0
    validatedReadableInputPathPromises = Object.create(null)
    activeValidatedReadableInputPathPromises = validatedReadableInputPathPromises
    validatedReadableInputPathsSize = 0
    validatedReadablePaths.clear()
    validatedWritableDirectories.clear()
    validatedWritableInputPathPromises = Object.create(null)
    activeValidatedWritableInputPathPromises = validatedWritableInputPathPromises
    validatedWritableInputPathsSize = 0
    validatedWritablePaths.clear()
    resolvedPathCache.clear()
  }

  try {
    await fs.promises.access(resolvedDirectory)
    await fs.promises.readdir(resolvedDirectory)
  } catch {
    await fs.promises.mkdir(resolvedDirectory, { recursive: true })
  }

  sandboxDirectory = resolvedDirectory
  sandboxDirectoryComparisonPath = normalizePathForComparison(resolvedDirectory)
  sandboxDirectoryComparisonPrefix = sandboxDirectoryComparisonPath.endsWith(path.sep)
    ? sandboxDirectoryComparisonPath
    : `${sandboxDirectoryComparisonPath}${path.sep}`
}

function isInsideSandboxDirectory(filePath: string) {
  if (!sandboxDirectoryComparisonPath || !sandboxDirectoryComparisonPrefix) {
    throw new Error('Sandbox directory not set')
  }

  const normalizedFilePath = normalizePathForComparison(filePath)
  return (
    normalizedFilePath === sandboxDirectoryComparisonPath ||
    normalizedFilePath.startsWith(sandboxDirectoryComparisonPrefix)
  )
}

function resolvePath(pathStr: string): string {
  const cachedResolvedPath = resolvedPathCache.get(pathStr)
  if (cachedResolvedPath) {
    return cachedResolvedPath
  }

  if (sandboxDirectory) {
    if (!path.isAbsolute(pathStr)) {
      const absolutePath = path.resolve(sandboxDirectory, pathStr)
      if (!isInsideSandboxDirectory(absolutePath)) {
        throw new Error(
          `Invalid Path: ${pathStr}. You may only access files within the sandbox directory, please use relative paths.`,
        )
      }
      return cacheResolvedPath(pathStr, absolutePath)
    }

    const absolutePath = path.resolve(pathStr)
    if (isInsideSandboxDirectory(absolutePath)) {
      return cacheResolvedPath(pathStr, absolutePath)
    }

    const sandboxRelativePath = path.relative(path.parse(absolutePath).root, absolutePath)
    const sandboxedAbsolutePath = path.resolve(sandboxDirectory, sandboxRelativePath)

    if (!isInsideSandboxDirectory(sandboxedAbsolutePath)) {
      throw new Error(
        `Invalid Path: ${pathStr}. You may only access files within the sandbox directory, please use relative paths.`,
      )
    }

    return cacheResolvedPath(pathStr, sandboxedAbsolutePath)
  } else {
    if (!path.isAbsolute(pathStr)) {
      throw new Error(
        `Invalid Path: ${pathStr}. Absolute paths are required when sandbox is not enabled. Use / (MacOS/Linux) or C:\\ (Windows) to start from the root directory.`,
      )
    }
    return cacheResolvedPath(pathStr, path.resolve(pathStr))
  }
}

/**
 * Resolve and returns the reading directory path based on the provided directory path.
 *
 * @param {string} dirPath - The reading directory path to be resolved.
 * @return {Promise<string>} The resolved absolute directory path.
 */
export async function resolveReadDirectoryPath(dirPath: string): Promise<string> {
  return activeValidatedReadableDirectoryInputPaths?.[dirPath] || resolveReadDirectoryPathUncached(dirPath)
}

async function resolveReadDirectoryPathUncached(dirPath: string): Promise<string> {
  const resolvedDirPath = resolvePath(dirPath)
  const stats = await fs.promises.stat(resolvedDirPath)
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedDirPath}`)
  }

  if (sandboxDirectory) {
    if (validatedReadableDirectoryInputPathsSize >= 1024) {
      validatedReadableDirectoryInputPaths = Object.create(null)
      activeValidatedReadableDirectoryInputPaths = validatedReadableDirectoryInputPaths
      validatedReadableDirectoryInputPathsSize = 0
    }
    if (validatedReadableDirectoryInputPaths[dirPath] === undefined) {
      validatedReadableDirectoryInputPathsSize += 1
    }
    validatedReadableDirectoryInputPaths[dirPath] = resolvedDirPath
  }

  return resolvedDirPath
}

/**
 * Resolves and returns the reading file path based on the provided file path.
 *
 * @param {string} filePath - The reading file path to be resolved.
 * @return {Promise<string>} The resolved absolute file path.
 */
export function resolveReadFilePath(filePath: string): Promise<string> {
  return validatedReadableInputPathPromises[filePath] ?? resolveReadFilePathUncached(filePath)
}

async function resolveReadFilePathUncached(filePath: string): Promise<string> {
  const resolvedFilePath = resolvePath(filePath)

  if (sandboxDirectory && validatedReadablePaths.has(resolvedFilePath)) {
    return cacheValidatedReadablePath(filePath, resolvedFilePath)
  }

  const [stats] = await Promise.all([fs.promises.stat(resolvedFilePath), fs.promises.access(resolvedFilePath)])
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${resolvedFilePath}`)
  }

  if (sandboxDirectory) {
    return cacheValidatedReadablePath(filePath, resolvedFilePath)
  }

  return resolvedFilePath
}

/**
 * Resolves and returns the writing file path based on the provided file path.
 *
 * @param {string} filePath - The writing file path to be resolved.
 * @return {Promise<string>} The resolved absolute file path.
 */
export function resolveWriteFilePath(filePath: string): Promise<string> {
  return activeValidatedWritableInputPathPromises !== null
    ? activeValidatedWritableInputPathPromises[filePath] ?? resolveWriteFilePathUncached(filePath)
    : resolveWriteFilePathUncached(filePath)
}

async function resolveWriteFilePathUncached(filePath: string): Promise<string> {
  if (sandboxDirectory) {
    sandboxFilesystemEpoch += 1
  }

  const resolvedFilePath = resolvePath(filePath)

  if (validatedWritablePaths.has(resolvedFilePath)) {
    return cacheValidatedWritablePath(filePath, resolvedFilePath)
  }

  try {
    const fd = await fs.promises.open(resolvedFilePath, 'r+')
    await fd.close()
    return cacheValidatedWritablePath(filePath, resolvedFilePath)
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code
    if (errorCode && errorCode !== 'ENOENT') {
      throw error
    }
  }

  const outputDir = path.dirname(resolvedFilePath)

  if (!validatedWritableDirectories.has(outputDir)) {
    try {
      await fs.promises.access(outputDir)
    } catch {
      await fs.promises.mkdir(outputDir, { recursive: true })
      await fs.promises.access(outputDir)
    }

    validatedWritableDirectories.add(outputDir)
  }

  return cacheValidatedWritablePath(filePath, resolvedFilePath)
}
