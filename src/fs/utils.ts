import fs from 'fs'

/**
 * Writes a buffer to a file and handles errors
 */
export function writeBufferToFile(buffer: Buffer, outputPath: string) {
  fs.writeFileSync(outputPath, buffer)
}
