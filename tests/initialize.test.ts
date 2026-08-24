import axios, { type AxiosInstance } from 'axios'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../src/dws/api.js'
import { createMcpServer, runServer, warnIfStdioTransportIsInteractive } from '../src/index.js'

const oauthMocks = vi.hoisted(() => ({
  getToken: vi.fn<() => Promise<string>>(),
  invalidateCachedToken: vi.fn<() => Promise<void>>(),
}))
const sandboxMocks = vi.hoisted(() => ({
  setSandboxDirectory: vi.fn<(directory: string | null) => Promise<void>>(),
}))

vi.mock('../src/auth/nutrient-oauth.js', () => oauthMocks)
vi.mock('../src/fs/sandbox.js', () => sandboxMocks)

afterEach(() => {
  vi.restoreAllMocks()
  oauthMocks.getToken.mockReset()
  oauthMocks.invalidateCachedToken.mockReset()
  sandboxMocks.setSandboxDirectory.mockReset()
})

describe('initialize startup boundary', () => {
  it('constructs and initializes the OAuth server without token acquisition or HTTP', async () => {
    oauthMocks.getToken.mockRejectedValue(new Error('initialize must not acquire a token'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('initialize must not use fetch'))
    const httpClient = {
      interceptors: { response: { use: vi.fn() } },
      get: vi.fn(),
      post: vi.fn(),
      request: vi.fn(),
    } as unknown as AxiosInstance
    vi.spyOn(axios, 'create').mockReturnValue(httpClient)

    const apiClient = createApiClient({
      dwsApiBaseUrl: 'https://api.nutrient.io',
      authServerUrl: 'https://api.nutrient.io',
    })
    const server = createMcpServer({ sandboxEnabled: false, apiClient })
    const client = new Client({ name: 'initialize-regression-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)

      expect(oauthMocks.getToken).not.toHaveBeenCalled()
      expect(oauthMocks.invalidateCachedToken).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(httpClient.get).not.toHaveBeenCalled()
      expect(httpClient.post).not.toHaveBeenCalled()
      expect(httpClient.request).not.toHaveBeenCalled()
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('responds to initialize while slow sandbox preparation remains pending', async () => {
    let releaseSandbox: (() => void) | undefined
    sandboxMocks.setSandboxDirectory.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSandbox = resolve
        }),
    )
    oauthMocks.getToken.mockRejectedValue(new Error('initialize must not acquire a token'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('initialize must not use fetch'))
    const httpClient = {
      interceptors: { response: { use: vi.fn() } },
      get: vi.fn(),
      post: vi.fn(),
      request: vi.fn(),
    } as unknown as AxiosInstance
    vi.spyOn(axios, 'create').mockReturnValue(httpClient)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'slow-sandbox-initialize-test', version: '1.0.0' })
    const runPromise = runServer(
      {
        dwsApiBaseUrl: 'https://api.nutrient.io',
        authServerUrl: 'https://api.nutrient.io',
      },
      { sandboxDir: '/slow-sandbox', transport: serverTransport },
    )

    let runningServer: Awaited<typeof runPromise> | undefined
    try {
      await client.connect(clientTransport)

      expect(releaseSandbox).toBeTypeOf('function')
      expect(oauthMocks.getToken).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(httpClient.get).not.toHaveBeenCalled()
      expect(httpClient.post).not.toHaveBeenCalled()
      expect(httpClient.request).not.toHaveBeenCalled()

      releaseSandbox?.()
      runningServer = await runPromise
    } finally {
      releaseSandbox?.()
      await runPromise.catch(() => undefined)
      await client.close()
      await runningServer?.close()
    }
  })
})

describe('stdio transport startup hint', () => {
  it.each([
    { stdinIsTTY: true, stdoutIsTTY: false },
    { stdinIsTTY: false, stdoutIsTTY: true },
  ])('writes the npx shim hint to stderr when either protocol stream is interactive', ({ stdinIsTTY, stdoutIsTTY }) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    warnIfStdioTransportIsInteractive(stdinIsTTY, stdoutIsTTY)

    expect(consoleError).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledWith(
      'MCP stdio transport expects piped stdin/stdout; if a client reports no response under npx shims, run via node directly',
    )
  })

  it('stays silent when stdin and stdout are piped', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    warnIfStdioTransportIsInteractive(false, false)

    expect(consoleError).not.toHaveBeenCalled()
  })
})
