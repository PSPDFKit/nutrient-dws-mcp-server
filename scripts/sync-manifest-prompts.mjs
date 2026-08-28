#!/usr/bin/env node

import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const manifestJsonPath = path.join(rootDir, 'manifest.json')
const compiledPromptsPath = path.join(rootDir, 'dist', 'prompts.js')

try {
  await access(compiledPromptsPath)
} catch {
  process.stderr.write('dist/prompts.js is missing. Run `pnpm build` before syncing manifest prompts.\n')
  process.exitCode = 1
}

if (process.exitCode !== 1) {
  const { manifestPromptsFromTable } = await import(pathToFileURL(compiledPromptsPath).href)
  const manifestJson = JSON.parse(await readFile(manifestJsonPath, 'utf8'))
  const generatedPrompts = manifestPromptsFromTable()

  if (JSON.stringify(manifestJson.prompts) !== JSON.stringify(generatedPrompts)) {
    manifestJson.prompts = generatedPrompts
    await writeFile(manifestJsonPath, `${JSON.stringify(manifestJson, null, 2)}\n`, 'utf8')
  }
}
