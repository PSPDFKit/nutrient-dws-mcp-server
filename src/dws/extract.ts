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
}

/** text mode only supports markdown; every other mode defaults to spatial. */
function resolveFormat(mode: DataExtractorArgs['mode'], format: DataExtractorArgs['format']): 'spatial' | 'markdown' {
  if (format) {
    return format
  }
  return mode === 'text' ? 'markdown' : 'spatial'
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
    if (typeof element.confidence === 'number' && element.confidence < LOW_CONFIDENCE_THRESHOLD) {
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
    `Low-confidence elements (confidence < ${LOW_CONFIDENCE_THRESHOLD}): ${lowConfidence}.`,
    `Retrieve specific elements with query_extraction (filter by page, region, minConfidence, or elementTypes). The document content is not included here.`,
  ].join('\n')
}

/**
 * Calls the Nutrient DWS Data Extraction API (`POST /extraction/parse`).
 *
 * Spatial output is written to `outputPath` and summarized inline; markdown
 * output is returned inline.
 */
export async function performExtractCall(
  args: DataExtractorArgs,
  extractionApiClient: DwsApiClient | undefined,
): Promise<CallToolResult> {
  if (!extractionApiClient) {
    return createErrorResponse(
      'Error: Data Extraction is not configured. Set the NUTRIENT_EXTRACTION_API_KEY environment variable ' +
        '(a Data Extraction API key from the Nutrient dashboard, starting with pdf_live_ or pdf_test_).',
    )
  }

  const { filePath, mode, language, includeWords, outputPath } = args
  const format = resolveFormat(mode, args.format)

  if (mode === 'text' && format === 'spatial') {
    return createErrorResponse(
      'Error: text mode only supports markdown output. Use a different mode for spatial output.',
    )
  }

  if (format === 'spatial' && !outputPath) {
    return createErrorResponse(
      'Error: spatial output requires outputPath — the element list can be large and is written to a file, ' +
        'then queried with query_extraction.',
    )
  }

  // Resolve the output path first (fail early on a sandbox escape, before any API call).
  let resolvedOutputPath: string | undefined
  if (format === 'spatial' && outputPath) {
    try {
      resolvedOutputPath = await resolveWriteFilePath(outputPath)
    } catch (error) {
      return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let fileBuffer: Buffer
  let fileName: string
  try {
    const resolvedInputPath = await resolveReadFilePath(filePath)
    fileBuffer = await fs.promises.readFile(resolvedInputPath)
    fileName = path.basename(resolvedInputPath)
  } catch (error) {
    return createErrorResponse(
      `Error with input file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const instructions: Record<string, unknown> = {
    mode,
    output: format === 'spatial' ? { format, includeWords: includeWords ?? false } : { format },
  }
  if (language && mode !== 'text') {
    instructions.options = { language }
  }

  try {
    const form = new FormData()
    form.append('file', fileBuffer, { filename: fileName })
    form.append('instructions', JSON.stringify(instructions))

    const response = await extractionApiClient.post(EXTRACTION_ENDPOINT, form)
    const body = await pipeToString(response.data)

    let parsed: ExtractionResponse
    try {
      parsed = JSON.parse(body) as ExtractionResponse
    } catch {
      return createErrorResponse('Error: the Data Extraction API returned a response that could not be parsed as JSON.')
    }

    if (format === 'markdown') {
      const markdown = parsed.output?.markdown
      if (typeof markdown !== 'string') {
        return createErrorResponse('Error: the Data Extraction API did not return markdown output.')
      }
      return createSuccessResponse(markdown)
    }

    // Spatial: write the full result to disk, return a content-free summary.
    const outputDir = path.dirname(resolvedOutputPath as string)
    try {
      await fs.promises.access(outputDir)
    } catch {
      await fs.promises.mkdir(outputDir, { recursive: true })
    }
    const json = JSON.stringify(parsed, null, 2)
    await fs.promises.writeFile(resolvedOutputPath as string, json)

    return createSuccessResponse(summarizeSpatial(parsed, resolvedOutputPath as string, Buffer.byteLength(json)))
  } catch (error) {
    return handleApiError(error)
  }
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
  const { filePath, pages, region, minConfidence, elementTypes, limit } = args

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

  const pageSet = pages && pages.length > 0 ? new Set(pages) : undefined
  const typeSet = elementTypes && elementTypes.length > 0 ? new Set<string>(elementTypes) : undefined

  const matches = elements.filter((element) => {
    if (pageSet && (typeof element.page?.pageIndex !== 'number' || !pageSet.has(element.page.pageIndex))) {
      return false
    }
    if (typeSet && (typeof element.type !== 'string' || !typeSet.has(element.type))) {
      return false
    }
    if (
      typeof minConfidence === 'number' &&
      !(typeof element.confidence === 'number' && element.confidence >= minConfidence)
    ) {
      return false
    }
    if (region && !intersects(element.bounds, region)) {
      return false
    }
    return true
  })

  const limited = matches.slice(0, limit)
  const truncatedNote =
    matches.length > limited.length
      ? `\n\nShowing the first ${limited.length} of ${matches.length} matches. Narrow the filters (page, region, minConfidence, elementTypes) to see the rest.`
      : ''

  return createSuccessResponse(
    `${limited.length} matching element(s):\n${JSON.stringify(limited, null, 2)}${truncatedNote}`,
  )
}
