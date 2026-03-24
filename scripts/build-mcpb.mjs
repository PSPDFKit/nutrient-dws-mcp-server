#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const outputPath = path.resolve(process.argv[2] ?? path.join(rootDir, 'dist', 'nutrient-dws.mcpb'))
const cleanEnv = { ...process.env }

// pnpm injects npm_config_* environment variables that make npm print warnings
// and can influence staging installs. Strip the known noisy ones for a clean,
// reproducible npm install in the temporary bundle directory.
for (const key of [
  'npm_config_supported_architectures',
  'npm_config_npm_globalconfig',
  'npm_config_verify_deps_before_run',
  'npm_config__jsr_registry',
]) {
  delete cleanEnv[key]
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: cleanEnv,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('exit', code => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`))
    })
    child.on('error', reject)
  })
}

const stageRoot = await mkdtemp(path.join(os.tmpdir(), 'nutrient-dws-mcpb-'))
const stageDir = path.join(stageRoot, 'bundle')

try {
  await mkdir(stageDir, { recursive: true })
  await cp(path.join(rootDir, 'dist'), path.join(stageDir, 'dist'), { recursive: true })
  await cp(path.join(rootDir, 'package.json'), path.join(stageDir, 'package.json'))
  await cp(path.join(rootDir, 'README.md'), path.join(stageDir, 'README.md'))
  await cp(path.join(rootDir, 'LICENSE'), path.join(stageDir, 'LICENSE'))
  await cp(path.join(rootDir, 'manifest.json'), path.join(stageDir, 'manifest.json'))

  await run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-package-lock'], stageDir)
  await rm(path.join(stageDir, 'node_modules', '.package-lock.json'), { force: true })
  await run('npx', ['-y', '@anthropic-ai/mcpb', 'validate', 'manifest.json'], stageDir)

  await mkdir(path.dirname(outputPath), { recursive: true })
  await run('npx', ['-y', '@anthropic-ai/mcpb', 'pack', '.', outputPath], stageDir)
  await run('npx', ['-y', '@anthropic-ai/mcpb', 'info', outputPath], stageDir)
} finally {
  await rm(stageRoot, { recursive: true, force: true })
}
