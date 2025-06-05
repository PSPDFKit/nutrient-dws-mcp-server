import fs from 'fs'
import path from 'path'

let sandboxDirectory: string | null = null

/**
 * Sets the sandbox directory for file operations
 * @param directory The directory to use as a sandbox
 */
export async function setSandboxDirectory(directory: string | null = null) {
  if (!directory) {
    sandboxDirectory = null
    return
  }

  const resolvedDirectory = path.resolve(directory)

  try {
    await fs.promises.access(resolvedDirectory)
    await fs.promises.readdir(resolvedDirectory);
  } catch {
    await fs.promises.mkdir(resolvedDirectory, { recursive: true })
  }

  sandboxDirectory = resolvedDirectory;
}

function isInsideSandboxDirectory(filePath: string) {
  if (!sandboxDirectory) {
    throw new Error('Sandbox directory not set')
  }
  const relativePath = path.relative(sandboxDirectory, filePath)
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function resolvePath(pathStr: string): string {
  if (sandboxDirectory) {
    // If the path is absolute and already starts with the sandbox directory, use it as is
    // Otherwise, treat paths as relative to sandbox if sandbox is enabled
    const isAbsolutePath = path.isAbsolute(pathStr)
    const absolutePath =
      isAbsolutePath && isInsideSandboxDirectory(pathStr)
        ? path.resolve(pathStr)
        : path.resolve(path.join(sandboxDirectory, pathStr))

    if (!isInsideSandboxDirectory(absolutePath)) {
      throw new Error(
        `Invalid Path: ${pathStr}. You may only access files within the sandbox directory, please use relative paths.`,
      )
    }
    return absolutePath
  } else {
    if (!path.isAbsolute(pathStr)) {
      throw new Error(
        `Invalid Path: ${pathStr}. Absolute paths are required when sandbox is not enabled. Use / (MacOS/Linux) or C:\\ (Windows) to start from the root directory.`,
      )
    }
    return path.resolve(pathStr)
  }
}

/**
 * Resolve and returns the reading directory path based on the provided directory path.
 *
 * @param {string} dirPath - The reading directory path to be resolved.
 * @return {Promise<string>} The resolved absolute directory path.
 */
export async function resolveReadDirectoryPath(dirPath: string): Promise<string> {
  const resolvedDirPath = resolvePath(dirPath)
  const stats = await fs.promises.stat(resolvedDirPath)
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedDirPath}`)
  }
  return resolvedDirPath;
}

/**
 * Resolves and returns the reading file path based on the provided file path.
 *
 * @param {string} filePath - The reading file path to be resolved.
 * @return {Promise<string>} The resolved absolute file path.
 */
export async function resolveReadFilePath(filePath: string): Promise<string> {
  const resolvedFilePath = resolvePath(filePath)
  await fs.promises.access(resolvedFilePath)
  const stats = await fs.promises.stat(resolvedFilePath)
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${resolvedFilePath}`)
  }
  return resolvedFilePath;
}

/**
 * Resolves and returns the writing file path based on the provided file path.
 *
 * @param {string} filePath - The writing file path to be resolved.
 * @return {Promise<string>} The resolved absolute file path.
 */
export async function resolveWriteFilePath(filePath: string): Promise<string> {
  const resolvedFilePath = resolvePath(filePath)
  try {
    await fs.promises.access(resolvedFilePath)
    const fd = await fs.promises.open(resolvedFilePath, 'r+');
    await fd.close();
  } catch {
    const outputDir = path.dirname(resolvedFilePath)
    let createdFolderPath: string | undefined;
    try {
      await fs.promises.access(outputDir)
    } catch {
      createdFolderPath = await fs.promises.mkdir(outputDir, { recursive: true })
    }
    await fs.promises.writeFile(resolvedFilePath, 'test');
    if (createdFolderPath) {
      await fs.promises.rm(createdFolderPath, {recursive: true})
    } else {
      await fs.promises.unlink(resolvedFilePath);
    }
  }
  return resolvedFilePath;
}
