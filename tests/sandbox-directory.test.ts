import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { resolveWriteFilePath, setSandboxDirectory } from '../src/fs/sandbox.js'
import { runServer } from '../src/index.js'

describe('sandbox directory setup', () => {
  it('creates a missing nested sandbox and validates a file path inside it', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'nutrient-sandbox-create-'))
    const sandboxPath = join(temporaryRoot, 'documents', 'nutrient')

    try {
      await setSandboxDirectory(sandboxPath)

      expect((await stat(sandboxPath)).isDirectory()).toBe(true)
      expect(await resolveWriteFilePath('results/output.pdf')).toBe(join(sandboxPath, 'results', 'output.pdf'))
    } finally {
      await setSandboxDirectory(null)
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('leaves the contents of an existing sandbox directory untouched', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'nutrient-sandbox-existing-'))
    const sandboxPath = join(temporaryRoot, 'existing')
    const sentinelPath = join(sandboxPath, 'keep.txt')

    try {
      await mkdir(sandboxPath)
      await writeFile(sentinelPath, 'keep this content', 'utf8')

      await setSandboxDirectory(sandboxPath)

      expect(await readFile(sentinelPath, 'utf8')).toBe('keep this content')
    } finally {
      await setSandboxDirectory(null)
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('starts unsandboxed when SANDBOX_PATH is empty', async () => {
    const originalArguments = [...process.argv]
    const originalSandboxPath = process.env.SANDBOX_PATH
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = new Client({ name: 'empty-sandbox-path-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    process.argv.splice(2)
    process.env.SANDBOX_PATH = ''

    const runPromise = runServer(
      {
        dwsApiBaseUrl: 'https://api.nutrient.io',
        authServerUrl: 'https://api.nutrient.io',
      },
      { transport: serverTransport },
    )
    let runningServer: Awaited<typeof runPromise> | undefined

    try {
      await client.connect(clientTransport)
      runningServer = await runPromise
      const toolNames = (await client.listTools()).tools.map(({ name }) => name)

      expect(toolNames).toContain('directory_tree')
      expect(toolNames).not.toContain('sandbox_file_tree')
    } finally {
      await client.close()
      await runningServer?.close()
      await runPromise.catch(() => undefined)
      process.argv.splice(0, process.argv.length, ...originalArguments)
      if (originalSandboxPath === undefined) {
        delete process.env.SANDBOX_PATH
      } else {
        process.env.SANDBOX_PATH = originalSandboxPath
      }
      consoleWarn.mockRestore()
      await setSandboxDirectory(null)
    }
  })
})
