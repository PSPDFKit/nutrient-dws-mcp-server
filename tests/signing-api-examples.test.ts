import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as examples from './signing-api-examples.js'
import { config as dotenvConfig } from 'dotenv'
import { performSignCall } from '../src/dws/sign.js'
import { SignAPIArgs } from '../src/schemas.js'
import path from 'path'
import { setSandboxDirectory } from '../src/fs/sandbox.js'

dotenvConfig()

describe('performSignCall with signing-api-examples', () => {
  let outputDirectory: string
  beforeAll(async () => {
    const assetsDir = path.join(__dirname, `assets`)
    await setSandboxDirectory(assetsDir)

    outputDirectory = `test-output-${new Date().toISOString().replace(/[:.]/g, '-')}`
  })

  afterEach(async () => {
    // A naive way to do rate limiting.
    return await new Promise((resolve) => setTimeout(resolve, 5000))
  }, 20000)

  const signatureExamples: { name: string; example: SignAPIArgs }[] = [
    { name: 'basicSignatureExample', example: examples.basicSignatureExample },
    { name: 'invisibleSignatureExample', example: examples.invisibleSignatureExample },
    { name: 'cadesSignatureExample', example: examples.cadesSignatureExample },
    { name: 'watermarkSignatureExample', example: examples.watermarkSignatureExample },
    { name: 'graphicSignatureExample', example: examples.graphicSignatureExample },
    { name: 'combinedImagesSignatureExample', example: examples.combinedImagesSignatureExample },
    { name: 'formFieldSignatureExample', example: examples.formFieldSignatureExample },
    { name: 'descriptionOnlySignatureExample', example: examples.descriptionOnlySignatureExample },
    { name: 'signatureOnlyExample', example: examples.signatureOnlyExample },
    { name: 'flattenedSignatureExample', example: examples.flattenedSignatureExample },
    { name: 'overwriteSignatureExample', example: examples.overwriteSignatureExample },
    { name: 'cadesBBSignatureExample', example: examples.cadesBBSignatureExample },
    { name: 'cadesBTSignatureExample', example: examples.cadesBTSignatureExample },
  ]

  it.each(signatureExamples)('should process $name', async ({ example }) => {
    const { filePath, signatureOptions, watermarkImagePath, graphicImagePath, outputPath } = example

    const result = await performSignCall(
      filePath,
      `${outputDirectory}/${outputPath}`,
      signatureOptions,
      watermarkImagePath,
      graphicImagePath,
    )

    expect(result).toEqual(
      expect.objectContaining({
        isError: false,
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('File signed successfully and saved to:'),
          }),
        ]),
      }),
    )
  })
})
