import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export type WorkflowPromptArgument = {
  name: string
  description: string
  required: boolean
}

export type WorkflowPromptToolStep = {
  tool: string
  argumentKeys: string[]
}

export type WorkflowPromptDefinition = {
  name: string
  title: string
  description: string
  arguments: WorkflowPromptArgument[]
  toolSequence: WorkflowPromptToolStep[]
  template: string
}

const SANDBOX_PATH_SENTENCE = 'Paths resolve inside the sandbox directory when one is configured.'

export const WORKFLOW_PROMPTS: WorkflowPromptDefinition[] = [
  {
    name: 'sign_and_watermark',
    title: 'Sign and Watermark a Document',
    description: 'Add a text watermark to a document, then digitally sign the watermarked PDF.',
    arguments: [
      { name: 'input_path', description: 'Path to the document to watermark and sign.', required: true },
      { name: 'output_path', description: 'Path for the final signed PDF.', required: true },
      { name: 'watermark_text', description: 'Text to place in the watermark.', required: true },
    ],
    toolSequence: [
      { tool: 'document_processor', argumentKeys: ['instructions', 'outputPath'] },
      { tool: 'document_signer', argumentKeys: ['filePath', 'outputPath'] },
    ],
    template: [
      'Watermark ${arguments.input_path} with "${arguments.watermark_text}", then digitally sign it and save the final PDF to ${arguments.output_path}.',
      'Use an intermediate path formed by appending ".watermarked.pdf" to ${arguments.output_path}.',
      '1. Call document_processor with instructions = {"parts":[{"file":"${arguments.input_path}"}],"actions":[{"type":"watermark","watermarkType":"text","text":"${arguments.watermark_text}","width":"80%","height":"20%","opacity":0.3}],"output":{"type":"pdf"}} and outputPath = the intermediate path.',
      '2. Call document_signer with filePath = the intermediate path and outputPath = ${arguments.output_path}.',
      SANDBOX_PATH_SENTENCE,
    ].join('\n'),
  },
  {
    name: 'extract_document_fields',
    title: 'Extract Document Fields',
    description: 'Extract named fields from a document into a JSON object, optionally retaining citations in a file.',
    arguments: [
      { name: 'input_path', description: 'Path to the document to extract fields from.', required: true },
      { name: 'fields', description: 'Comma-separated field names to extract.', required: true },
      {
        name: 'output_path',
        description: 'Optional path for the full extraction response, including citations.',
        required: false,
      },
    ],
    toolSequence: [{ tool: 'extract_fields', argumentKeys: ['filePath', 'schema', 'mode', 'outputPath'] }],
    template: [
      'Extract these comma-separated fields from ${arguments.input_path}: ${arguments.fields}.',
      'Call extract_fields exactly once with filePath = ${arguments.input_path}, schema = a JSON object schema whose properties are the trimmed field names from "${arguments.fields}" and whose property values are {"type":"string"}, and mode = "understand".',
      'Use mode = "structure" instead only when the document is a clean scan and the cheaper option is preferred.',
      'If ${arguments.output_path} is non-empty, also pass outputPath = ${arguments.output_path}; otherwise omit outputPath.',
      SANDBOX_PATH_SENTENCE,
    ].join('\n'),
  },
  {
    name: 'redact_pii',
    title: 'Redact Personally Identifiable Information',
    description: 'Detect and permanently redact personally identifiable information from a document.',
    arguments: [
      { name: 'input_path', description: 'Path to the document to redact.', required: true },
      { name: 'output_path', description: 'Path for the permanently redacted document.', required: true },
      {
        name: 'entity_types',
        description: 'Optional sensitive entity types to redact; omit to use the tool default.',
        required: false,
      },
    ],
    toolSequence: [{ tool: 'ai_redactor', argumentKeys: ['filePath', 'criteria', 'outputPath'] }],
    template: [
      'Permanently redact personally identifiable information from ${arguments.input_path} and save it to ${arguments.output_path}.',
      'Call ai_redactor with filePath = ${arguments.input_path} and outputPath = ${arguments.output_path}.',
      'When entity_types is non-empty, pass criteria = "${arguments.entity_types}"; otherwise omit criteria to use the tool default entity set.',
      SANDBOX_PATH_SENTENCE,
    ].join('\n'),
  },
  {
    name: 'parse_for_rag',
    title: 'Parse a Document for RAG',
    description: 'Parse a document as Markdown for retrieval-augmented generation and search indexing.',
    arguments: [
      { name: 'input_path', description: 'Path to the document to parse.', required: true },
      { name: 'output_path', description: 'Path for the generated Markdown.', required: true },
    ],
    toolSequence: [{ tool: 'parse_document', argumentKeys: ['filePath', 'format', 'mode', 'outputPath'] }],
    template: [
      'Parse ${arguments.input_path} into Markdown for RAG and write it to ${arguments.output_path}.',
      'Call parse_document with filePath = ${arguments.input_path}, format = "markdown", mode = "text", and outputPath = ${arguments.output_path}.',
      'mode = "text" costs 1 credit per page and does no OCR; use mode = "structure" (1.5 credits per page, OCR) for scans, or omit mode to use the default "understand" (9 credits per page) for mixed or low-quality content.',
      SANDBOX_PATH_SENTENCE,
    ].join('\n'),
  },
  {
    name: 'office_to_pdfa',
    title: 'Convert an Office Document to PDF/A',
    description: 'Convert an Office document to an archival PDF/A file.',
    arguments: [
      { name: 'input_path', description: 'Path to the Office document to convert.', required: true },
      { name: 'output_path', description: 'Path for the generated PDF/A file.', required: true },
    ],
    toolSequence: [{ tool: 'document_processor', argumentKeys: ['instructions', 'outputPath'] }],
    template: [
      'Convert the Office document ${arguments.input_path} to PDF/A and save it to ${arguments.output_path}.',
      'Call document_processor with instructions = {"parts":[{"file":"${arguments.input_path}"}],"output":{"type":"pdfa"}} and outputPath = ${arguments.output_path}.',
      SANDBOX_PATH_SENTENCE,
    ].join('\n'),
  },
]

export function renderPromptText(prompt: WorkflowPromptDefinition, args: Record<string, string | undefined>): string {
  return prompt.template.replace(/\$\{arguments\.([a-z][a-z0-9_]*)\}/g, (_, name: string) => args[name] ?? '')
}

export function addPromptsToServer(server: McpServer): void {
  for (const prompt of WORKFLOW_PROMPTS) {
    const argsSchema: Record<string, z.ZodTypeAny> = {}

    for (const argument of prompt.arguments) {
      const schema = z.string().describe(argument.description)
      argsSchema[argument.name] = argument.required ? schema : schema.optional()
    }

    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema,
      },
      (args) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: renderPromptText(prompt, args),
            },
          },
        ],
      }),
    )
  }
}

export function manifestPromptsFromTable() {
  return WORKFLOW_PROMPTS.map((prompt) => ({
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments.map((argument) => argument.name),
    text: prompt.template,
  }))
}
