import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { DwsApiClient } from './client.js'
import { ExtractFieldsArgs } from '../schemas.js'
import { resolveReadFilePath, resolveWriteFilePath } from '../fs/sandbox.js'
import { pipeToString } from './utils.js'
import { createSuccessResponse, createErrorResponse } from '../responses.js'
import {
  EXTRACTION_HEADERS,
  SAME_PATH_ERROR,
  billedWriteFailure,
  handleExtractionApiError,
  formatRunMetadata,
  writeToResolvedPath,
} from './parse.js'
import type { RunMetadataResponse } from './parse.js'

const EXTRACT_STRUCTURED_ENDPOINT = 'extraction/extract'
const NOT_FOUND_DISPLAY_LIMIT = 10

// This endpoint has no `text` mode, and bills a fixed extract component on top
// of the parse component — so it cannot reuse the parse tool's 402 advice.
const EXTRACT_CHEAPER_MODE_HINT =
  'The cheapest parse mode here is structure (1.5 credits/page) versus understand (9) or agentic (18); ' +
  'this endpoint bills that parse component plus a fixed extract component per page. There is no text mode.'

/** Parsed `/extraction/extract` response (the fields this handler reads). */
type ExtractFieldsResponse = RunMetadataResponse & {
  output?: {
    data?: unknown
    metadata?: unknown
    pages?: unknown[]
  }
}

/**
 * Tallies citation `match` values across `output.metadata` and lists the
 * field paths that came back `not_found`.
 *
 * `output.metadata` mirrors `output.data`'s shape, with a citation object
 * (identified by its `match` string) at every scalar leaf.
 */
function summarizeGrounding(metadata: unknown): { counts: Record<string, number>; notFoundPaths: string[] } {
  const counts: Record<string, number> = {}
  const notFoundPaths: string[] = []

  function walk(node: unknown, fieldPath: string): void {
    if (node === null || typeof node !== 'object') {
      return
    }
    const match = (node as { match?: unknown }).match
    if (typeof match === 'string') {
      counts[match] = (counts[match] ?? 0) + 1
      if (match === 'not_found') {
        notFoundPaths.push(fieldPath)
      }
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${fieldPath}[${index}]`))
      return
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walk(value, fieldPath ? `${fieldPath}.${key}` : key)
    }
  }

  walk(metadata, '')
  return { counts, notFoundPaths }
}

// Field paths come from the caller's own schema, not the document — naming
// them (e.g. "invoice.lineItems[2].amount") leaks no document content, only
// the shape the caller already specified. The cited values themselves are
// never included here.
function formatGroundingSignal(metadata: unknown): string {
  const { counts, notFoundPaths } = summarizeGrounding(metadata)
  const totalLeaves = Object.values(counts).reduce((sum, count) => sum + count, 0)
  if (totalLeaves === 0) {
    return ''
  }

  const countsLine = Object.entries(counts)
    .map(([match, count]) => `${match}: ${count}`)
    .join(', ')
  const lines = [`Citation match summary (${totalLeaves} field(s)): ${countsLine}.`]

  if (notFoundPaths.length > 0) {
    const shown = notFoundPaths.slice(0, NOT_FOUND_DISPLAY_LIMIT)
    const remaining = notFoundPaths.length - shown.length
    lines.push(`Not found: ${shown.join(', ')}${remaining > 0 ? ` (+${remaining} more)` : ''}.`)
  }

  return lines.join('\n')
}

/**
 * Calls the Nutrient DWS Data Extraction API (`POST /extraction/extract`) to pull
 * fields matching a caller-supplied JSON schema out of a document, with per-field
 * citations.
 *
 * `output.data` is always returned inline — it is the answer, and is bounded by
 * the caller's own schema. Citations (`output.metadata`) and `output.pages` are
 * only written to `outputPath`, since they can be large and add little value
 * without the document open alongside them.
 */
export async function performExtractFieldsCall(
  args: ExtractFieldsArgs,
  apiClient: DwsApiClient,
): Promise<CallToolResult> {
  const {
    filePath,
    url,
    schema,
    instructions: freeTextInstructions,
    mode,
    language,
    maxLanguages,
    maxScripts,
    includeCitations,
    strict,
    multimodal,
    outputPath,
  } = args

  if (filePath && url) {
    return createErrorResponse('Error: provide exactly one of filePath or url, not both.')
  }
  if (!filePath && !url) {
    return createErrorResponse('Error: provide exactly one of filePath or url.')
  }
  if (language !== undefined && (maxLanguages !== undefined || maxScripts !== undefined)) {
    return createErrorResponse(
      'Error: maxLanguages and maxScripts only apply when language is left unset (auto-detect). Remove language, or drop these options.',
    )
  }

  // Resolve any provided output path first (fail early on a sandbox escape,
  // before the API call).
  let resolvedOutputPath: string | undefined
  if (outputPath) {
    try {
      resolvedOutputPath = await resolveWriteFilePath(outputPath)
    } catch (error) {
      return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let fileBuffer: Buffer | undefined
  let fileName: string | undefined
  if (filePath) {
    try {
      const resolvedInputPath = await resolveReadFilePath(filePath)
      if (resolvedInputPath === resolvedOutputPath) {
        return createErrorResponse(SAME_PATH_ERROR)
      }
      fileBuffer = await fs.promises.readFile(resolvedInputPath)
      fileName = path.basename(resolvedInputPath)
    } catch (error) {
      return createErrorResponse(
        `Error with input file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const parseConfigOptions: Record<string, unknown> = {}
  if (language !== undefined) parseConfigOptions.language = language
  if (maxLanguages !== undefined) parseConfigOptions.maxLanguages = maxLanguages
  if (maxScripts !== undefined) parseConfigOptions.maxScripts = maxScripts

  const parseConfig: Record<string, unknown> = { mode }
  if (Object.keys(parseConfigOptions).length > 0) {
    parseConfig.options = parseConfigOptions
  }

  // Sent only when the caller set them — includeCitations defaults to true
  // server-side, so a zod default of false would silently disable citations
  // for every caller who never touched this field.
  const extractOptions: Record<string, unknown> = {}
  if (includeCitations !== undefined) extractOptions.includeCitations = includeCitations
  if (strict !== undefined) extractOptions.strict = strict
  if (multimodal !== undefined) extractOptions.multimodal = multimodal

  const instructions: Record<string, unknown> = { schema, parseConfig }
  if (freeTextInstructions !== undefined) {
    instructions.instructions = freeTextInstructions
  }
  if (Object.keys(extractOptions).length > 0) {
    instructions.options = extractOptions
  }

  // Only the billable call is guarded by the API error handler: a failure after
  // it has succeeded is not an API error, and rendering it as one hides the fact
  // that the extraction was already paid for.
  let body: string
  try {
    let response: Awaited<ReturnType<DwsApiClient['post']>>
    if (filePath) {
      const form = new FormData()
      form.append('file', fileBuffer!, { filename: fileName! })
      form.append('instructions', JSON.stringify(instructions))
      response = await apiClient.post(EXTRACT_STRUCTURED_ENDPOINT, form, EXTRACTION_HEADERS)
    } else {
      response = await apiClient.post(EXTRACT_STRUCTURED_ENDPOINT, { ...instructions, url }, EXTRACTION_HEADERS)
    }
    body = await pipeToString(response.data)
  } catch (error) {
    return handleExtractionApiError(error, EXTRACT_CHEAPER_MODE_HINT)
  }

  let parsed: ExtractFieldsResponse
  try {
    parsed = JSON.parse(body) as ExtractFieldsResponse
  } catch {
    return createErrorResponse('Error: the Data Extraction API returned a response that could not be parsed as JSON.')
  }

  // Guard against a 2xx response that is not an extraction result, so we
  // never overwrite the target file with a non-extraction body and never
  // report a false success inline.
  const data = parsed.output?.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return createErrorResponse(
      'Error: the Data Extraction API response did not contain an object at output.data. Nothing was written.',
    )
  }

  const runMetadata = formatRunMetadata(parsed)
  const metadata = parsed.output?.metadata
  const groundingSignal = formatGroundingSignal(metadata)
  const metadataIsEmpty =
    metadata === undefined ||
    metadata === null ||
    (typeof metadata === 'object' && Object.keys(metadata).length === 0)

  const lines = [JSON.stringify(data, null, 2)]
  if (groundingSignal) {
    lines.push(groundingSignal)
  }

  if (resolvedOutputPath) {
    try {
      await writeToResolvedPath(resolvedOutputPath, body)
    } catch (error) {
      return billedWriteFailure(resolvedOutputPath, error)
    }
    lines.push(
      `The full response was written to ${resolvedOutputPath} (${Buffer.byteLength(body)} bytes)` +
        `${metadataIsEmpty ? ' — page geometry under output.pages; no citations were returned.' : ', with per-field citations under output.metadata and page geometry under output.pages.'}`,
    )
  } else if (!metadataIsEmpty) {
    lines.push('Per-field citations were returned but omitted from this reply. Pass outputPath to keep them.')
  }

  return createSuccessResponse(lines.join('\n\n') + runMetadata)
}
