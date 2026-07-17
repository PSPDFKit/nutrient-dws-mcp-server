import axios from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { DwsApiClient } from './client.js'
import { DataExtractorArgs, QueryExtractionArgs } from '../schemas.js'
import { resolveReadFilePath, resolveWriteFilePath } from '../fs/sandbox.js'
import { pipeToString, handleApiError } from './utils.js'
import { createSuccessResponse, createErrorResponse } from '../responses.js'

const EXTRACTION_ENDPOINT = 'extraction/parse'
const LOW_CONFIDENCE_THRESHOLD = 0.6

// Omitting this header pins the request to whichever spec version was current
// when the API key was created, not the version this server was built against.
const EXTRACTION_API_VERSION = '2026-05-25'
export const EXTRACTION_HEADERS = { 'x-nutrient-api-version': EXTRACTION_API_VERSION }

type ExtractionFormat = 'spatial' | 'markdown'

/** A single spatial element from the Data Extraction API (`output.format: spatial`). */
type SpatialElement = {
  type?: string
  role?: string
  confidence?: number
  bounds?: { x: number; y: number; width: number; height: number }
  page?: { pageIndex?: number; pageNumber?: number; width?: number; height?: number }
}

/** Parsed `/extraction/parse` response (the fields this server reads). */
type ExtractionResponse = {
  output?: { elements?: SpatialElement[]; markdown?: string }
  metrics?: { pagesProcessed?: number }
  runId?: string
  usage?: { data_extraction_credits?: { cost?: number; remainingCredits?: number } }
}

/**
 * Data Extraction error envelope. Deliberately not the Processor's shape —
 * it carries `errorMessage`/`errorDetails` where the Processor sends `details`,
 * so the shared handler doesn't recognize it and renders it as an unexplained blob.
 */
type ExtractionErrorResponse = {
  status?: number
  requestId?: string
  errorMessage?: string
  runId?: string
  errorDetails?: {
    source?: string
    code?: string
    failingPaths?: { path?: string; details?: string }[]
  }
}

function formatExtractionError(body: ExtractionErrorResponse, httpStatus: number, cheaperModeHint?: string): string {
  const status = body.status ?? httpStatus
  const lines = [`Data Extraction API error (HTTP ${status}): ${body.errorMessage}`]

  // 402 is a balance problem, not a blip. Say so, or an agent reads a generic
  // failure and retries — burning another call that cannot succeed.
  if (status === 402) {
    lines.push(
      'Out of Data Extraction credits. Retrying will not help — top up the Data Extraction balance, which is separate ' +
        `from the Processor API credits reported by check_credits.${cheaperModeHint ? ` ${cheaperModeHint}` : ''}`,
    )
  }

  const details = body.errorDetails
  if (details?.code) {
    lines.push(`Code: ${details.code}${details.source ? ` (source: ${details.source})` : ''}`)
  }
  for (const failing of details?.failingPaths ?? []) {
    lines.push(`Failing path ${failing.path}: ${failing.details}`)
  }
  if (body.requestId) {
    lines.push(`requestId: ${body.requestId}${body.runId ? `, runId: ${body.runId}` : ''}`)
  }

  return lines.join('\n')
}

/** Advice appended to a 402 from `/extraction/parse`, whose cheapest mode is `text`. */
export const PARSE_CHEAPER_MODE_HINT =
  'A cheaper mode (text: 1 credit/page, structure: 1.5) costs less per page than understand (9) or agentic (18).'

/**
 * Renders a failed Data Extraction call.
 *
 * Consumes the error stream itself rather than delegating to `handleApiError`,
 * which only recognizes the Processor envelope — the response body can be read
 * exactly once, so the two cannot both inspect it.
 *
 * `cheaperModeHint` is per-endpoint: the modes and per-page costs differ between
 * /extraction/parse and /extraction/extract, and naming a mode the caller's
 * endpoint rejects would send it into a guaranteed-failing retry.
 */
export async function handleExtractionApiError(error: unknown, cheaperModeHint?: string): Promise<CallToolResult> {
  if (!axios.isAxiosError(error) || !error.response?.data) {
    return handleApiError(error)
  }

  let body: string
  try {
    body = await pipeToString(error.response.data)
  } catch (streamError) {
    return createErrorResponse(
      `Error reading the Data Extraction API error response: ${streamError instanceof Error ? streamError.message : String(streamError)}`,
    )
  }

  let parsed: ExtractionErrorResponse
  try {
    parsed = JSON.parse(body) as ExtractionErrorResponse
  } catch {
    return createErrorResponse(`Data Extraction API error (HTTP ${error.response.status}): ${body}`)
  }

  if (typeof parsed.errorMessage !== 'string') {
    return createErrorResponse(`Data Extraction API error (HTTP ${error.response.status}): ${body}`)
  }

  return createErrorResponse(formatExtractionError(parsed, error.response.status, cheaperModeHint))
}

/** text mode defaults to markdown; every other mode defaults to spatial. Callers pass `format` or `formats`, never both. */
function resolveFormats(
  mode: DataExtractorArgs['mode'],
  format: DataExtractorArgs['format'],
  formats: DataExtractorArgs['formats'],
): ExtractionFormat[] {
  if (formats) {
    return formats
  }
  if (format) {
    return [format]
  }
  return mode === 'text' ? ['markdown'] : ['spatial']
}

/** A parse or extract line item within `usage.price_composition` (returned by `/extraction/extract`). */
export type PriceComponent = { units?: number; unit_cost?: number; cost?: number; currency?: string }

/** The subset of an extraction response `formatRunMetadata` reads — shared by `/extraction/parse` and `/extraction/extract`. */
export type RunMetadataResponse = {
  runId?: string
  usage?: {
    data_extraction_credits?: { cost?: number; remainingCredits?: number }
    // Only present on /extraction/extract — the parse-mode component plus the fixed per-page extract component.
    price_composition?: { parse?: PriceComponent; extract?: PriceComponent }
  }
}

/** `runId` (present when `storeRun: true`) and Data Extraction credit usage, appended to the success message. */
export function formatRunMetadata(response: RunMetadataResponse): string {
  const notes: string[] = []
  if (response.runId) {
    notes.push(`This run was stored server-side (runId: ${response.runId}) and can be retrieved later.`)
  }
  const credits = response.usage?.data_extraction_credits
  // Either half alone is worth reporting: the remaining balance is what stops an
  // agent from walking into a 402, and it must survive a response that omits cost.
  if (credits && (typeof credits.cost === 'number' || typeof credits.remainingCredits === 'number')) {
    const used =
      typeof credits.cost === 'number'
        ? `Used ${credits.cost} Data Extraction credit(s)`
        : 'Used an unreported number of Data Extraction credits'
    const remaining =
      typeof credits.remainingCredits === 'number' ? `${credits.remainingCredits} remaining` : 'remaining unknown'
    notes.push(
      `${used} (${remaining}). These are Data Extraction credits — a separate ` +
        'balance from the Processor API credits reported by check_credits.',
    )
    const composition = response.usage?.price_composition
    const parse = composition?.parse
    const extract = composition?.extract
    if (parse && extract) {
      notes.push(
        `Cost breakdown: parse ${parse.cost ?? '?'} + extract ${extract.cost ?? '?'} (per-page, ${extract.units ?? '?'} page(s)).`,
      )
    }
  }
  return notes.length > 0 ? `\n\n${notes.join('\n')}` : ''
}

/**
 * Build a decision-grade summary of a spatial extraction result.
 *
 * Deliberately excludes extracted document text — it reports only counts,
 * confidence signal, page geometry, and where the full result was written, so
 * sensitive content never lands in the agent transcript (query it back with
 * `query_extraction` instead).
 */
function summarizeSpatial(response: ExtractionResponse, outputPath: string, byteLength: number): string {
  const elements = response.output?.elements ?? []
  const typeCounts: Record<string, number> = {}
  const pageIndexes = new Set<number>()
  let lowConfidence = 0

  for (const element of elements) {
    const type = element.type ?? 'unknown'
    typeCounts[type] = (typeCounts[type] ?? 0) + 1
    // Inclusive, so the count matches exactly what the maxConfidence query
    // suggested below returns — an element scored exactly at the threshold must
    // not be counted here and then missing from the triage query.
    if (typeof element.confidence === 'number' && element.confidence <= LOW_CONFIDENCE_THRESHOLD) {
      lowConfidence += 1
    }
    if (typeof element.page?.pageIndex === 'number') {
      pageIndexes.add(element.page.pageIndex)
    }
  }

  const pageCount = response.metrics?.pagesProcessed ?? pageIndexes.size
  const typeSummary = Object.entries(typeCounts)
    .map(([type, count]) => `${type}: ${count}`)
    .join(', ')

  return [
    `Extracted ${elements.length} elements across ${pageCount} page(s) and wrote the full spatial JSON to ${outputPath} (${byteLength} bytes).`,
    `Element types: ${typeSummary || 'none'}.`,
    `Low-confidence elements (confidence <= ${LOW_CONFIDENCE_THRESHOLD}): ${lowConfidence}` +
      `${lowConfidence > 0 ? ` — retrieve exactly these with query_extraction using maxConfidence: ${LOW_CONFIDENCE_THRESHOLD}` : ''}.`,
    `Retrieve specific elements with query_extraction (filter by page, region, minConfidence, maxConfidence, or elementTypes). The document content is not included here.`,
  ].join('\n')
}

/** Writes `data` to `resolvedPath`, creating parent directories as needed. */
export async function writeToResolvedPath(resolvedPath: string, data: string): Promise<void> {
  const outputDir = path.dirname(resolvedPath)
  try {
    await fs.promises.access(outputDir)
  } catch {
    await fs.promises.mkdir(outputDir, { recursive: true })
  }
  await fs.promises.writeFile(resolvedPath, data)
}

export const SAME_PATH_ERROR =
  'Error: outputPath must be different from the input filePath — writing the extraction there would destroy the source document.'

/**
 * Renders a write failure that happened *after* the extraction succeeded and was
 * billed. A bare filesystem error reads as a failed call, so the agent retries
 * and pays for the same extraction twice.
 */
export function billedWriteFailure(resolvedPath: string, error: unknown): CallToolResult {
  return createErrorResponse(
    `Error: the extraction succeeded and was billed, but writing the result to ${resolvedPath} failed: ` +
      `${error instanceof Error ? error.message : String(error)}. ` +
      'Retrying the extraction will be billed again — free up space or pass a different outputPath.',
  )
}

/**
 * Calls the Nutrient DWS Data Extraction API (`POST /extraction/parse`).
 *
 * Spatial output is written to `outputPath` and summarized inline; markdown
 * output is returned inline (or written to `outputPath` when given). When
 * both are requested, the spatial file is written and the summary also notes
 * the markdown that landed alongside it under `output.markdown`.
 */
export async function performExtractCall(args: DataExtractorArgs, apiClient: DwsApiClient): Promise<CallToolResult> {
  const {
    filePath,
    url,
    mode,
    format,
    formats,
    language,
    maxLanguages,
    maxScripts,
    includeWords,
    useHtmlTables,
    enableSemanticBlockFormatting,
    includeHeadersAndFooters,
    extractWordsFromPictures,
    storeRun,
    outputPath,
  } = args

  if (filePath && url) {
    return createErrorResponse('Error: provide exactly one of filePath or url, not both.')
  }
  if (!filePath && !url) {
    return createErrorResponse('Error: provide exactly one of filePath or url.')
  }
  if (format && formats) {
    return createErrorResponse(
      'Error: provide only one of format or formats — the Data Extraction API rejects a request with both set.',
    )
  }
  if (language !== undefined && (maxLanguages !== undefined || maxScripts !== undefined)) {
    return createErrorResponse(
      'Error: maxLanguages and maxScripts only apply when language is left unset (auto-detect). Remove language, or drop these options.',
    )
  }
  if (mode === 'text' && (maxLanguages !== undefined || maxScripts !== undefined)) {
    return createErrorResponse(
      'Error: maxLanguages and maxScripts tune OCR language auto-detection, which text mode does not perform. ' +
        'Drop them, or use structure/understand/agentic.',
    )
  }

  const resolvedFormats = resolveFormats(mode, format, formats)
  const formatSet = new Set(resolvedFormats)

  if (mode === 'text' && formatSet.has('spatial')) {
    return createErrorResponse(
      'Error: text mode only supports markdown output. Use a different mode for spatial output.',
    )
  }
  if (formatSet.has('spatial') && !outputPath) {
    return createErrorResponse(
      'Error: spatial output requires outputPath — the element list can be large and is written to a file, ' +
        'then queried with query_extraction.',
    )
  }

  // Resolve any provided output path first (fail early on a sandbox escape,
  // before the API call). Required for spatial, optional for markdown.
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

  const output: Record<string, unknown> =
    resolvedFormats.length === 1 ? { format: resolvedFormats[0] } : { formats: resolvedFormats }
  if (formatSet.has('spatial') && includeWords !== undefined) {
    output.includeWords = includeWords
  }
  if (formatSet.has('markdown')) {
    // Markdown-only knobs: send only when the caller set them, never a zod
    // default — useHtmlTables/enableSemanticBlockFormatting default to true
    // server-side, so sending an implicit `false` would silently change output.
    if (useHtmlTables !== undefined) output.useHtmlTables = useHtmlTables
    if (enableSemanticBlockFormatting !== undefined)
      output.enableSemanticBlockFormatting = enableSemanticBlockFormatting
    if (includeHeadersAndFooters !== undefined) output.includeHeadersAndFooters = includeHeadersAndFooters
    if (extractWordsFromPictures !== undefined) output.extractWordsFromPictures = extractWordsFromPictures
  }

  const instructions: Record<string, unknown> = { mode, storeRun, output }
  if (mode !== 'text') {
    const options: Record<string, unknown> = {}
    if (language !== undefined) options.language = language
    if (maxLanguages !== undefined) options.maxLanguages = maxLanguages
    if (maxScripts !== undefined) options.maxScripts = maxScripts
    if (Object.keys(options).length > 0) {
      instructions.options = options
    }
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
      response = await apiClient.post(EXTRACTION_ENDPOINT, form, EXTRACTION_HEADERS)
    } else {
      response = await apiClient.post(EXTRACTION_ENDPOINT, { ...instructions, url }, EXTRACTION_HEADERS)
    }
    body = await pipeToString(response.data)
  } catch (error) {
    return handleExtractionApiError(error, PARSE_CHEAPER_MODE_HINT)
  }

  let parsed: ExtractionResponse
  try {
    parsed = JSON.parse(body) as ExtractionResponse
  } catch {
    return createErrorResponse('Error: the Data Extraction API returned a response that could not be parsed as JSON.')
  }

  const runMetadata = formatRunMetadata(parsed)

  if (formatSet.has('spatial') && resolvedOutputPath) {
    // Guard against a 2xx response that is not a spatial result, so we never
    // overwrite the target file with a non-extraction body.
    if (!Array.isArray(parsed.output?.elements)) {
      return createErrorResponse(
        'Error: the Data Extraction API response did not contain a spatial element list (output.elements). Nothing was written.',
      )
    }
    // Validate every requested format before writing, so an incomplete
    // response never leaves a file on disk behind an error result — the
    // caller would retry and be billed for the extraction twice.
    const markdown = formatSet.has('markdown') ? parsed.output?.markdown : undefined
    if (formatSet.has('markdown') && typeof markdown !== 'string') {
      return createErrorResponse(
        'Error: the Data Extraction API did not return markdown output alongside the spatial result. Nothing was written.',
      )
    }
    // Write the raw response body: avoids re-serializing a potentially large
    // payload and preserves every field the API returned. When markdown was
    // also requested, that same body already carries output.markdown.
    try {
      await writeToResolvedPath(resolvedOutputPath, body)
    } catch (error) {
      return billedWriteFailure(resolvedOutputPath, error)
    }
    let summary = summarizeSpatial(parsed, resolvedOutputPath, Buffer.byteLength(body))
    if (typeof markdown === 'string') {
      summary += `\nAlso wrote ${Buffer.byteLength(markdown)} bytes of Markdown to the same file, under output.markdown.`
    }
    return createSuccessResponse(summary + runMetadata)
  }

  // Markdown-only.
  const markdown = parsed.output?.markdown
  if (typeof markdown !== 'string') {
    return createErrorResponse('Error: the Data Extraction API did not return markdown output.')
  }
  // Honor outputPath for markdown too — a large document returned inline
  // would overflow the conversation. Only return inline when no path given.
  if (resolvedOutputPath) {
    try {
      await writeToResolvedPath(resolvedOutputPath, markdown)
    } catch (error) {
      return billedWriteFailure(resolvedOutputPath, error)
    }
    return createSuccessResponse(
      `Wrote ${Buffer.byteLength(markdown)} bytes of Markdown to ${resolvedOutputPath}.${runMetadata}`,
    )
  }
  return createSuccessResponse(markdown + runMetadata)
}

/** Does element `bounds` intersect the query `region`? */
function intersects(bounds: SpatialElement['bounds'], region: NonNullable<QueryExtractionArgs['region']>): boolean {
  if (!bounds) {
    return false
  }
  const right = bounds.x + bounds.width
  const bottom = bounds.y + bounds.height
  const regionRight = region.x + region.width
  const regionBottom = region.y + region.height
  return !(right < region.x || bounds.x > regionRight || bottom < region.y || bounds.y > regionBottom)
}

/**
 * Reads a spatial extraction file produced by `data_extractor` and returns the
 * subset of elements matching the given filters, inline.
 */
export async function performQueryCall(args: QueryExtractionArgs): Promise<CallToolResult> {
  const { filePath, pages, region, minConfidence, maxConfidence, elementTypes, limit } = args

  if (typeof minConfidence === 'number' && typeof maxConfidence === 'number' && minConfidence > maxConfidence) {
    return createErrorResponse(
      `Error: minConfidence (${minConfidence}) must be less than or equal to maxConfidence (${maxConfidence}) — no element can match both.`,
    )
  }

  let parsed: ExtractionResponse
  try {
    const resolvedPath = await resolveReadFilePath(filePath)
    const body = await fs.promises.readFile(resolvedPath, 'utf-8')
    parsed = JSON.parse(body) as ExtractionResponse
  } catch (error) {
    return createErrorResponse(
      `Error reading extraction file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const elements = parsed.output?.elements
  if (!Array.isArray(elements)) {
    return createErrorResponse(
      'Error: this file does not look like a spatial extraction result (no output.elements array). ' +
        'Produce one with data_extractor using format: spatial.',
    )
  }

  const pageSet = pages ? new Set(pages) : undefined
  const typeSet = elementTypes ? new Set<string>(elementTypes) : undefined
  const filtersByConfidence = typeof minConfidence === 'number' || typeof maxConfidence === 'number'

  const matches = elements.filter((element) => {
    if (pageSet && (typeof element.page?.pageIndex !== 'number' || !pageSet.has(element.page.pageIndex))) {
      return false
    }
    if (typeSet && (typeof element.type !== 'string' || !typeSet.has(element.type))) {
      return false
    }
    if (filtersByConfidence) {
      // An element the API scored no confidence for cannot be placed inside a
      // confidence bound either way, so a bounded query excludes it.
      if (typeof element.confidence !== 'number') {
        return false
      }
      if (typeof minConfidence === 'number' && element.confidence < minConfidence) {
        return false
      }
      if (typeof maxConfidence === 'number' && element.confidence > maxConfidence) {
        return false
      }
    }
    if (region && !intersects(element.bounds, region)) {
      return false
    }
    return true
  })

  const limited = matches.slice(0, limit)
  const truncatedNote =
    matches.length > limited.length
      ? `\n\nShowing the first ${limited.length} of ${matches.length} matches. Narrow the filters (page, region, minConfidence, maxConfidence, elementTypes) to see the rest.`
      : ''

  return createSuccessResponse(
    `${limited.length} matching element(s):\n${JSON.stringify(limited, null, 2)}${truncatedNote}`,
  )
}
