import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { setSandboxDirectory } from '../src/fs/sandbox.js'
import { performExtractFieldsCall } from '../src/dws/extract.js'
import { SAME_PATH_ERROR } from '../src/dws/parse.js'
import type { DwsApiClient } from '../src/dws/client.js'
import { ExtractFieldsArgsSchema } from '../src/schemas.js'
import type { ExtractFieldsArgs } from '../src/schemas.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// A recognizable "PII" value used to prove citation content only lands in the
// written file, never inline (the schema's field NAMES are always inline).
const SECRET = 'SSN 123-45-6789'

const invoiceSchema = {
  type: 'object' as const,
  properties: {
    invoiceNumber: { type: 'string' },
    total: { type: 'number' },
  },
  required: ['invoiceNumber'],
}

const extractFixture = {
  status: 200,
  requestId: 'req_test',
  output: {
    data: { invoiceNumber: 'INV-001', total: 42.5 },
    metadata: {
      invoiceNumber: { bbox: [1, 2, 3, 4], confidence: 0.95, match: 'id_match' },
      total: { bbox: [5, 6, 7, 8], confidence: 0.4, match: 'fuzzy_match', note: SECRET },
    },
    pages: [{ pageIndex: 0 }],
  },
  metrics: { pagesProcessed: 1 },
  usage: {
    data_extraction_credits: { cost: 10.5, remainingCredits: 989.5 },
    price_composition: {
      parse: { units: 1, unit_cost: 9, cost: 9, currency: 'credits' },
      extract: { units: 1, unit_cost: 1.5, cost: 1.5, currency: 'credits' },
    },
  },
}

function mockClient(payload: unknown): { client: DwsApiClient; post: ReturnType<typeof vi.fn> } {
  const post = vi.fn().mockResolvedValue({ data: Readable.from([JSON.stringify(payload)]) })
  return { client: { post } as unknown as DwsApiClient, post }
}

function mockErrorClient(
  status: number,
  payload: unknown,
  options: { raw?: boolean } = {},
): { client: DwsApiClient; post: ReturnType<typeof vi.fn> } {
  const body = options.raw ? String(payload) : JSON.stringify(payload)
  const error = Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: Readable.from([body]) },
  })
  const post = vi.fn().mockRejectedValue(error)
  return { client: { post } as unknown as DwsApiClient, post }
}

function parseFormInstructions(form: { getBuffer: () => Buffer }): Record<string, unknown> {
  const raw = form.getBuffer().toString('utf-8')
  const match = raw.match(/name="instructions"\r\n\r\n([\s\S]*?)\r\n--/)
  if (!match) {
    throw new Error('instructions field not found in form-data payload')
  }
  return JSON.parse(match[1]) as Record<string, unknown>
}

function text(result: CallToolResult): string {
  return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
}

let sandboxDir: string
let counter = 0

beforeEach(async () => {
  counter += 1
  sandboxDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'extract-test-'))
  await setSandboxDirectory(sandboxDir)
})

afterEach(async () => {
  await fs.promises.rm(sandboxDir, { recursive: true, force: true })
})

async function writeInput(): Promise<string> {
  const name = `input-${counter}.pdf`
  await fs.promises.writeFile(path.join(sandboxDir, name), 'dummy pdf bytes')
  return name
}

function extractArgs(overrides: Partial<ExtractFieldsArgs>): ExtractFieldsArgs {
  const noDocumentGiven = !('filePath' in overrides) && !('url' in overrides)
  return {
    filePath: noDocumentGiven ? `input-${counter}.pdf` : overrides.filePath,
    url: overrides.url,
    schema: overrides.schema ?? invoiceSchema,
    instructions: overrides.instructions,
    mode: overrides.mode ?? 'understand',
    language: overrides.language,
    maxLanguages: overrides.maxLanguages,
    maxScripts: overrides.maxScripts,
    includeCitations: overrides.includeCitations,
    strict: overrides.strict,
    multimodal: overrides.multimodal,
    outputPath: overrides.outputPath,
  }
}

describe('performExtractFieldsCall', () => {
  describe('document input: filePath vs url', () => {
    it('sends a multipart request with a JSON-stringified instructions field for filePath', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      expect(result.isError).toBeFalsy()
      const form = post.mock.calls[0][1]
      expect(form.constructor.name).toBe('FormData')
      const instructions = parseFormInstructions(form)
      expect(instructions).toMatchObject({ schema: invoiceSchema, parseConfig: { mode: 'understand' } })
    })

    it('sends a JSON body containing the url and schema for url input, not multipart', async () => {
      const { client, post } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(
        extractArgs({ filePath: undefined, url: 'https://example.com/doc.pdf' }),
        client,
      )

      expect(result.isError).toBeFalsy()
      const body = post.mock.calls[0][1]
      expect(body).toMatchObject({ schema: invoiceSchema, url: 'https://example.com/doc.pdf' })
      expect(body.constructor.name).not.toBe('FormData')
    })

    it('rejects when both filePath and url are provided, before any API call', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(
        extractArgs({ filePath: input, url: 'https://example.com/doc.pdf' }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('exactly one')
      expect(post).not.toHaveBeenCalled()
    })

    it('rejects when neither filePath nor url is provided, before any API call', async () => {
      const { client, post } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(extractArgs({ filePath: undefined, url: undefined }), client)

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('exactly one')
      expect(post).not.toHaveBeenCalled()
    })

    it('rejects an outputPath that resolves to the same file as filePath, before any API call', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(extractArgs({ filePath: input, outputPath: input }), client)

      expect(result.isError).toBe(true)
      expect(text(result)).toBe(SAME_PATH_ERROR)
      expect(post).not.toHaveBeenCalled()
    })
  })

  describe('schema / parseConfig / options nesting', () => {
    it('nests schema directly under instructions', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      const instructions = parseFormInstructions(post.mock.calls[0][1])
      expect(instructions.schema).toEqual(invoiceSchema)
    })

    it('nests language under parseConfig.options', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      await performExtractFieldsCall(
        extractArgs({ filePath: input, mode: 'structure', language: 'german' }),
        client,
      )

      const instructions = parseFormInstructions(post.mock.calls[0][1])
      expect(instructions.parseConfig).toEqual({ mode: 'structure', options: { language: 'german' } })
    })

    it('omits parseConfig.options entirely when no language tuning is given', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      const instructions = parseFormInstructions(post.mock.calls[0][1])
      expect(instructions.parseConfig).toEqual({ mode: 'understand' })
    })

    it('rejects maxLanguages when language is explicitly set, before any API call', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(
        extractArgs({ filePath: input, language: 'german', maxLanguages: 3 }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('maxLanguages')
      expect(post).not.toHaveBeenCalled()
    })

    it('rejects maxScripts when language is explicitly set, before any API call', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(
        extractArgs({ filePath: input, language: 'german', maxScripts: 2 }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('maxScripts')
      expect(post).not.toHaveBeenCalled()
    })

    it('omits includeCitations/strict/multimodal when unset', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      const instructions = parseFormInstructions(post.mock.calls[0][1])
      expect(instructions).not.toHaveProperty('options')
    })

    it('sends includeCitations/strict/multimodal under options when set', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      await performExtractFieldsCall(
        extractArgs({ filePath: input, includeCitations: false, strict: true, multimodal: true }),
        client,
      )

      const instructions = parseFormInstructions(post.mock.calls[0][1])
      expect(instructions.options).toEqual({ includeCitations: false, strict: true, multimodal: true })
    })

    it('nests free-text instructions alongside schema', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      await performExtractFieldsCall(
        extractArgs({ filePath: input, instructions: 'Prefer the most recent invoice date.' }),
        client,
      )

      const instructions = parseFormInstructions(post.mock.calls[0][1])
      expect(instructions).toMatchObject({
        instructions: 'Prefer the most recent invoice date.',
      })
    })
  })

  describe('response handling', () => {
    it('returns output.data inline, pretty-printed', async () => {
      const input = await writeInput()
      const { client } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      expect(result.isError).toBeFalsy()
      const output = text(result)
      expect(output).toContain(JSON.stringify(extractFixture.output.data, null, 2))
    })

    it('lists not_found field paths in the grounding signal, capped at 10 with a +N more suffix', async () => {
      const input = await writeInput()
      const manyNotFound: Record<string, unknown> = {}
      const data: Record<string, unknown> = {}
      for (let i = 0; i < 12; i++) {
        manyNotFound[`field${i}`] = { match: 'not_found' }
        data[`field${i}`] = null
      }
      const { client } = mockClient({ output: { data, metadata: manyNotFound, pages: [] } })

      const result = await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      const notFoundLine = text(result)
        .split('\n')
        .find((line) => line.startsWith('Not found:'))
      expect(notFoundLine).toContain('field0')
      expect(notFoundLine).toContain('field9')
      expect(notFoundLine).not.toContain('field10')
      expect(notFoundLine).toContain('+2 more')
    })

    it('reports the citation match summary counts', async () => {
      const input = await writeInput()
      const { client } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      const output = text(result)
      expect(output).toContain('id_match: 1')
      expect(output).toContain('fuzzy_match: 1')
    })

    it('writes the full response to outputPath and notes where citations landed, without leaking them inline', async () => {
      const input = await writeInput()
      const outName = `out-${counter}.json`
      const { client } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(extractArgs({ filePath: input, outputPath: outName }), client)

      expect(result.isError).toBeFalsy()
      const output = text(result)
      expect(output).toContain(outName)
      expect(output).not.toContain(SECRET)
      const written = await fs.promises.readFile(path.join(sandboxDir, outName), 'utf-8')
      expect(written).toContain(SECRET)
      expect(JSON.parse(written).output.metadata).toBeTruthy()
    })

    it('notes citations were omitted (not written) when outputPath is absent and metadata is non-empty', async () => {
      const input = await writeInput()
      const { client } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      const output = text(result)
      expect(output).toContain('omitted')
      expect(output).toContain('outputPath')
      expect(output).not.toContain(SECRET)
    })

    it('does not claim citations were returned when output.metadata is null', async () => {
      const input = await writeInput()
      const { client } = mockClient({ output: { data: { invoiceNumber: 'INV-001' }, metadata: null, pages: [] } })

      const result = await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      expect(result.isError).toBeFalsy()
      const output = text(result)
      expect(output).not.toContain('citations were returned')
      expect(output).not.toContain('Pass outputPath')
    })

    it('rejects a 2xx response whose output.data is not an object, writing nothing', async () => {
      const input = await writeInput()
      const outName = `out-${counter}.json`
      const { client } = mockClient({ output: { data: 'not an object', metadata: {} } })

      const result = await performExtractFieldsCall(extractArgs({ filePath: input, outputPath: outName }), client)

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('output.data')
      await expect(fs.promises.access(path.join(sandboxDir, outName))).rejects.toThrow()
    })

    it('surfaces the credits/price_composition split in the success message', async () => {
      const input = await writeInput()
      const { client } = mockClient(extractFixture)

      const result = await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      const output = text(result)
      expect(output).toContain('10.5 Data Extraction credit')
      expect(output).toContain('989.5 remaining')
      expect(output).toContain('parse')
      expect(output).toContain('extract')
    })

    it('sends the x-nutrient-api-version header', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(extractFixture)

      await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      expect(post).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
        'x-nutrient-api-version': '2026-05-25',
      })
    })
  })

  describe('API errors', () => {
    it('renders a 402 as a non-retryable credit balance problem via handleExtractionApiError', async () => {
      const input = await writeInput()
      const { client } = mockErrorClient(402, {
        status: 402,
        requestId: 'req_402',
        errorMessage: 'Insufficient credits. This request requires 12 credits, 0 remaining.',
      })

      const result = await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      expect(result.isError).toBe(true)
      const message = text(result)
      expect(message).toContain('Insufficient credits')
      expect(message).toContain('Retrying will not help')
      expect(message).toContain('req_402')
      // The advice must fit THIS endpoint: recommending text mode (which the
      // parse tool offers) would send the caller into a guaranteed rejection.
      expect(message).toContain('structure')
      expect(message).not.toMatch(/\btext: 1 credit/)
    })

    it('surfaces a non-JSON error body with its status', async () => {
      const input = await writeInput()
      const { client } = mockErrorClient(503, 'upstream unavailable', { raw: true })

      const result = await performExtractFieldsCall(extractArgs({ filePath: input }), client)

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('HTTP 503')
      expect(text(result)).toContain('upstream unavailable')
    })
  })
})

// The handler tests above construct args directly, so they cannot catch a bad
// default on the schema itself — parse real input here instead.
describe('ExtractFieldsArgsSchema', () => {
  const minimal = { filePath: 'in.pdf', schema: { type: 'object', properties: { total: { type: 'number' } } } }

  it('leaves includeCitations, strict and multimodal undefined when unset', () => {
    const parsed = ExtractFieldsArgsSchema.parse(minimal)

    // A zod default here would ship an implicit `false` and silently disable
    // citations, which the API enables by default, for every caller.
    expect(parsed.includeCitations).toBeUndefined()
    expect(parsed.strict).toBeUndefined()
    expect(parsed.multimodal).toBeUndefined()
  })

  it('defaults mode to understand', () => {
    const parsed = ExtractFieldsArgsSchema.parse(minimal)

    expect(parsed.mode).toBe('understand')
  })

  it('rejects text mode, which this endpoint does not offer', () => {
    expect(() => ExtractFieldsArgsSchema.parse({ ...minimal, mode: 'text' })).toThrow()
  })

  it('accepts every mode this endpoint does offer', () => {
    for (const mode of ['structure', 'understand', 'agentic']) {
      expect(ExtractFieldsArgsSchema.parse({ ...minimal, mode }).mode).toBe(mode)
    }
  })

  it('requires a schema whose root is an object with properties', () => {
    expect(() => ExtractFieldsArgsSchema.parse({ filePath: 'in.pdf' })).toThrow()
    expect(() => ExtractFieldsArgsSchema.parse({ ...minimal, schema: { type: 'array', properties: {} } })).toThrow()
  })

  it('rejects free-text instructions beyond the documented 10000 characters', () => {
    expect(() => ExtractFieldsArgsSchema.parse({ ...minimal, instructions: 'x'.repeat(10001) })).toThrow()
    expect(
      ExtractFieldsArgsSchema.parse({ ...minimal, instructions: 'x'.repeat(10000) }).instructions,
    ).toHaveLength(10000)
  })

  it('rejects a url that is not a URL', () => {
    expect(() => ExtractFieldsArgsSchema.parse({ schema: minimal.schema, url: 'not-a-url' })).toThrow()
  })
})
