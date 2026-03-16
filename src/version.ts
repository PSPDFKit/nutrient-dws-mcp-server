import fs, { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

let cachedVersion: string | undefined

/**
 * Reliably gets the package.json contents even when the package is published
 */
export function getVersion(): string {
  if (cachedVersion !== undefined) {
    return cachedVersion
  }

  try {
    // Start from the current file's directory
    let currentDir = dirname(fileURLToPath(import.meta.url))
    let packagePath = ''
    while (true) {
      packagePath = resolve(currentDir, 'package.json')

      if (fs.existsSync(packagePath)) {
        break
      }

      // Move up to parent directory
      const parentDir = resolve(currentDir, '..')

      // Stop if we've reached the root
      if (parentDir === currentDir) {
        throw new Error('Could not find package.json in any parent directory')
      }

      currentDir = parentDir
    }

    const packageJSON = JSON.parse(readFileSync(packagePath, 'utf8'))
    const version = typeof packageJSON.version === 'string' ? packageJSON.version : 'unknown'
    cachedVersion = version
    return version
  } catch (error) {
    console.error('Failed to read package.json:', error instanceof Error ? error.message : error)
    cachedVersion = 'unknown'
    return 'unknown'
  }
}
