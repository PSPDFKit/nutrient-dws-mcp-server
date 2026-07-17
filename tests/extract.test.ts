import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { setSandboxDirectory } from '../src/fs/sandbox.js'
import { performExtractCall, performQueryCall, SAME_PATH_ERROR } from '../src/dws/extract.js'
import type { DwsApiClient } from '../src/dws/client.js'
import { QueryExtractionArgsSchema } from '../src/schemas.js'
import type { DataExtractorArgs, QueryExtractionArgs } from '../src/schemas.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// A recognizable "PII" string used to prove extracted content never appears in
// the inline spatial summary (it must only live in the written file).
const SECRET = 'SSN 123-45-6789'

const spatialFixture = {
  status: 200,
  requestId: 'req_test',
  output: {
    elements: [
      {
        id: '1',
        type: 'paragraph',
        role: 'Title',
        text: 'Quarterly Report',
        confidence: 0.95,
        readingOrder: 0,
        bounds: { x: 100, y: 50, width: 400, height: 35 },
        page: { pageIndex: 0, pageNumber: 1, width: 1818, height: 2422 },
      },
      {
        id: '2',
        type: 'keyValueRegion',
        text: SECRET,
        confidence: 0.4,
        readingOrder: 1,
        bounds: { x: 100, y: 200, width: 300, height: 20 },
        page: { pageIndex: 0, pageNumber: 1, width: 1818, height: 2422 },
      },
      {
        id: '3',
        type: 'table',
        confidence: 0.8,
        readingOrder: 2,
        bounds: { x: 100, y: 400, width: 600, height: 300 },
        page: { pageIndex: 1, pageNumber: 2, width: 1818, height: 2422 },
      },
    ],
  },
  metrics: { processingTimeMs: 100, pagesProcessed: 2 },
}

function mockClient(payload: unknown): { client: DwsApiClient; post: ReturnType<typeof vi.fn> } {
  const post = vi.fn().mockResolvedValue({ data: Readable.from([JSON.stringify(payload)]) })
  return { client: { post } as unknown as DwsApiClient, post }
}

/** A client whose POST rejects with an axios-shaped error carrying a streamed body. */
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

/** Parses the `instructions` field sent in a multipart form-data payload. */
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

function extractArgs(overrides: Partial<DataExtractorArgs>): DataExtractorArgs {
  const noDocumentGiven = !('filePath' in overrides) && !('url' in overrides)
  return {
    filePath: noDocumentGiven ? `input-${counter}.pdf` : overrides.filePath,
    url: overrides.url,
    mode: overrides.mode ?? 'understand',
    format: overrides.format,
    formats: overrides.formats,
    includeWords: overrides.includeWords,
    language: overrides.language,
    maxLanguages: overrides.maxLanguages,
    maxScripts: overrides.maxScripts,
    useHtmlTables: overrides.useHtmlTables,
    enableSemanticBlockFormatting: overrides.enableSemanticBlockFormatting,
    includeHeadersAndFooters: overrides.includeHeadersAndFooters,
    extractWordsFromPictures: overrides.extractWordsFromPictures,
    storeRun: overrides.storeRun ?? false,
    outputPath: overrides.outputPath,
  }
}

describe('performExtractCall', () => {
  it('returns markdown output inline', async () => {
    const input = await writeInput()
    const { client, post } = mockClient({ output: { markdown: '# Hello World' } })

    const result = await performExtractCall(extractArgs({ filePath: input, mode: 'text', format: 'markdown' }), client)

    expect(result.isError).toBeFalsy()
    expect(text(result)).toBe('# Hello World')
    expect(post).toHaveBeenCalledOnce()
  })

  it('writes markdown to a file when outputPath is given, returning a summary not the content', async () => {
    const input = await writeInput()
    const outName = `out-${counter}.md`
    const { client } = mockClient({ output: { markdown: '# Big Document\n\nlots of text' } })

    const result = await performExtractCall(
      extractArgs({ filePath: input, mode: 'text', format: 'markdown', outputPath: outName }),
      client,
    )

    expect(result.isError).toBeFalsy()
    const summary = text(result)
    expect(summary).toContain('Wrote')
    expect(summary).toContain(outName)
    expect(summary).not.toContain('lots of text')
    const written = await fs.promises.readFile(path.join(sandboxDir, outName), 'utf-8')
    expect(written).toBe('# Big Document\n\nlots of text')
  })

  it('rejects a 2xx response with no spatial element list without writing the file', async () => {
    const input = await writeInput()
    const outName = `out-${counter}.json`
    const { client } = mockClient({ status: 200, output: { markdown: 'oops wrong shape' } })

    const result = await performExtractCall(
      extractArgs({ filePath: input, mode: 'structure', format: 'spatial', outputPath: outName }),
      client,
    )

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('output.elements')
    await expect(fs.promises.access(path.join(sandboxDir, outName))).rejects.toThrow()
  })

  it('writes spatial output to a file and returns a content-free summary', async () => {
    const input = await writeInput()
    const outName = `out-${counter}.json`
    const { client } = mockClient(spatialFixture)

    const result = await performExtractCall(
      extractArgs({ filePath: input, mode: 'structure', format: 'spatial', outputPath: outName }),
      client,
    )

    expect(result.isError).toBeFalsy()
    const summary = text(result)
    // Summary reports structure, not content.
    expect(summary).toContain('Extracted 3 elements')
    expect(summary).toContain('keyValueRegion: 1')
    expect(summary).toContain('Low-confidence elements')
    // The PII must NOT leak into the inline summary...
    expect(summary).not.toContain(SECRET)
    // ...but the full data IS persisted to the file.
    const written = await fs.promises.readFile(path.join(sandboxDir, outName), 'utf-8')
    expect(written).toContain(SECRET)
  })

  it('rejects spatial output without an outputPath, before any API call', async () => {
    const input = await writeInput()
    const { client, post } = mockClient(spatialFixture)

    const result = await performExtractCall(
      extractArgs({ filePath: input, mode: 'structure', format: 'spatial' }),
      client,
    )

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('outputPath')
    expect(post).not.toHaveBeenCalled()
  })

  it('rejects text mode with spatial output', async () => {
    const input = await writeInput()
    const { client, post } = mockClient(spatialFixture)

    const result = await performExtractCall(
      extractArgs({ filePath: input, mode: 'text', format: 'spatial', outputPath: `out-${counter}.json` }),
      client,
    )

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('text mode')
    expect(post).not.toHaveBeenCalled()
  })

  it('contains an outside-sandbox absolute outputPath within the sandbox', async () => {
    const input = await writeInput()
    const escape = path.join(os.tmpdir(), `escape-${counter}.json`)
    const { client } = mockClient(spatialFixture)

    const result = await performExtractCall(
      extractArgs({ filePath: input, mode: 'structure', format: 'spatial', outputPath: escape }),
      client,
    )

    // The sandbox re-roots the absolute path inside the sandbox rather than
    // writing to the literal location, so nothing escapes.
    expect(result.isError).toBeFalsy()
    await expect(fs.promises.access(escape)).rejects.toThrow()
  })

  it('sends the x-nutrient-api-version header on the extraction call', async () => {
    const input = await writeInput()
    const { client, post } = mockClient({ output: { markdown: '# Hello' } })

    await performExtractCall(extractArgs({ filePath: input, mode: 'text', format: 'markdown' }), client)

    expect(post).toHaveBeenCalledWith(expect.any(String), expect.anything(), { 'x-nutrient-api-version': '2026-05-25' })
  })

  it('surfaces Data Extraction credit usage in the success message, distinct from Processor credits', async () => {
    const input = await writeInput()
    const { client } = mockClient({
      output: { markdown: '# Hello' },
      usage: { data_extraction_credits: { cost: 9, remainingCredits: 991 } },
    })

    const result = await performExtractCall(extractArgs({ filePath: input, mode: 'text', format: 'markdown' }), client)

    const summary = text(result)
    expect(summary).toContain('9 Data Extraction credit')
    expect(summary).toContain('991 remaining')
    expect(summary).toContain('separate')
  })

  it('surfaces runId in the success message when storeRun is true', async () => {
    const input = await writeInput()
    const { client } = mockClient({ output: { markdown: '# Hello' }, runId: 'run_abc123' })

    const result = await performExtractCall(
      extractArgs({ filePath: input, mode: 'text', format: 'markdown', storeRun: true }),
      client,
    )

    expect(text(result)).toContain('run_abc123')
  })

  it('reports remaining Data Extraction credits even when the response omits cost', async () => {
    const input = await writeInput()
    const { client } = mockClient({
      output: { markdown: '# Hello' },
      usage: { data_extraction_credits: { remainingCredits: 3 } },
    })

    const result = await performExtractCall(extractArgs({ filePath: input, mode: 'text', format: 'markdown' }), client)

    const summary = text(result)
    expect(summary).toContain('3 remaining')
    expect(summary).toContain('separate')
  })

  it('rejects an outputPath that resolves to the same file as filePath, before any API call', async () => {
    const input = await writeInput()
    const { client, post } = mockClient(spatialFixture)

    const result = await performExtractCall(
      extractArgs({ filePath: input, mode: 'structure', format: 'spatial', outputPath: input }),
      client,
    )

    expect(result.isError).toBe(true)
    expect(text(result)).toBe(SAME_PATH_ERROR)
    expect(post).not.toHaveBeenCalled()
  })

  it('reports a post-billing write failure as billed rather than as an API error', async () => {
    const input = await writeInput()
    const outName = `out-${counter}.json`
    const { client } = mockClient(spatialFixture)
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('ENOSPC: no space left'))

    const result = await performExtractCall(
      extractArgs({ filePath: input, mode: 'structure', format: 'spatial', outputPath: outName }),
      client,
    )
    writeFileSpy.mockRestore()

    expect(result.isError).toBe(true)
    const message = text(result)
    expect(message).toContain('succeeded and was billed')
    expect(message).toContain('billed again')
    expect(message).not.toContain('Data Extraction API error')
  })

  describe('document input: filePath vs url', () => {
    it('sends a multipart request with a JSON-stringified instructions field for filePath', async () => {
      const input = await writeInput()
      const { client, post } = mockClient({ output: { markdown: '# Hello' } })

      await performExtractCall(extractArgs({ filePath: input, mode: 'text', format: 'markdown' }), client)

      const form = post.mock.calls[0][1]
      expect(form.constructor.name).toBe('FormData')
      const instructions = parseFormInstructions(form)
      expect(instructions).toMatchObject({ mode: 'text', output: { format: 'markdown' } })
    })

    it('sends a JSON body containing the url for url input, not multipart', async () => {
      const { client, post } = mockClient({ output: { markdown: '# Hello' } })

      const result = await performExtractCall(
        extractArgs({ filePath: undefined, url: 'https://example.com/doc.pdf', mode: 'text', format: 'markdown' }),
        client,
      )

      expect(result.isError).toBeFalsy()
      const body = post.mock.calls[0][1]
      expect(body).toMatchObject({
        mode: 'text',
        output: { format: 'markdown' },
        url: 'https://example.com/doc.pdf',
      })
      expect(body.constructor.name).not.toBe('FormData')
    })

    it('rejects when both filePath and url are provided', async () => {
      const input = await writeInput()
      const { client, post } = mockClient({ output: { markdown: '# Hello' } })

      const result = await performExtractCall(
        extractArgs({ filePath: input, url: 'https://example.com/doc.pdf', mode: 'text', format: 'markdown' }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('exactly one')
      expect(post).not.toHaveBeenCalled()
    })

    it('rejects when neither filePath nor url is provided', async () => {
      const { client, post } = mockClient({ output: { markdown: '# Hello' } })

      const result = await performExtractCall(
        extractArgs({ filePath: undefined, url: undefined, mode: 'text', format: 'markdown' }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('exactly one')
      expect(post).not.toHaveBeenCalled()
    })
  })

  describe('format vs formats', () => {
    it('rejects format and formats given together, before any API call', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(spatialFixture)

      const result = await performExtractCall(
        extractArgs({
          filePath: input,
          format: 'markdown',
          formats: ['spatial', 'markdown'],
          outputPath: `out-${counter}.json`,
        }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('one of format or formats')
      expect(post).not.toHaveBeenCalled()
    })

    it('sends output.formats (and never output.format) for a multi-format request', async () => {
      const input = await writeInput()
      const markdown = '# Quarterly Report'
      const { client, post } = mockClient({ ...spatialFixture, output: { ...spatialFixture.output, markdown } })

      await performExtractCall(
        extractArgs({
          filePath: input,
          mode: 'structure',
          formats: ['spatial', 'markdown'],
          outputPath: `out-${counter}.json`,
        }),
        client,
      )

      const output = parseFormInstructions(post.mock.calls[0][1]).output as Record<string, unknown>
      expect(output.formats).toEqual(['spatial', 'markdown'])
      // Sending both keys is a 400 — assert absence explicitly, since a subset
      // match would pass with `format` also present.
      expect(output).not.toHaveProperty('format')
    })

    it('sends output.format (and never output.formats) for a single-format request', async () => {
      const input = await writeInput()
      const { client, post } = mockClient({ output: { markdown: '# Hello' } })

      await performExtractCall(extractArgs({ filePath: input, mode: 'text', format: 'markdown' }), client)

      const output = parseFormInstructions(post.mock.calls[0][1]).output as Record<string, unknown>
      expect(output.format).toBe('markdown')
      expect(output).not.toHaveProperty('formats')
    })

    it('omits includeWords when unset, and never sends it on a markdown-only request', async () => {
      const input = await writeInput()
      const spatial = mockClient(spatialFixture)
      const markdownOnly = mockClient({ output: { markdown: '# Hello' } })

      await performExtractCall(
        extractArgs({ filePath: input, mode: 'structure', format: 'spatial', outputPath: `out-${counter}.json` }),
        spatial.client,
      )
      await performExtractCall(
        extractArgs({ filePath: input, mode: 'text', format: 'markdown', includeWords: true }),
        markdownOnly.client,
      )

      expect(parseFormInstructions(spatial.post.mock.calls[0][1]).output).not.toHaveProperty('includeWords')
      expect(parseFormInstructions(markdownOnly.post.mock.calls[0][1]).output).not.toHaveProperty('includeWords')
    })

    it('writes both spatial and markdown to outputPath and mentions markdown bytes in the summary', async () => {
      const input = await writeInput()
      const outName = `out-${counter}.json`
      const markdown = '# Quarterly Report'
      const { client } = mockClient({ ...spatialFixture, output: { ...spatialFixture.output, markdown } })

      const result = await performExtractCall(
        extractArgs({ filePath: input, mode: 'structure', formats: ['spatial', 'markdown'], outputPath: outName }),
        client,
      )

      expect(result.isError).toBeFalsy()
      const summary = text(result)
      expect(summary).toContain('Extracted 3 elements')
      expect(summary).toContain(`${Buffer.byteLength(markdown)} bytes of Markdown`)
      expect(summary).toContain('output.markdown')
      const written = await fs.promises.readFile(path.join(sandboxDir, outName), 'utf-8')
      expect(JSON.parse(written).output.markdown).toBe(markdown)
    })

    it('requires outputPath for a multi-format request that includes spatial', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(spatialFixture)

      const result = await performExtractCall(
        extractArgs({ filePath: input, mode: 'structure', formats: ['spatial', 'markdown'] }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('outputPath')
      expect(post).not.toHaveBeenCalled()
    })

    it('writes nothing when a multi-format response is missing the requested markdown', async () => {
      const input = await writeInput()
      const outName = `out-${counter}.json`
      const { client } = mockClient(spatialFixture)

      const result = await performExtractCall(
        extractArgs({ filePath: input, mode: 'structure', formats: ['spatial', 'markdown'], outputPath: outName }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('Nothing was written')
      await expect(fs.promises.access(path.join(sandboxDir, outName))).rejects.toThrow()
    })
  })

  describe('markdown-only formatting options', () => {
    it('omits markdown-only options from the sent instructions when unset', async () => {
      const input = await writeInput()
      const { client, post } = mockClient({ output: { markdown: '# Hello' } })

      await performExtractCall(extractArgs({ filePath: input, mode: 'text', format: 'markdown' }), client)

      const instructions = parseFormInstructions(post.mock.calls[0][1])
      const output = instructions.output as Record<string, unknown>
      expect(output).not.toHaveProperty('useHtmlTables')
      expect(output).not.toHaveProperty('enableSemanticBlockFormatting')
      expect(output).not.toHaveProperty('includeHeadersAndFooters')
      expect(output).not.toHaveProperty('extractWordsFromPictures')
    })

    it('includes markdown-only options in the sent instructions when set', async () => {
      const input = await writeInput()
      const { client, post } = mockClient({ output: { markdown: '# Hello' } })

      await performExtractCall(
        extractArgs({
          filePath: input,
          mode: 'text',
          format: 'markdown',
          useHtmlTables: false,
          enableSemanticBlockFormatting: false,
          includeHeadersAndFooters: true,
          extractWordsFromPictures: true,
        }),
        client,
      )

      const instructions = parseFormInstructions(post.mock.calls[0][1])
      expect(instructions.output).toMatchObject({
        useHtmlTables: false,
        enableSemanticBlockFormatting: false,
        includeHeadersAndFooters: true,
        extractWordsFromPictures: true,
      })
    })

    it('omits markdown-only options from the sent instructions when output is spatial-only', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(spatialFixture)

      await performExtractCall(
        extractArgs({
          filePath: input,
          mode: 'structure',
          format: 'spatial',
          outputPath: `out-${counter}.json`,
          useHtmlTables: true,
        }),
        client,
      )

      const instructions = parseFormInstructions(post.mock.calls[0][1])
      expect(instructions.output).not.toHaveProperty('useHtmlTables')
    })
  })

  describe('language / maxLanguages / maxScripts', () => {
    it('rejects maxLanguages in text mode, which does no OCR, rather than dropping it', async () => {
      const input = await writeInput()
      const { client, post } = mockClient({ output: { markdown: '# Hello' } })

      const result = await performExtractCall(
        extractArgs({ filePath: input, mode: 'text', format: 'markdown', maxLanguages: 3 }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('text mode')
      expect(post).not.toHaveBeenCalled()
    })

    it('sends auto-detection tuning under options on a happy path', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(spatialFixture)

      await performExtractCall(
        extractArgs({
          filePath: input,
          mode: 'structure',
          format: 'spatial',
          outputPath: `out-${counter}.json`,
          maxLanguages: 3,
          maxScripts: 1,
        }),
        client,
      )

      expect(parseFormInstructions(post.mock.calls[0][1]).options).toEqual({ maxLanguages: 3, maxScripts: 1 })
    })

    it('omits options entirely when no language tuning is given', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(spatialFixture)

      await performExtractCall(
        extractArgs({ filePath: input, mode: 'structure', format: 'spatial', outputPath: `out-${counter}.json` }),
        client,
      )

      expect(parseFormInstructions(post.mock.calls[0][1])).not.toHaveProperty('options')
    })

    it('rejects maxLanguages when language is explicitly set', async () => {
      const input = await writeInput()
      const { client, post } = mockClient(spatialFixture)

      const result = await performExtractCall(
        extractArgs({
          filePath: input,
          mode: 'structure',
          format: 'spatial',
          outputPath: `out-${counter}.json`,
          language: 'german',
          maxLanguages: 3,
        }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('maxLanguages')
      expect(post).not.toHaveBeenCalled()
    })
  })

  describe('API errors', () => {
    it('explains a 402 as a credit balance problem rather than a transient failure', async () => {
      const input = await writeInput()
      const { client } = mockErrorClient(402, {
        status: 402,
        requestId: 'req_402',
        errorMessage: 'Insufficient credits. This request requires 2 credits, 0 remaining.',
      })

      const result = await performExtractCall(
        extractArgs({ filePath: input, mode: 'text', format: 'markdown' }),
        client,
      )

      expect(result.isError).toBe(true)
      const message = text(result)
      expect(message).toContain('Insufficient credits')
      expect(message).toContain('Retrying will not help')
      expect(message).toContain('req_402')
    })

    it('renders the Data Extraction error envelope, which the Processor handler does not recognize', async () => {
      const input = await writeInput()
      const { client } = mockErrorClient(400, {
        status: 400,
        requestId: 'req_400',
        errorMessage: 'The request is malformed.',
        errorDetails: {
          source: 'request',
          code: 'invalid_request',
          failingPaths: [{ path: 'output.format', details: 'must be spatial or markdown' }],
        },
      })

      const result = await performExtractCall(
        extractArgs({ filePath: input, mode: 'text', format: 'markdown' }),
        client,
      )

      expect(result.isError).toBe(true)
      const message = text(result)
      expect(message).toContain('HTTP 400')
      expect(message).toContain('The request is malformed.')
      expect(message).toContain('invalid_request')
      expect(message).toContain('output.format')
      expect(message).not.toContain('Error processing API response')
    })

    it('surfaces a non-JSON error body with its status', async () => {
      const input = await writeInput()
      const { client } = mockErrorClient(503, 'upstream unavailable', { raw: true })

      const result = await performExtractCall(
        extractArgs({ filePath: input, mode: 'text', format: 'markdown' }),
        client,
      )

      expect(result.isError).toBe(true)
      expect(text(result)).toContain('HTTP 503')
      expect(text(result)).toContain('upstream unavailable')
    })
  })
})

describe('performQueryCall', () => {
  async function writeFixture(): Promise<string> {
    const name = `extraction-${counter}.json`
    await fs.promises.writeFile(path.join(sandboxDir, name), JSON.stringify(spatialFixture))
    return name
  }

  function queryArgs(overrides: Partial<QueryExtractionArgs>): QueryExtractionArgs {
    return {
      filePath: overrides.filePath ?? `extraction-${counter}.json`,
      pages: overrides.pages,
      region: overrides.region,
      minConfidence: overrides.minConfidence,
      maxConfidence: overrides.maxConfidence,
      elementTypes: overrides.elementTypes,
      limit: overrides.limit ?? 100,
    }
  }

  it('filters by minConfidence', async () => {
    const file = await writeFixture()
    const result = await performQueryCall(queryArgs({ filePath: file, minConfidence: 0.9 }))

    expect(result.isError).toBeFalsy()
    const out = text(result)
    expect(out).toContain('1 matching element')
    expect(out).toContain('Quarterly Report')
    expect(out).not.toContain(SECRET)
  })

  it('filters by maxConfidence', async () => {
    const file = await writeFixture()
    const result = await performQueryCall(queryArgs({ filePath: file, maxConfidence: 0.6 }))

    expect(result.isError).toBeFalsy()
    const out = text(result)
    expect(out).toContain('1 matching element')
    expect(out).toContain('"type": "keyValueRegion"')
  })

  it('rejects a minConfidence greater than maxConfidence, naming both values', async () => {
    const file = await writeFixture()
    const result = await performQueryCall(queryArgs({ filePath: file, minConfidence: 0.9, maxConfidence: 0.5 }))

    expect(result.isError).toBe(true)
    const message = text(result)
    expect(message).toContain('0.9')
    expect(message).toContain('0.5')
  })

  it('excludes elements without a confidence score when a bound is set, includes them when neither bound is set', async () => {
    const name = `unscored-${counter}.json`
    const fixture = {
      output: {
        elements: [
          {
            id: 'scored',
            type: 'paragraph',
            confidence: 0.9,
            bounds: { x: 0, y: 0, width: 10, height: 10 },
            page: { pageIndex: 0 },
          },
          {
            id: 'unscored',
            type: 'paragraph',
            bounds: { x: 0, y: 0, width: 10, height: 10 },
            page: { pageIndex: 0 },
          },
        ],
      },
    }
    await fs.promises.writeFile(path.join(sandboxDir, name), JSON.stringify(fixture))

    const bounded = await performQueryCall(queryArgs({ filePath: name, minConfidence: 0 }))
    expect(text(bounded)).toContain('1 matching element')

    const unbounded = await performQueryCall(queryArgs({ filePath: name }))
    expect(text(unbounded)).toContain('2 matching element')
  })

  it('filters by element type', async () => {
    const file = await writeFixture()
    const result = await performQueryCall(queryArgs({ filePath: file, elementTypes: ['table'] }))

    expect(text(result)).toContain('1 matching element')
    expect(text(result)).toContain('"type": "table"')
  })

  it('filters by page index', async () => {
    const file = await writeFixture()
    const result = await performQueryCall(queryArgs({ filePath: file, pages: [1] }))

    const out = text(result)
    expect(out).toContain('1 matching element')
    expect(out).toContain('"pageIndex": 1')
  })

  it('filters by region intersection', async () => {
    const file = await writeFixture()
    // Region overlapping only the Title element at (100,50,400,35).
    const result = await performQueryCall(
      queryArgs({ filePath: file, region: { x: 90, y: 40, width: 50, height: 50 } }),
    )

    expect(text(result)).toContain('Quarterly Report')
  })

  it('truncates to limit with guidance', async () => {
    const file = await writeFixture()
    const result = await performQueryCall(queryArgs({ filePath: file, limit: 1 }))

    const out = text(result)
    expect(out).toContain('Showing the first 1 of 3 matches')
    expect(out).toContain('Narrow the filters')
  })

  it('errors on a file that is not a spatial extraction result', async () => {
    const name = `bad-${counter}.json`
    await fs.promises.writeFile(path.join(sandboxDir, name), JSON.stringify({ not: 'an extraction' }))

    const result = await performQueryCall(queryArgs({ filePath: name }))

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('output.elements')
  })
})

describe('QueryExtractionArgsSchema', () => {
  const minimal = { filePath: 'extraction.json' }

  it('rejects an empty pages array rather than treating it as no filter', () => {
    expect(QueryExtractionArgsSchema.safeParse({ ...minimal, pages: [] }).success).toBe(false)
  })

  it('rejects an empty elementTypes array rather than treating it as no filter', () => {
    expect(QueryExtractionArgsSchema.safeParse({ ...minimal, elementTypes: [] }).success).toBe(false)
  })

  it('accepts omitting pages and elementTypes entirely', () => {
    expect(QueryExtractionArgsSchema.safeParse(minimal).success).toBe(true)
  })
})
