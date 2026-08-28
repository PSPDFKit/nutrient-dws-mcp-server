#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createApiClient } from './dws/api.js'
import type { DwsApiClient } from './dws/client.js'
import { setSandboxDirectory } from './fs/sandbox.js'
import { executeTool, type ToolName } from './tool-runner.js'
import { getEnvironment, type Environment } from './utils/environment.js'
import { getVersion } from './version.js'

const COMMAND_ALIASES = {
  process: 'document_processor',
  'document-processor': 'document_processor',
  document_processor: 'document_processor',
  sign: 'document_signer',
  'document-signer': 'document_signer',
  document_signer: 'document_signer',
  redact: 'ai_redactor',
  'ai-redactor': 'ai_redactor',
  ai_redactor: 'ai_redactor',
  credits: 'check_credits',
  'check-credits': 'check_credits',
  check_credits: 'check_credits',
  parse: 'parse_document',
  'parse-document': 'parse_document',
  parse_document: 'parse_document',
  extract: 'extract_fields',
  'extract-fields': 'extract_fields',
  extract_fields: 'extract_fields',
  files: 'file_tree',
  'file-tree': 'file_tree',
  file_tree: 'file_tree',
  sandbox_file_tree: 'sandbox_file_tree',
  directory_tree: 'directory_tree',
} as const

export function isCliCommand(value: string | undefined): boolean {
  return value === 'login' || (value !== undefined && value in COMMAND_ALIASES)
}

type CliOperation = (typeof COMMAND_ALIASES)[keyof typeof COMMAND_ALIASES]
type OutputFormat = 'text' | 'json'

export type ParsedCliArgs =
  | { action: 'help' }
  | { action: 'version' }
  | { action: 'login'; outputFormat: OutputFormat }
  | {
      action: 'run'
      operation: CliOperation
      inputFile?: string
      inlineJson?: string
      outputFormat: OutputFormat
      sandboxDir: string | null
    }

export class CliUsageError extends Error {}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (value === undefined) {
    throw new CliUsageError(`${flag} requires a value`)
  }
  return value
}

export function parseCliArgs(args: string[], environmentSandbox?: string): ParsedCliArgs {
  let command: string | undefined
  let inputFile: string | undefined
  let inlineJson: string | undefined
  let outputFormat: OutputFormat = 'text'
  let sandboxDir = environmentSandbox?.trim() || null

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--help' || arg === '-h') return { action: 'help' }
    if (arg === '--version' || arg === '-v') return { action: 'version' }

    if (arg === '--input' || arg === '-i') {
      inputFile = takeValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--json' || arg === '-j') {
      inlineJson = takeValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--sandbox' || arg === '-s') {
      sandboxDir = takeValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === '--format' || arg === '-f') {
      const value = takeValue(args, index, arg)
      if (value !== 'text' && value !== 'json') {
        throw new CliUsageError('--format must be either text or json')
      }
      outputFormat = value
      index += 1
      continue
    }
    if (arg.startsWith('-')) {
      throw new CliUsageError(`Unknown option: ${arg}`)
    }
    if (command) {
      throw new CliUsageError(`Unexpected argument: ${arg}`)
    }
    command = arg
  }

  if (!command) {
    return { action: 'help' }
  }
  if (inputFile && inlineJson) {
    throw new CliUsageError('Use only one of --input or --json')
  }
  if (command === 'login') {
    if (inputFile || inlineJson) {
      throw new CliUsageError('login does not accept JSON input')
    }
    return { action: 'login', outputFormat }
  }

  const operation = COMMAND_ALIASES[command as keyof typeof COMMAND_ALIASES]
  if (!operation) {
    throw new CliUsageError(`Unknown command: ${command}`)
  }

  return { action: 'run', operation, inputFile, inlineJson, outputFormat, sandboxDir }
}

const HELP = `Nutrient DWS CLI ${getVersion()}

Run Nutrient document operations without an MCP client.

Zero install:
  npx -y @nutrient-sdk/dws-mcp-server <command> [options]

Usage:
  nutrient-dws <command> [--input request.json | --json '{...}'] [options]
  cat request.json | nutrient-dws <command> [options]

Commands:
  login     Sign in with browser OAuth and cache credentials
  process   Convert, OCR, watermark, redact, and run page operations
  sign      Digitally sign a PDF
  redact    Detect and apply AI redactions
  parse     Parse a document to Markdown or spatial JSON
  extract   Extract schema-defined fields with citations
  credits   Show Processor API credit usage
  files     List files in the sandbox, or the current directory without one

The MCP names (document_processor, document_signer, ai_redactor,
parse_document, extract_fields, check_credits) are accepted as aliases.

Options:
  -i, --input <path>       Read the command's JSON object from a file; use - for stdin
  -j, --json <json>        Pass the command's JSON object inline
  -s, --sandbox <path>     Restrict file access (or set SANDBOX_PATH)
  -f, --format <format>    Output text (default) or the complete JSON result
  -h, --help               Show this help
  -v, --version            Show the version

Examples:
  nutrient-dws login
  nutrient-dws credits
  nutrient-dws files --sandbox ./documents
  nutrient-dws parse --sandbox ./documents --json \\
    '{"filePath":"invoice.pdf","mode":"text","format":"markdown"}'
  nutrient-dws process --sandbox ./documents --input build-request.json

Authentication:
  Omit API keys to sign in with browser OAuth on first API use. For CI, set
  NUTRIENT_DWS_API_KEY and, for parse/extract, NUTRIENT_DWS_EXTRACTION_API_KEY.
`

type ReadableInput = {
  isTTY?: boolean
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>
}

type WritableOutput = {
  write(chunk: string): unknown
}

async function readStream(stream: ReadableInput): Promise<string> {
  let data = ''
  for await (const chunk of stream) {
    data += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  }
  return data
}

async function parseJsonInput(options: {
  inputFile?: string
  inlineJson?: string
  stdin: ReadableInput
}): Promise<unknown> {
  let source: string | undefined
  let label = 'stdin'

  if (options.inlineJson !== undefined) {
    source = options.inlineJson
    label = '--json'
  } else if (options.inputFile !== undefined) {
    label = options.inputFile === '-' ? 'stdin' : options.inputFile
    source = options.inputFile === '-' ? await readStream(options.stdin) : await fs.readFile(options.inputFile, 'utf8')
  } else if (!options.stdin.isTTY) {
    source = await readStream(options.stdin)
  }

  if (source === undefined || source.trim() === '') {
    return {}
  }

  try {
    return JSON.parse(source) as unknown
  } catch (error) {
    throw new CliUsageError(`Could not parse JSON from ${label}: ${error instanceof Error ? error.message : error}`)
  }
}

function textContent(result: CallToolResult): string {
  return result.content
    .map((item) => {
      if (item.type === 'text') return item.text
      return JSON.stringify(item)
    })
    .join('\n')
}

function writeLine(output: WritableOutput, value: string): void {
  output.write(value.endsWith('\n') ? value : `${value}\n`)
}

export type RunCliOptions = {
  stdin?: ReadableInput
  stdout?: WritableOutput
  stderr?: WritableOutput
  environment?: Environment
  environmentVariables?: NodeJS.ProcessEnv
  apiClient?: DwsApiClient
  cwd?: string
}

export async function runCli(args: string[], options: RunCliOptions = {}): Promise<number> {
  const stdin = options.stdin ?? (process.stdin as ReadableInput)
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  const environmentVariables = options.environmentVariables ?? process.env

  let parsed: ParsedCliArgs
  try {
    parsed = parseCliArgs(args, environmentVariables.SANDBOX_PATH)
  } catch (error) {
    writeLine(stderr, `Error: ${error instanceof Error ? error.message : error}`)
    writeLine(stderr, 'Run nutrient-dws --help for usage.')
    return 2
  }

  if (parsed.action === 'help') {
    stdout.write(HELP)
    return 0
  }
  if (parsed.action === 'version') {
    writeLine(stdout, getVersion())
    return 0
  }

  let environment: Environment
  try {
    environment = options.environment ?? getEnvironment(environmentVariables)
  } catch (error) {
    writeLine(stderr, `Invalid environment configuration: ${error instanceof Error ? error.message : error}`)
    return 2
  }

  if (parsed.action === 'login') {
    const apiClient = options.apiClient ?? createApiClient(environment)
    const staticProducts = [
      apiClient.supports('processor') && environment.nutrientApiKey ? 'processor' : null,
      apiClient.supports('extraction') && environment.nutrientExtractionApiKey ? 'extraction' : null,
    ].filter((product): product is string => product !== null)

    if (staticProducts.length > 0) {
      const message = `Static API key authentication is configured for ${staticProducts.join(' and ')}; browser login is not needed.`
      if (parsed.outputFormat === 'json') {
        writeLine(stdout, JSON.stringify({ authenticated: true, method: 'api-key', products: staticProducts }, null, 2))
      } else {
        writeLine(stdout, message)
      }
      return 0
    }

    try {
      await apiClient.authenticate('processor')
    } catch (error) {
      writeLine(stderr, `Login failed: ${error instanceof Error ? error.message : error}`)
      return 1
    }

    if (parsed.outputFormat === 'json') {
      writeLine(stdout, JSON.stringify({ authenticated: true, method: 'oauth', cached: true }, null, 2))
    } else {
      writeLine(stdout, 'Signed in to Nutrient. Credentials are cached for future CLI and MCP requests.')
    }
    return 0
  }

  let input: unknown
  try {
    input = await parseJsonInput({ inputFile: parsed.inputFile, inlineJson: parsed.inlineJson, stdin })
  } catch (error) {
    writeLine(stderr, `Error: ${error instanceof Error ? error.message : error}`)
    return 2
  }

  try {
    await setSandboxDirectory(parsed.sandboxDir)
  } catch (error) {
    writeLine(stderr, `Error preparing sandbox: ${error instanceof Error ? error.message : error}`)
    return 2
  }

  let toolName: ToolName
  if (parsed.operation === 'file_tree') {
    if (parsed.sandboxDir) {
      toolName = 'sandbox_file_tree'
      input = {}
    } else {
      toolName = 'directory_tree'
      if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
        input = { path: options.cwd ?? process.cwd(), ...(input as Record<string, unknown>) }
      }
    }
  } else {
    toolName = parsed.operation
  }

  if (toolName === 'sandbox_file_tree' && !parsed.sandboxDir) {
    writeLine(stderr, 'Error: sandbox_file_tree requires --sandbox or SANDBOX_PATH.')
    return 2
  }

  const result = await executeTool(toolName, input, {
    apiClient: options.apiClient ?? createApiClient(environment),
  })

  if (parsed.outputFormat === 'json') {
    writeLine(result.isError ? stderr : stdout, JSON.stringify(result, null, 2))
  } else {
    writeLine(result.isError ? stderr : stdout, textContent(result))
  }

  return result.isError ? 1 : 0
}

function isMainModule(): boolean {
  const entryFile = process.argv[1]
  return Boolean(entryFile && resolve(fileURLToPath(import.meta.url)) === resolve(entryFile))
}

if (isMainModule()) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error) => {
      console.error(`Fatal CLI error: ${error instanceof Error ? error.message : error}`)
      process.exitCode = 2
    })
}
