#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const packageJsonPath = path.join(rootDir, 'package.json')
const manifestJsonPath = path.join(rootDir, 'manifest.json')

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const manifestJson = JSON.parse(await readFile(manifestJsonPath, 'utf8'))

if (manifestJson.version !== packageJson.version) {
  manifestJson.version = packageJson.version
  await writeFile(manifestJsonPath, `${JSON.stringify(manifestJson, null, 2)}\n`, 'utf8')
}
