import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as examples from './build-api-examples.js'
import { config as dotenvConfig } from 'dotenv'
import path from 'path'
import { performBuildCall } from '../src/dws/build.js'
import { BuildAPIArgs } from '../src/schemas.js'
import { setSandboxDirectory } from '../src/fs/sandbox.js'

dotenvConfig()

describe('performBuildCall with build-api-examples', () => {
  let outputDirectory: string
  beforeAll(async () => {
    const assetsDir = path.join(__dirname, `assets`)
    await setSandboxDirectory(assetsDir)

    outputDirectory = `test-output-${new Date().toISOString().replace(/[:.]/g, '-')}`
  })

  afterEach(async () => {
    // A naive way to do rate limiting.
    return await new Promise((resolve) => setTimeout(resolve, 10000))
  }, 20000)

  const fileOutputExamples: { name: string; example: BuildAPIArgs }[] = [
    { name: 'basicPdfExample', example: examples.basicPdfExample },
    { name: 'passwordProtectedPdfExample', example: examples.passwordProtectedPdfExample },
    { name: 'pdfaConversionExample', example: examples.pdfaConversionExample },
    { name: 'imageConversionExample', example: examples.imageConversionExample },
    { name: 'officeConversionExample', example: examples.officeConversionExample },
    { name: 'multiplePartsExample', example: examples.multiplePartsExample },
    { name: 'ocrActionExample', example: examples.ocrActionExample },
    { name: 'rotationActionExample', example: examples.rotationActionExample },
    { name: 'textWatermarkExample', example: examples.textWatermarkExample },
    { name: 'imageWatermarkExample', example: examples.imageWatermarkExample },
    { name: 'flattenAnnotationsExample', example: examples.flattenAnnotationsExample },
    { name: 'applyXfdfExample', example: examples.applyXfdfExample },
    { name: 'redactionsPresetExample', example: examples.redactionsPresetExample },
    { name: 'redactionsRegexExample', example: examples.redactionsRegexExample },
    { name: 'redactionsTextExample', example: examples.redactionsTextExample },
    { name: 'complexExample', example: examples.complexExample },
    { name: 'excelToPdfExample', example: examples.excelToPdfExample },
    { name: 'powerPointToPdfExample', example: examples.powerPointToPdfExample },
    { name: 'pdfToOfficeExample', example: examples.pdfToOfficeExample },
    { name: 'imageToPdfExample', example: examples.imageToPdfExample },
    { name: 'webpToPdfExample', example: examples.webpToPdfExample },
    { name: 'jpegOutputExample', example: examples.jpegOutputExample },
    { name: 'webpOutputExample', example: examples.webpOutputExample },
    { name: 'pdfA1bExample', example: examples.pdfA1bExample },
    { name: 'pdfA3uExample', example: examples.pdfA3uExample },
    { name: 'rotation180Example', example: examples.rotation180Example },
    { name: 'rotation270Example', example: examples.rotation270Example },
    { name: 'multipleRedactionPresetsExample', example: examples.multipleRedactionPresetsExample },
    { name: 'pdfToXlsxExample', example: examples.pdfToXlsxExample },
    { name: 'pdfToPptxExample', example: examples.pdfToPptxExample },
    { name: 'comprehensivePdfOptimizationExample', example: examples.comprehensivePdfOptimizationExample },
    { name: 'allUserPermissionsExample', example: examples.allUserPermissionsExample },
    { name: 'negativePageIndicesExample', example: examples.negativePageIndicesExample },
    { name: 'mixedFileTypesExample', example: examples.mixedFileTypesExample },
    { name: 'ocrAndRedactionsExample', example: examples.ocrAndRedactionsExample },
    { name: 'disabledImagesExample', example: examples.disabledImagesExample },
    { name: 'pdfUAExample', example: examples.pdfUAExample },
    { name: 'pdfUAWithPasswordExample', example: examples.pdfUAWithPasswordExample },
    { name: 'htmlPageLayoutExample', example: examples.htmlPageLayoutExample },
    { name: 'htmlReflowLayoutExample', example: examples.htmlReflowLayoutExample },
    { name: 'htmlDefaultExample', example: examples.htmlDefaultExample },
    { name: 'markdownExample', example: examples.markdownExample },
    { name: 'markdownMultipleSourcesExample', example: examples.markdownMultipleSourcesExample },
    { name: 'ocrToHtmlExample', example: examples.ocrToHtmlExample },
    { name: 'watermarkToMarkdownExample', example: examples.watermarkToMarkdownExample },
    { name: 'redactedPdfUAExample', example: examples.redactedPdfUAExample },
  ]

  const jsonOutputExamples: { name: string; example: BuildAPIArgs }[] = [
    { name: 'jsonContentExtractionExample', example: examples.jsonContentExtractionExample },
    { name: 'jsonContentWithStructuredTextExample', example: examples.jsonContentWithStructuredTextExample },
    { name: 'jsonContentKeyValuePairsExample', example: examples.jsonContentKeyValuePairsExample },
    { name: 'jsonContentTablesOnlyExample', example: examples.jsonContentTablesOnlyExample },
    { name: 'jsonContentMultiLanguageExample', example: examples.jsonContentMultiLanguageExample },
  ]

  it.each(fileOutputExamples)('should process $name', async ({ example }) => {
    const { instructions, outputPath } = example

    const result = await performBuildCall(instructions, `${outputDirectory}/${outputPath}`)

    expect(result).toEqual(
      expect.objectContaining({
        isError: false,
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('File processed successfully using build API and saved to:'),
          }),
        ]),
      }),
    )
  })

  it.each(jsonOutputExamples)('should process $name', async ({ example }) => {
    const { instructions } = example

    const result = await performBuildCall(instructions, 'dummy_path.pdf')

    expect(result).toEqual(
      expect.objectContaining({
        isError: false,
        content: expect.arrayContaining([
          expect.objectContaining({
            // The content type can be 'text' or 'json' depending on how performBuildCall processes the JSON string
            type: 'text',
            // For text type, it should contain success message for plain text; and pages array of pageIndexs for structured output
            text: expect.toBeOneOf([expect.stringContaining('Dummy PDF file'), expect.stringContaining('pageIndex')]),
          }),
        ]),
      }),
    )
  })
}, 60000)
