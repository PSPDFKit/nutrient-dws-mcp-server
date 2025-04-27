import { z } from 'zod'

export const DirectoryTreeArgsSchema = z.object({
  path: z
    .string()
    .describe(
      'The path to the directory to analyze to find documents or files a user has referenced. Resolves to sandbox path if enabled, otherwise resolves to the local file system.',
    ),
})

export const RectSchema = z
  .array(z.number())
  .length(4)
  .describe('Rectangle in a form [left, top, width, height] in PDF points (1 PDF point equals 1⁄72 of an inch).')

export const PageRangeSchema = z
  .object({
    start: z.number().int().default(0).describe('Start page index (0-based). Default is 0 (first page).'),
    end: z
      .number()
      .int()
      .default(-1)
      .describe('End page index (0-based). Default is -1 (last page). Negative values count from the end.'),
  })
  .describe(
    'Defines the range of pages in a document. The indexing starts from 0. It is possible to use negative numbers to refer to pages from the last page. For example, `-1` refers to the last page.',
  )

export const SignatureAppearanceSchema = z.object({
  mode: z
    .enum(['signatureOnly', 'signatureAndDescription', 'descriptionOnly'])
    .default('signatureAndDescription')
    .describe('Specifies what will be rendered in the signature appearance: graphics, description, or both.'),
  contentType: z
    .string()
    .optional()
    .describe(
      'The content type of the watermark image when provided in the multipart request. Supported types are `application/pdf`, `image/png`, and `image/jpeg`.',
    ),
  showSigner: z
    .boolean()
    .default(true)
    .describe('Controls whether the signer name from signatureMetadata is shown in the signature appearance.'),
  showReason: z
    .boolean()
    .default(false)
    .describe('Controls whether the signing reason from signatureMetadata is shown in the signature appearance.'),
  showLocation: z
    .boolean()
    .default(false)
    .describe('Controls whether the signing location from signatureMetadata is shown in the signature appearance.'),
  showWatermark: z
    .boolean()
    .default(true)
    .describe('Controls whether to include the watermark in the signature appearance.'),
  showSignDate: z
    .boolean()
    .default(true)
    .describe('Controls whether to show the signing date and time in the signature appearance.'),
  showDateTimezone: z
    .boolean()
    .default(false)
    .describe('Controls whether to include the timezone in the signing date.'),
})

export const SignaturePositionSchema = z.object({
  pageIndex: z
    .number()
    .int()
    .min(0)
    .describe('The index of the page where the signature appearance will be rendered (0-based indexing).'),
  rect: RectSchema.describe('The bounding box where the signature appearance will be rendered.'),
})

export const SignatureMetadataSchema = z.object({
  signerName: z.string().optional().describe('The name of the person or organization signing the document.'),
  signatureReason: z.string().optional().describe('The reason for signing the document.'),
  signatureLocation: z
    .string()
    .optional()
    .describe('The geographical or digital location where the document is being signed.'),
})

export const CreateDigitalSignatureSchema = z.object({
  signatureType: z.enum(['cms', 'cades']).default('cms').describe('The signature type to create.'),
  flatten: z.boolean().default(false).describe('Controls whether to flatten the document before signing it.'),
  formFieldName: z
    .string()
    .optional()
    .describe('Name of the signature form field to sign. Use this when signing an existing signature form field.'),
  appearance: SignatureAppearanceSchema.optional().describe(
    'The appearance settings for the visible signature. Omit if you want an invisible signature to be created.',
  ),
  position: SignaturePositionSchema.optional().describe(
    'Position of the visible signature form field. Omit if you want an invisible signature or if you specified the formFieldName option.',
  ),
  signatureMetadata: SignatureMetadataSchema.optional().describe(
    'Optional metadata that describes the digital signature and becomes part of the signature itself.',
  ),
  cadesLevel: z
    .enum(['b-lt', 'b-t', 'b-b'])
    .default('b-lt')
    .optional()
    .describe('The CAdES level to use when creating the signature. The default value is CAdES B-LT.'),
})

export const SignAPIArgsSchema = z.object({
  filePath: z
    .string()
    .describe(
      'The path to the file to be signed. Resolves to sandbox path if enabled, otherwise resolves to the local file system.',
    ),
  signatureOptions: CreateDigitalSignatureSchema.optional().describe(
    'Options for creating the digital signature. If not provided, defaults will be used.',
  ),
  watermarkImagePath: z
    .string()
    .optional()
    .describe(
      "The path to the watermark image to be used as part of the signature's appearance. Optional. Resolves to sandbox path if enabled, otherwise resolves to the local file system.",
    ),
  graphicImagePath: z
    .string()
    .optional()
    .describe(
      "The path to the graphic image to be used as part of the signature's appearance. Optional. Resolves to sandbox path if enabled, otherwise resolves to the local file system.",
    ),
  outputPath: z
    .string()
    .describe(
      'A path to the output file to. Resolves to sandbox path if enabled, otherwise resolves to the local file system.',
    ),
})

export const FilePartSchema = z.object({
  file: z
    .string()
    .describe(
      'The path to the file to be processed. Resolves to sandbox path if enabled, otherwise resolves to the local file system.',
    ),
  password: z.string().optional().describe('The password for the input file if it is password-protected.'),
  pages: PageRangeSchema.optional().describe('Page range to include from the file (0-based indexing).'),
  content_type: z
    .string()
    .optional()
    .describe("Used to determine the file type when the file content type is not available and can't be inferred."),

  // For simplicity, we do not allow actions to be performed on individual parts. Instead, actions can be performed on the resulting parts output.
  // actions: z
  //   .array(z.lazy(() => BuildActionSchema))
  //   .optional()
  //   .describe('Actions to perform on this part.'),
})

export const ApplyXfdfActionSchema = z.object({
  type: z.literal('applyXfdf').describe('Apply the XFDF to the document to import annotations to a document.'),
  file: z
    .string()
    .describe(
      'The path to the XFDF file or a reference to a file in the multipart request. Resolves to sandbox path if enabled, otherwise resolves to the local file system.',
    ),
})

export const FlattenActionSchema = z.object({
  type: z.literal('flatten').describe('Flatten the annotations in the document.'),

  // It's unlikely that annotation IDs are known upfront, therefore, we won't support this in the flatten action.
  // annotationIds: z
  //   .array(z.union([z.string(), z.number()]))
  //   .optional()
  //   .describe(
  //     'Annotation IDs to flatten. These can be annotation IDs or pdfObjectIds. If not specified, all annotations will be flattened.',
  //   ),
})

export const OcrActionSchema = z.object({
  type: z.literal('ocr').describe('Perform optical character recognition (OCR) in the document.'),
  language: z.string().describe('Language to be used for the OCR text extraction.'),
})

export const RotateActionSchema = z.object({
  type: z.literal('rotate').describe('Rotate all pages by the angle specified.'),
  rotateBy: z
    .number()
    .describe('The angle by which the pages should be rotated, clockwise.')
    .refine((val) => [90, 180, 270].includes(val), {
      message: 'rotateBy must be one of: 90, 180, 270',
    }),
})

export const WatermarkDimensionSchema = z
  .union([
    z.number().describe('Value in points'),
    z
      .string()
      .regex(/^\d+%$/)
      .describe('Percentage value'),
  ])
  .describe('Dimension value in points or percentage')

export const BaseWatermarkPropertiesSchema = z.object({
  type: z.literal('watermark').describe('Watermark action.'),
  watermarkType: z.enum(['text', 'image']).describe('Type of the watermark.'),
  width: WatermarkDimensionSchema.describe('Width of the watermark.'),
  height: WatermarkDimensionSchema.describe('Height of the watermark.'),
  rotation: z.number().optional().default(0).describe('Rotation of the watermark in counterclockwise degrees.'),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Watermark opacity. 0 is fully transparent, 1 is fully opaque. 0.7 is a optimal value.'),
  text: z.string().optional().describe('Text used for watermarking'),
  fontColor: z.string().optional().describe('A hex color of the watermark text. ^#[0-9a-fA-F]{6}$'),
  image: z
    .string()
    .optional()
    .describe(
      'For image watermarks, the path to the image file or a reference to a file in the multipart request. Resolves to sandbox path if enabled, otherwise resolves to the local file system.',
    ),

  // For simplicity, we apply the watermark to the center of the page.
  // top: WatermarkDimensionSchema.optional().describe('Offset of the watermark from the top edge of a page.'),
  // right: WatermarkDimensionSchema.optional().describe('Offset of the watermark from the right edge of a page.'),
  // bottom: WatermarkDimensionSchema.optional().describe('Offset of the watermark from the bottom edge of a page.'),
  // left: WatermarkDimensionSchema.optional().describe('Offset of the watermark from the left edge of a page.'),

  // For simplicity, we do not support custom fonts.
  // fontFamily: z.string().optional().describe('The font to render the text.'),
  // fontSize: z.number().optional().describe('Size of the text in points.'),
  // fontStyle: z
  //   .array(z.enum(['bold', 'italic']))
  //   .optional()
  //   .describe('Text style. Can be only italic, only bold, italic and bold, or none of these.'),
})

export const SearchPresetSchema = z.enum([
  'credit-card-number',
  'date',
  'email-address',
  'international-phone-number',
  'ipv4',
  'ipv6',
  'mac-address',
  'north-american-phone-number',
  'social-security-number',
  'time',
  'url',
  'us-zip-code',
  'vin',
]).describe(`
  - credit-card-number — matches a number with 13 to 19 digits that begins with 1—6.
  Spaces and - are allowed anywhere in the number.
  - date — matches date formats such as mm/dd/yyyy, mm/dd/yy, dd/mm/yyyy, and dd/mm/yy.
  It rejects any days greater than 31 or months greater than 12 and accepts a leading 0 in front of a single-digit day or month.
  The delimiter can be -, ., or /.
  - email-address — matches an email address. Expects the format of *@*.* with at least two levels of the domain name.
  - international-phone-number — matches international phone numbers.
  The number can have 7 to 15 digits with spaces or - occurring anywhere within the number, and it must have prefix of + or 00.
  - ipv4 — matches an IPv4 address with an optional mask at the end.
  - ipv6 — matches a full and compressed IPv6 address as defined in RFC 2373.
  - mac-address — matches a MAC address with either - or : as a delimiter.
  - north-american-phone-number — matches North American-style phone numbers.
  NANPA standardization is used with international support.
  - social-security-number — matches a social security number.
  Expects the format of XXX-XX-XXXX or XXXXXXXXX, with X denoting digits.
  - time — matches time formats such as 00:00:00, 00:00, and 00:00 PM. 12- and 24-hour formats are allowed.
  Seconds and AM/PM denotation are both optional.
  - url — matches a URL with a prefix of http or https, with an optional subdomain.
  - us-zip-code — matches a USA-style zip code. The format expected is XXXXX, XXXXX-XXXX or XXXXX/XXXX.
  - vin — matches US and ISO Standard 3779 Vehicle Identification Number. 
  The format expects 17 characters, with the last 5 characters being numeric. I, i, O, o, Q, q, and _ characters are not allowed.
`)

const BaseStrategyOptionsSchema = z.object({
  includeAnnotations: z
    .boolean()
    .default(true)
    .describe(
      'Determines if redaction annotations are created on top of annotations whose content match the provided preset.',
    ),
  start: z.number().int().default(0).describe('The index of the page from where you want to start the search.'),
  limit: z
    .number()
    .int()
    .nullable()
    .default(null)
    .describe('Starting from start, the number of pages to search. Default is to the end of the document.'),
})

export const CreateRedactionsStrategyOptionsPresetSchema = BaseStrategyOptionsSchema.extend({
  preset: SearchPresetSchema,
})

export const CreateRedactionsStrategyOptionsRegexSchema = BaseStrategyOptionsSchema.extend({
  regex: z.string().describe('Regex search term used for searching for text to redact.'),
  caseSensitive: z.boolean().default(true).describe('Determines if the search will be case sensitive.'),
})

export const CreateRedactionsStrategyOptionsTextSchema = BaseStrategyOptionsSchema.extend({
  text: z.string().describe('Search term used for searching for text to redact.'),
  caseSensitive: z.boolean().default(false).describe('Determines if the search will be case sensitive.'),
})

export const CreateRedactionsActionSchema = z.object({
  type: z
    .literal('createRedactions')
    .describe(
      'Creates redactions according to the given strategy. Once redactions are created, they need to be applied using the applyRedactions action.',
    ),
  strategy: z.enum(['preset', 'regex', 'text']).describe('The strategy to use for creating redactions.'),
  strategyOptions: z
    .union([
      CreateRedactionsStrategyOptionsPresetSchema,
      CreateRedactionsStrategyOptionsRegexSchema,
      CreateRedactionsStrategyOptionsTextSchema,
    ])
    .describe('Options for the selected strategy.'),
})

export const ApplyRedactionsActionSchema = z.object({
  type: z.literal('applyRedactions').describe('Applies the redactions created by an earlier createRedactions action.'),
})

export const BuildActionSchema = z.discriminatedUnion('type', [
  // For now, we will not support applying Instant JSON.
  // ApplyInstantJsonActionSchema,
  ApplyXfdfActionSchema,
  FlattenActionSchema,
  OcrActionSchema,
  RotateActionSchema,
  BaseWatermarkPropertiesSchema,
  CreateRedactionsActionSchema,
  ApplyRedactionsActionSchema,
])

export const MetadataSchema = z.object({
  title: z.string().optional().describe('The document title.'),
  author: z.string().optional().describe('The document author.'),
})

export const LabelSchema = z.object({
  pages: PageRangeSchema.describe('Page range to apply the label to (0-based indexing).'),
  label: z.string().describe('The label to apply to specified pages.'),
})

export const OptimizePdfSchema = z.object({
  grayscaleText: z.boolean().optional().default(false).describe('Convert text to grayscale.'),
  grayscaleGraphics: z.boolean().optional().default(false).describe('Convert graphics to grayscale.'),
  grayscaleImages: z.boolean().optional().default(false).describe('Convert images to grayscale.'),
  grayscaleFormFields: z.boolean().optional().default(false).describe('Convert form fields to grayscale.'),
  grayscaleAnnotations: z.boolean().optional().default(false).describe('Convert annotations to grayscale.'),
  disableImages: z.boolean().optional().default(false).describe('Disable images in the document.'),
  mrcCompression: z.boolean().optional().default(false).describe('Use MRC compression.'),
  imageOptimizationQuality: z.number().min(1).max(4).default(2).describe('Image optimization quality.'),
  linearize: z.boolean().optional().default(false).describe('Linearize the PDF for faster loading over the network.'),
})

export const BasePDFOutputSchema = z.object({
  metadata: MetadataSchema.optional().describe('Document metadata.'),
  labels: z.array(LabelSchema).optional().describe('Page labels.'),
  user_password: z.string().optional().describe('Password required to open the document.'),
  owner_password: z.string().optional().describe('Password required to modify the document.'),
  user_permissions: z
    .array(
      z.enum([
        'printing',
        'modification',
        'extract',
        'annotations_and_forms',
        'fill_forms',
        'extract_accessibility',
        'assemble',
        'print_high_quality',
      ]),
    )
    .optional()
    .describe('Permissions granted when the document is opened with the user password.'),
  optimize: OptimizePdfSchema.optional().describe('PDF optimization options.'),
})

export const PDFOutputSchema = BasePDFOutputSchema.extend({
  type: z.literal('pdf').describe('Output as standard PDF.'),
})

export const PDFAOutputSchema = BasePDFOutputSchema.extend({
  type: z.literal('pdfa').describe('Output as PDF/A for archiving.'),
  conformance: z
    .enum(['pdfa-1a', 'pdfa-1b', 'pdfa-2a', 'pdfa-2u', 'pdfa-2b', 'pdfa-3a', 'pdfa-3u'])
    .optional()
    .describe('PDF/A conformance level.'),
  vectorization: z
    .boolean()
    .optional()
    .default(true)
    .describe('Produce vector-based graphic elements where applicable.'),
  rasterization: z
    .boolean()
    .optional()
    .default(true)
    .describe('Produce raster-based graphic elements where applicable.'),
})

export const ImageOutputSchema = z.object({
  type: z.literal('image').describe('Output as image.'),
  format: z.enum(['png', 'jpeg', 'jpg', 'webp']).optional().default('png').describe('Image format.'),
  pages: PageRangeSchema.optional().describe('Page range to render (0-based indexing).'),
  width: z
    .number()
    .optional()
    .describe('Width of the rendered image in pixels Only one of width, height, or dpi can be defined.'),
  height: z
    .number()
    .optional()
    .describe('Height of the rendered image in pixels. Only one of width, height, or dpi can be defined.'),
  dpi: z
    .number()
    .optional()
    .describe('Resolution of the rendered image in dots per inch. Only one of width, height, or dpi can be defined.'),
})

export const JSONContentOutputSchema = z.object({
  type: z.literal('json-content').describe('Output as JSON with document contents.'),
  // We try to hint to the LLM to use one of the following at a time to reduce context length.
  plainText: z
    .boolean()
    .optional()
    .default(true)
    .describe('Extract document text. Use one of `plainText`, `keyValuePairs`, or `tables`. at a time.'),
  keyValuePairs: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Extract key-value pairs from the document. Use one of `plainText`, `keyValuePairs`, or `tables`. at a time.',
    ),
  tables: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Extract tabular data from the document. Use one of `plainText`, `keyValuePairs`, or `tables`. at a time.',
    ),
  language: z
    .union([
      z.string().describe('Language for OCR text extraction.'),
      z.array(z.string()).describe('Languages for OCR text extraction.'),
    ])
    .optional(),

  // Structure text uses many chars, and often overflows the context length of an LLM. We will not support this for now.
  // structuredText: z.boolean().optional().default(false).describe('Extracts text with positional data.'),
})

export const OfficeOutputSchema = z.object({
  type: z.enum(['docx', 'xlsx', 'pptx']).describe('Output as Office document.'),
})

export const BuildOutputSchema = z.discriminatedUnion('type', [
  PDFOutputSchema,
  PDFAOutputSchema,
  ImageOutputSchema,
  JSONContentOutputSchema,
  OfficeOutputSchema,
])

const InstructionsSchema = z.object({
  parts: z.array(FilePartSchema).describe('Parts of the document to be built.'),
  actions: z
    .array(BuildActionSchema)
    .optional()
    .describe('Actions to be performed on the document after it is built from the parts.'),
  output: BuildOutputSchema.optional().describe(
    'Output format configuration. Supports PDF, PDF/A, image, JSON content, and Office document formats.',
  ),
})

export const BuildAPIArgsSchema = z.object({
  instructions: InstructionsSchema.describe('Build instructions.'),
  outputPath: z
    .string()
    .describe(
      'A path to the output file to. (if required) Resolves to sandbox path if enabled, otherwise resolves to the local file system.',
    ),
})

export type BuildAPIArgs = z.infer<typeof BuildAPIArgsSchema>
export type Instructions = z.infer<typeof InstructionsSchema>
export type Action = z.infer<typeof BuildActionSchema>

export type SignAPIArgs = z.infer<typeof SignAPIArgsSchema>
export type SignatureOptions = z.infer<typeof CreateDigitalSignatureSchema>
