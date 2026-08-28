import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliUsageError, isCliCommand, parseCliArgs, runCli } from '../src/cli.js'
import type { DwsApiClient } from '../src/dws/client.js'
import { setSandboxDirectory } from '../src/fs/sandbox.js'

function readable(value = '', isTTY = true) {
  const stream = Readable.from(value ? [value] : []) as Readable & { isTTY?: boolean }
  stream.isTTY = isTTY
  return stream
}

function writable() {
  let value = ''
  return {
    write(chunk: string) {
      value += chunk
    },
    text() {
      return value
    },
  }
}

function mockApiClient(): DwsApiClient & {
  authenticate: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
} {
  const authenticate = vi.fn().mockResolvedValue(undefined)
  const get = vi.fn().mockResolvedValue({
    data: Readable.from([
      JSON.stringify({
        signedIn: true,
        subscriptionType: 'test',
        usage: { totalCredits: 100, usedCredits: 25 },
      }),
    ]),
  })
  const post = vi.fn().mockRejectedValue(new Error('unexpected API call'))
  return { authenticate, get, post, supports: () => true } as unknown as DwsApiClient & {
    authenticate: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    post: ReturnType<typeof vi.fn>
  }
}

afterEach(async () => {
  await setSandboxDirectory(null)
})

describe('CLI argument parsing', () => {
  it('maps short commands to the shared operation names', () => {
    expect(parseCliArgs(['parse', '--json', '{}', '--format', 'json', '--sandbox', './docs'])).toEqual({
      action: 'run',
      operation: 'parse_document',
      inlineJson: '{}',
      inputFile: undefined,
      outputFormat: 'json',
      sandboxDir: './docs',
    })
  })

  it('accepts exact MCP operation names as aliases', () => {
    expect(parseCliArgs(['extract_fields'])).toMatchObject({
      action: 'run',
      operation: 'extract_fields',
    })
  })

  it('parses the CLI-only login command', () => {
    expect(parseCliArgs(['login', '--format', 'json'])).toEqual({
      action: 'login',
      outputFormat: 'json',
    })
    expect(() => parseCliArgs(['login', '--json', '{}'])).toThrow('login does not accept JSON input')
  })

  it('identifies direct npx CLI commands without claiming MCP server flags', () => {
    expect(isCliCommand('credits')).toBe(true)
    expect(isCliCommand('login')).toBe(true)
    expect(isCliCommand('parse_document')).toBe(true)
    expect(isCliCommand('--sandbox')).toBe(false)
    expect(isCliCommand(undefined)).toBe(false)
  })

  it('rejects ambiguous and unknown input', () => {
    expect(() => parseCliArgs(['process', '--input', 'request.json', '--json', '{}'])).toThrow(CliUsageError)
    expect(() => parseCliArgs(['not-a-command'])).toThrow('Unknown command')
    expect(() => parseCliArgs(['credits', '--format', 'yaml'])).toThrow('--format must be either text or json')
  })
})

describe('standalone CLI execution', () => {
  it('completes OAuth login without making a DWS API request', async () => {
    const stdout = writable()
    const stderr = writable()
    const apiClient = mockApiClient()

    const exitCode = await runCli(['login', '--format', 'json'], {
      stdin: readable(),
      stdout,
      stderr,
      apiClient,
      environmentVariables: {},
    })

    expect(exitCode).toBe(0)
    expect(stderr.text()).toBe('')
    expect(JSON.parse(stdout.text())).toEqual({ authenticated: true, method: 'oauth', cached: true })
    expect(apiClient.authenticate).toHaveBeenCalledWith('processor')
    expect(apiClient.get).not.toHaveBeenCalled()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('reports configured static keys without starting browser login', async () => {
    const stdout = writable()
    const stderr = writable()
    const apiClient = mockApiClient()

    const exitCode = await runCli(['login'], {
      stdin: readable(),
      stdout,
      stderr,
      apiClient,
      environmentVariables: { NUTRIENT_DWS_API_KEY: 'processor-key' },
    })

    expect(exitCode).toBe(0)
    expect(stderr.text()).toBe('')
    expect(stdout.text()).toContain('Static API key authentication is configured for processor')
    expect(apiClient.authenticate).not.toHaveBeenCalled()
    expect(apiClient.get).not.toHaveBeenCalled()
  })

  it('calls the shared credit operation and emits a machine-readable result', async () => {
    const stdout = writable()
    const stderr = writable()
    const apiClient = mockApiClient()

    const exitCode = await runCli(['credits', '--format', 'json'], {
      stdin: readable(),
      stdout,
      stderr,
      apiClient,
      environmentVariables: {},
    })

    expect(exitCode).toBe(0)
    expect(stderr.text()).toBe('')
    expect(JSON.parse(stdout.text())).toMatchObject({
      isError: false,
      content: [
        {
          type: 'text',
          text: expect.stringContaining('"remainingCredits": 75'),
        },
      ],
    })
    expect(apiClient.get).toHaveBeenCalledWith('account/info')
  })

  it('reads request JSON from piped stdin and returns operation errors with exit code 1', async () => {
    const stdout = writable()
    const stderr = writable()
    const apiClient = mockApiClient()

    const exitCode = await runCli(['parse'], {
      stdin: readable('{}', false),
      stdout,
      stderr,
      apiClient,
      environmentVariables: {},
    })

    expect(exitCode).toBe(1)
    expect(stdout.text()).toBe('')
    expect(stderr.text()).toContain('provide exactly one of filePath or url')
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('returns usage errors without constructing an API request', async () => {
    const stdout = writable()
    const stderr = writable()
    const apiClient = mockApiClient()

    const exitCode = await runCli(['process', '--json', '{invalid'], {
      stdin: readable(),
      stdout,
      stderr,
      apiClient,
      environmentVariables: {},
    })

    expect(exitCode).toBe(2)
    expect(stdout.text()).toBe('')
    expect(stderr.text()).toContain('Could not parse JSON from --json')
    expect(apiClient.get).not.toHaveBeenCalled()
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})
