import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { DwsApiClient } from './dws/client.js'
import { performAiRedactCall } from './dws/ai-redact.js'
import { performBuildCall } from './dws/build.js'
import { performCheckCreditsCall } from './dws/credits.js'
import { performExtractFieldsCall } from './dws/extract.js'
import { performParseDocumentCall } from './dws/parse.js'
import { performSignCall } from './dws/sign.js'
import { performDirectoryTreeCall } from './fs/directoryTree.js'
import { createErrorResponse } from './responses.js'
import {
  AiRedactArgsSchema,
  BuildAPIArgsSchema,
  CheckCreditsArgsSchema,
  DirectoryTreeArgsSchema,
  ExtractFieldsArgsSchema,
  ParseDocumentArgsSchema,
  SignAPIArgsSchema,
  type AiRedactArgs,
  type BuildAPIArgs,
  type ExtractFieldsArgs,
  type ParseDocumentArgs,
  type SignAPIArgs,
} from './schemas.js'

/** Returned when no Data Extraction credential is configured (fail fast, no API call). */
const EXTRACT_CLIENT_MISSING_ERROR =
  'Error: Data Extraction is a separate product whose static API key is bound to its own tenant — the Processor key ' +
  '(NUTRIENT_DWS_API_KEY) cannot be reused here. Set NUTRIENT_DWS_EXTRACTION_API_KEY to a Data Extraction API key from ' +
  'the dashboard (starts with pdf_live_), or omit NUTRIENT_DWS_API_KEY entirely to authenticate via OAuth, which ' +
  'covers both products with one token.'

/** Returned by Processor operations when only a Data Extraction credential is configured. */
const PROCESSOR_CLIENT_MISSING_ERROR =
  'Error: This server was started with only a Data Extraction API key configured, so the Processor tools ' +
  '(document_processor, document_signer, ai_redactor, check_credits) are unavailable. Set NUTRIENT_DWS_API_KEY to ' +
  'a Processor API key from the dashboard, or omit all API keys entirely to authenticate via OAuth, which covers ' +
  'both products with one token.'

export const TOOL_INPUT_SCHEMAS = {
  document_processor: BuildAPIArgsSchema,
  document_signer: SignAPIArgsSchema,
  ai_redactor: AiRedactArgsSchema,
  check_credits: CheckCreditsArgsSchema,
  parse_document: ParseDocumentArgsSchema,
  extract_fields: ExtractFieldsArgsSchema,
  sandbox_file_tree: CheckCreditsArgsSchema,
  directory_tree: DirectoryTreeArgsSchema,
} as const

export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS

export const TOOL_NAMES = Object.freeze(Object.keys(TOOL_INPUT_SCHEMAS) as ToolName[])

export function isToolName(value: string): value is ToolName {
  return value in TOOL_INPUT_SCHEMAS
}

export type ExecuteToolOptions = {
  apiClient: DwsApiClient
  startupReady?: Promise<void>
}

function invalidInputResponse(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): CallToolResult {
  const details = error.issues
    .map(({ path, message }) => `${path.length > 0 ? path.join('.') : 'input'}: ${message}`)
    .join('; ')
  return createErrorResponse(`Invalid input: ${details}`)
}

/**
 * Validates and executes one Nutrient operation without depending on an MCP transport.
 * Both the MCP server and the standalone CLI call this function so authentication,
 * validation, sandboxing, and API behavior stay in parity.
 */
export async function executeTool(
  name: ToolName,
  input: unknown,
  options: ExecuteToolOptions,
): Promise<CallToolResult> {
  await (options.startupReady ?? Promise.resolve())

  if (
    (name === 'document_processor' ||
      name === 'document_signer' ||
      name === 'ai_redactor' ||
      name === 'check_credits') &&
    !options.apiClient.supports('processor')
  ) {
    return createErrorResponse(PROCESSOR_CLIENT_MISSING_ERROR)
  }
  if ((name === 'parse_document' || name === 'extract_fields') && !options.apiClient.supports('extraction')) {
    return createErrorResponse(EXTRACT_CLIENT_MISSING_ERROR)
  }

  const parsed = TOOL_INPUT_SCHEMAS[name].safeParse(input)
  if (!parsed.success) {
    return invalidInputResponse(parsed.error)
  }

  try {
    switch (name) {
      case 'document_processor': {
        const { instructions, outputPath } = parsed.data as BuildAPIArgs
        return await performBuildCall(instructions, outputPath, options.apiClient)
      }
      case 'document_signer': {
        const { filePath, signatureOptions, watermarkImagePath, graphicImagePath, outputPath } =
          parsed.data as SignAPIArgs
        return await performSignCall(
          filePath,
          outputPath,
          options.apiClient,
          signatureOptions,
          watermarkImagePath,
          graphicImagePath,
        )
      }
      case 'ai_redactor': {
        const { filePath, criteria, outputPath, stage, apply } = parsed.data as AiRedactArgs
        return await performAiRedactCall(filePath, criteria, outputPath, options.apiClient, stage, apply)
      }
      case 'check_credits':
        return await performCheckCreditsCall(options.apiClient)
      case 'parse_document':
        return await performParseDocumentCall(parsed.data as ParseDocumentArgs, options.apiClient)
      case 'extract_fields':
        return await performExtractFieldsCall(parsed.data as ExtractFieldsArgs, options.apiClient)
      case 'sandbox_file_tree':
        return await performDirectoryTreeCall('.')
      case 'directory_tree':
        return await performDirectoryTreeCall((parsed.data as { path: string }).path)
    }
  } catch (error) {
    return createErrorResponse(`Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}
