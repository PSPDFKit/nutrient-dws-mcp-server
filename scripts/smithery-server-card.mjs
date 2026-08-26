#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { clearTimeout, setTimeout } from 'node:timers'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const serverPath = path.join(rootDir, 'dist', 'index.js')
const serverCardModulePath = path.join(rootDir, 'dist', 'smithery', 'server-card.js')
const requestTimeoutMs = 15_000

function cleanServerEnvironment(sandboxPath) {
  const env = { ...process.env, SANDBOX_PATH: sandboxPath }

  for (const key of Object.keys(env)) {
    if (key.toUpperCase().includes('API_KEY')) {
      delete env[key]
    }
  }

  return env
}

function createProtocolClient(child) {
  let nextId = 1
  const pending = new Map()
  const lines = createInterface({ input: child.stdout })

  function rejectPending(error) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    pending.clear()
  }

  lines.on('line', (line) => {
    if (line.trim() === '') {
      return
    }

    let message
    try {
      message = JSON.parse(line)
    } catch {
      rejectPending(new Error('The built server wrote a non-JSON line to its protocol stream.'))
      return
    }

    if (!Object.hasOwn(message, 'id')) {
      return
    }

    const request = pending.get(message.id)
    if (!request) {
      return
    }

    pending.delete(message.id)
    clearTimeout(request.timer)

    if (message.error) {
      request.reject(new Error(`MCP request ${request.method} failed: ${message.error.message ?? 'unknown error'}`))
      return
    }

    request.resolve(message.result)
  })

  child.once('error', (error) => {
    rejectPending(new Error(`Could not start the built server: ${error.message}`))
  })
  child.stdin.once('error', (error) => {
    rejectPending(new Error(`Could not write to the built server: ${error.message}`))
  })
  child.once('close', (code, signal) => {
    rejectPending(
      new Error(`The built server exited before the probe completed (${signal ?? `exit code ${code ?? 'unknown'}`}).`),
    )
  })
  child.stderr.resume()

  function write(message) {
    return new Promise((resolve, reject) => {
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  function request(method, params = {}) {
    const id = nextId++

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out waiting for MCP response to ${method}.`))
      }, requestTimeoutMs)

      pending.set(id, { method, resolve, reject, timer })
      write({ jsonrpc: '2.0', id, method, params }).catch((error) => {
        const activeRequest = pending.get(id)
        if (!activeRequest) {
          return
        }
        pending.delete(id)
        clearTimeout(activeRequest.timer)
        reject(new Error(`Could not send MCP request ${method}: ${error.message}`))
      })
    })
  }

  return {
    request,
    notify(method, params) {
      const message = { jsonrpc: '2.0', method }
      if (params !== undefined) {
        message.params = params
      }
      return write(message)
    },
    close() {
      lines.close()
      rejectPending(new Error('The MCP probe was closed.'))
    },
  }
}

async function stopChild(child, closed) {
  child.stdin.end()

  if (child.exitCode !== null || child.signalCode !== null) {
    await closed
    return
  }

  child.kill('SIGTERM')
  const stopped = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])

  if (!stopped) {
    child.kill('SIGKILL')
    await closed
  }
}

async function probeServer(sandboxPath) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: rootDir,
    env: cleanServerEnvironment(sandboxPath),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const closed = new Promise((resolve) => child.once('close', resolve))
  const protocol = createProtocolClient(child)

  try {
    const initializeResult = await protocol.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'nutrient-smithery-server-card', version: '1.0.0' },
    })
    await protocol.notify('notifications/initialized')
    const toolsResult = await protocol.request('tools/list')
    const promptsResult = await protocol.request('prompts/list')

    return {
      initializeResult,
      tools: toolsResult.tools ?? [],
      prompts: promptsResult.prompts ?? [],
    }
  } finally {
    protocol.close()
    await stopChild(child, closed)
  }
}

async function requireBuildOutputs() {
  const missing = []

  for (const filePath of [serverPath, serverCardModulePath]) {
    try {
      await access(filePath)
    } catch {
      missing.push(path.relative(rootDir, filePath))
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing. Run \`pnpm build\` first.`,
    )
  }
}

async function main() {
  const [expectedVersion, outputArgument] = process.argv.slice(2)
  if (!expectedVersion || !outputArgument) {
    throw new Error('Usage: pnpm smithery:card <expectedVersion> <outputPath>')
  }

  await requireBuildOutputs()

  const outputPath = path.resolve(process.cwd(), outputArgument)
  const provenancePath = `${outputPath}.provenance.json`
  const [packageJson, manifest, serverJson, serverCardModule] = await Promise.all([
    readFile(path.join(rootDir, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(rootDir, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(path.join(rootDir, 'server.json'), 'utf8').then(JSON.parse),
    import(pathToFileURL(serverCardModulePath).href),
  ])

  const sandboxPath = await mkdtemp(path.join(os.tmpdir(), 'nutrient-dws-smithery-'))
  try {
    const probe = await probeServer(sandboxPath)

    serverCardModule.assertVersionsAgree({
      expected: expectedVersion,
      packageJsonVersion: packageJson.version,
      serverVersion: probe.initializeResult.serverInfo.version,
    })

    const payload = serverCardModule.buildDeployPayload({
      initializeResult: probe.initializeResult,
      tools: probe.tools,
      prompts: probe.prompts,
      manifest,
      serverJson,
    })
    const problems = serverCardModule.validateDeployPayload(payload)
    if (problems.length > 0) {
      throw new Error(
        `Smithery deploy payload validation failed:\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
      )
    }

    const { stdout: commit } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: rootDir })
    const toolCount = payload.serverCard.tools?.length ?? 0
    const promptCount = payload.serverCard.prompts?.length ?? 0
    const provenance = {
      version: expectedVersion,
      commit: commit.trim(),
      generatedAt: new Date().toISOString(),
      toolCount,
      promptCount,
    }

    await mkdir(path.dirname(outputPath), { recursive: true })
    await Promise.all([
      writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'),
      writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8'),
    ])

    process.stdout.write(
      `Wrote Smithery card ${outputPath} for ${expectedVersion} with ${toolCount} tools and ${promptCount} prompts.\n`,
    )
  } finally {
    await rm(sandboxPath, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
