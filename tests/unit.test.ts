import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { Stats } from 'fs'
import { Readable } from 'stream'
import { Instructions, SignatureOptions } from '../src/schemas.js'
import { config as dotenvConfig } from 'dotenv'
import { performBuildCall } from '../src/dws/build.js'
import { performSignCall } from '../src/dws/sign.js'
import { performDirectoryTreeCall } from '../src/fs/directoryTree.js'
import * as sandbox from '../src/fs/sandbox.js'
import * as api from '../src/dws/api.js'
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

dotenvConfig()

vi.mock('axios')
vi.mock('fs')
vi.mock('../src/dws/api.js')

function createMockStream(content: string | Buffer): Readable {
  const readable = new Readable()
  readable._read = () => {}
  process.nextTick(() => {
    readable.emit('data', content)
    readable.emit('end')
  })
  return readable
}

describe('API Functions', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetAllMocks()

    process.env = { ...originalEnv, NUTRIENT_DWS_API_KEY: 'test-api-key' }

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('test file content'))
    vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    vi.spyOn(fs.promises, 'readdir').mockImplementation(() => Promise.resolve([]))

    vi.mocked(api.callNutrientApi).mockImplementation(async () => {
      const mockStream = createMockStream('default mock response')
      return {
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      }
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('performBuildCall', () => {
    it('should throw an error if file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const buildCall = performBuildCall({ parts: [{ file: '/test.pdf' }] }, 'test_processed.pdf')

      await expect(buildCall).rejects.toThrowError('Error with referenced file /test.pdf: Path not found: /test.pdf')
    })

    it('should throw an error if API key is not set', async () => {
      // Mock callNutrientApi to throw an error
      vi.mocked(api.callNutrientApi).mockRejectedValue(
        new Error(
          'Error: NUTRIENT_DWS_API_KEY environment variable is required. Please visit https://www.nutrient.io/api/ to get your free API key.',
        ),
      )

      const result = await performBuildCall({ parts: [{ file: '/test.pdf' }] }, 'test_processed.pdf')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('NUTRIENT_DWS_API_KEY environment variable is required')
      expect(result.content[0].text).toContain('https://www.nutrient.io/api/')
    })

    it('should use application/json when all inputs are URLs', async () => {
      const mockStream = createMockStream('processed content')
      vi.mocked(api.callNutrientApi).mockResolvedValueOnce({
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      })

      const instructions = {
        parts: [{ file: 'https://example.com/test.pdf' }],
      }

      await performBuildCall(instructions, '/test_processed.pdf')

      expect(api.callNutrientApi).toHaveBeenCalledWith('build', instructions)
    })

    it('should use multipart/form-data when local files are included', async () => {
      const mockStream = createMockStream('processed content')
      vi.mocked(api.callNutrientApi).mockResolvedValueOnce({
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      })

      const instructions = {
        parts: [{ file: '/test.pdf' }],
      }

      await performBuildCall(instructions, '/test_processed.pdf')

      expect(api.callNutrientApi).toHaveBeenCalledWith('build', expect.any(Object))
    })

    it('should handle json-content output type', async () => {
      const mockStream = createMockStream('{"result": "success"}')
      vi.mocked(api.callNutrientApi).mockResolvedValueOnce({
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      })

      const instructions: Instructions = {
        parts: [{ file: 'https://example.com/test.pdf' }],
        output: {
          type: 'json-content',
          plainText: true,
          keyValuePairs: false,
          tables: true,
        },
      }

      const result = await performBuildCall(instructions, 'test_processed.pdf')

      expect(result.isError).toBe(false)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toBe('{"result": "success"}')
    })

    it('should handle file output and save to disk', async () => {
      const mockStream = createMockStream('processed content')
      vi.mocked(api.callNutrientApi).mockResolvedValueOnce({
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      })

      await performBuildCall({ parts: [{ file: '/test.pdf' }] }, '/test_processed.pdf')

      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('_processed.pdf'), expect.any(Buffer))
    })

    it('should handle errors from the API', async () => {
      vi.mocked(axios.AxiosError).mockReturnValue({
        response: {
          data: createMockStream('Error message from API'),
        },
      } as unknown as AxiosError)
      vi.mocked(axios.isAxiosError).mockImplementation(() => true)
      vi.mocked(api.callNutrientApi).mockRejectedValue(new AxiosError())
      const result = await performBuildCall({ parts: [{ file: '/test.pdf' }] }, 'test_processed.pdf')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Error processing API response: Error message from API')
    })

    it('should handle HostedErrorResponse format from the API', async () => {
      const hostedErrorResponse = {
        details: 'The request is malformed',
        status: 400,
        requestId: 'xy123zzdafaf',
        failingPaths: [
          {
            path: '$.property[0]',
            details: 'Missing required property',
          },
        ],
      }
      vi.mocked(axios.AxiosError).mockReturnValue({
        response: {
          data: createMockStream(JSON.stringify(hostedErrorResponse)),
        },
      } as unknown as AxiosError)
      vi.mocked(axios.isAxiosError).mockImplementation(() => true)
      vi.mocked(api.callNutrientApi).mockRejectedValue(new AxiosError())

      const result = await performBuildCall({ parts: [{ file: '/test.pdf' }] }, 'test_processed.pdf')

      expect(result.isError).toBe(true)

      const errorJson = JSON.parse(result.content[0].text as string)
      expect(errorJson.details).toBe('The request is malformed')
      expect(errorJson.status).toBe(400)
      expect(errorJson.requestId).toBe('xy123zzdafaf')
      expect(errorJson.failingPaths).toHaveLength(1)
      expect(errorJson.failingPaths[0].path).toBe('$.property[0]')
      expect(errorJson.failingPaths[0].details).toBe('Missing required property')
    })
  })

  describe('performSignCall', () => {
    it('should throw an error if file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const buildCall = performBuildCall({ parts: [{ file: '/test.pdf' }] }, '/test_processed.pdf')

      await expect(buildCall).rejects.toThrowError('Error with referenced file /test.pdf: Path not found: /test.pdf')
    })

    it('should throw an error if API key is not set', async () => {
      vi.mocked(api.callNutrientApi).mockRejectedValue(
        new Error(
          'Error: NUTRIENT_DWS_API_KEY environment variable is required. Please visit https://www.nutrient.io/api/ to get your free API key.',
        ),
      )

      const result = await performSignCall('/test.pdf', '/test_processed.pdf')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('NUTRIENT_DWS_API_KEY environment variable is required')
      expect(result.content[0].text).toContain('https://www.nutrient.io/api/')
    })

    it('should send the file and signature options to the API', async () => {
      const mockStream = createMockStream('signed content')
      vi.mocked(api.callNutrientApi).mockResolvedValueOnce({
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      })

      const signatureOptions: SignatureOptions = {
        signatureType: 'cms',
        flatten: false,
        signatureMetadata: {
          signerName: 'Test Signer',
          signatureReason: 'Approval',
          signatureLocation: 'New York',
        },
      }

      await performSignCall('/test.pdf', '/test_processed.pdf', signatureOptions)

      expect(api.callNutrientApi).toHaveBeenCalledWith('sign', expect.any(Object))
    })

    it('should include watermark image if provided', async () => {
      const mockStream = createMockStream('signed content')
      vi.mocked(api.callNutrientApi).mockResolvedValueOnce({
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      })

      await performSignCall(
        '/test.pdf',
        '/test_processed.pdf',
        { signatureType: 'cms', flatten: false },
        '/watermark.png',
      )

      expect(fs.readFileSync).toHaveBeenCalledWith('/watermark.png')
    })

    it('should include graphic image if provided', async () => {
      const mockStream = createMockStream('signed content')
      vi.mocked(api.callNutrientApi).mockResolvedValueOnce({
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      })

      await performSignCall(
        '/test.pdf',
        '/test_processed.pdf',
        { signatureType: 'cms', flatten: false },
        undefined,
        '/graphic.png',
      )

      expect(fs.readFileSync).toHaveBeenCalledWith('/graphic.png')
    })

    it('should save the result to disk', async () => {
      const mockStream = createMockStream('signed content')
      vi.mocked(api.callNutrientApi).mockResolvedValueOnce({
        data: mockStream,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
      })

      await performSignCall('/test.pdf', '/test_signed.pdf')

      expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('_signed.pdf'), expect.any(Buffer))
    })

    it('should handle errors from the API', async () => {
      vi.mocked(axios.AxiosError).mockReturnValue({
        response: {
          data: createMockStream('Error message from API'),
        },
      } as unknown as AxiosError)
      vi.mocked(axios.isAxiosError).mockImplementation(() => true)
      vi.mocked(api.callNutrientApi).mockRejectedValue(new AxiosError())

      const result = await performSignCall('/test.pdf', '/test_processed.pdf')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Error processing API response: Error message from API')
    })
  })

  describe('performDirectoryTreeCall', () => {
    it('should return a tree structure for a valid directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
      } as Stats)

      const mockEntries = [
        {
          name: 'file1.txt',
          isDirectory: () => false,
          isFile: () => true,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        },
        {
          name: 'file2.pdf',
          isDirectory: () => false,
          isFile: () => true,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        },
        {
          name: 'subdir',
          isDirectory: () => true,
          isFile: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        },
      ]

      const readdirSpy = vi.spyOn(fs.promises, 'readdir')
      readdirSpy.mockImplementationOnce(() =>
        Promise.resolve(mockEntries as unknown as fs.Dirent<Buffer<ArrayBufferLike>>[]),
      )

      const result = await performDirectoryTreeCall('/test/dir')

      expect(result.isError).toBe(false)
      expect(result.content[0].type).toBe('text')

      const treeData = JSON.parse(result.content[0].text as string)
      expect(treeData).toHaveLength(3)
      expect(treeData[0].name).toBe('file1.txt')
      expect(treeData[0].type).toBe('file')
      expect(treeData[1].name).toBe('file2.pdf')
      expect(treeData[1].type).toBe('file')
      expect(treeData[2].name).toBe('subdir')
      expect(treeData[2].type).toBe('directory')
      expect(treeData[2].children).toEqual([])
    })

    it('should return an error if the directory does not exist', async () => {
      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
      } as Stats)

      const result = await performDirectoryTreeCall('/nonexistent/dir')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Error: Path is not a directory: /nonexistent/dir')
    })

    it('should return an error if the path is not a directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => false,
      } as Stats)

      const result = await performDirectoryTreeCall('/test/file.txt')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Path is not a directory')
    })

    it('should handle empty directories', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
      } as Stats)

      const readdirSpy = vi.spyOn(fs.promises, 'readdir')
      readdirSpy.mockImplementation(() => Promise.resolve([] as unknown as fs.Dirent<Buffer>[]))

      const result = await performDirectoryTreeCall('/test/empty-dir')

      expect(result.isError).toBe(false)

      const treeData = JSON.parse(result.content[0].text as string)
      expect(treeData).toEqual([])
    })

    it('should handle errors during tree building', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      vi.mocked(fs.statSync).mockReturnValue({
        isDirectory: () => true,
      } as Stats)

      const mockError = new Error('Permission denied')
      const readdirSpy = vi.spyOn(fs.promises, 'readdir')
      readdirSpy.mockImplementation(() => Promise.reject(mockError))

      const result = await performDirectoryTreeCall('/test/dir')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Permission denied')
    })
  })

  describe('Sandbox Functionality', () => {
    beforeEach(() => {
      vi.resetAllMocks()

      vi.mocked(fs.existsSync).mockReturnValue(true)
      sandbox.setSandboxDirectory(null)
    })

    describe('resolveSandboxFilePath', () => {
      it('should append sandbox dir to absolute file paths when sandbox mode is enabled', () => {
        sandbox.setSandboxDirectory('/sandbox')

        const absolutePathOutsideSandbox = '/outside/test.pdf'

        // Paths should resolve inside the sandbox.
        expect(sandbox.resolveSandboxFilePath(absolutePathOutsideSandbox)).toBe('/sandbox/outside/test.pdf')
      })

      it('should resolve relative paths to the sandbox directory when sandbox mode is enabled', () => {
        sandbox.setSandboxDirectory('/sandbox')

        const relativePath = 'test.pdf'

        // Paths should resolve inside the sandbox.
        expect(sandbox.resolveSandboxFilePath(relativePath)).toBe('/sandbox/test.pdf')
      })

      it('should resolve absolute paths when sandbox is not enabled', () => {
        const absolutePath = '/test.pdf'

        expect(sandbox.resolveSandboxFilePath(absolutePath)).toBe('/test.pdf')
      })

      it('should reject relative paths when sandbox is not enabled', () => {
        const relativePath = 'test.pdf'

        expect(() => sandbox.resolveSandboxFilePath(relativePath)).toThrowError(
          'Invalid Path: test.pdf. Absolute paths are required when sandbox is not enabled. Use / to start from the root directory.',
        )
      })

      it('should reject file path if it resolves outside the sandbox', () => {
        sandbox.setSandboxDirectory('/sandbox')

        const relativePath = '../output.pdf'

        expect(() => sandbox.resolveSandboxFilePath(relativePath)).toThrowError(
          'Invalid Path: ../output.pdf. You may only access files within the sandbox directory, please use relative paths.',
        )
      })

      it('should accept absolute paths that already start with the sandbox directory', () => {
        sandbox.setSandboxDirectory('/sandbox')

        const absolutePathInSandbox = '/sandbox/test.pdf'

        // The path should be accepted as is, without appending the sandbox path again
        expect(sandbox.resolveSandboxFilePath(absolutePathInSandbox)).toBe('/sandbox/test.pdf')
      })
    })

    describe('resolveOutputFilePath', () => {
      it('absolute paths should be within sandbox when sandbox mode is enabled', () => {
        sandbox.setSandboxDirectory('/sandbox')

        const absolutePathInSandbox = '/output.pdf'

        // The resolved path should be the same as the input
        expect(sandbox.resolveOutputFilePath(absolutePathInSandbox)).toBe('/sandbox/output.pdf')
      })

      it('should resolve relative paths to the sandbox directory when sandbox mode is enabled', () => {
        sandbox.setSandboxDirectory('/sandbox')

        const relativePath = 'output.pdf'

        // Relative paths should resolve to the sandbox directory.
        expect(sandbox.resolveOutputFilePath(relativePath)).toBe('/sandbox/output.pdf')
      })

      it('should resolve absolute paths when sandbox is not enabled', () => {
        const absolutePath = '/output.pdf'

        expect(sandbox.resolveOutputFilePath(absolutePath)).toBe('/output.pdf')
      })

      it('should reject relative paths when sandbox is not enabled', () => {
        const relativePath = 'output.pdf'

        expect(() => sandbox.resolveOutputFilePath(relativePath)).toThrowError(
          'Invalid Path: output.pdf. Absolute paths are required when sandbox is not enabled. Use / to start from the root directory.',
        )
      })

      it('should reject file path if it resolves outside the sandbox', () => {
        sandbox.setSandboxDirectory('/sandbox')

        const relativePath = '../output.pdf'

        expect(() => sandbox.resolveOutputFilePath(relativePath)).toThrowError(
          'Invalid Path: ../output.pdf. You may only access files within the sandbox directory, please use relative paths.',
        )
      })

      it('should accept absolute paths that already start with the sandbox directory', () => {
        sandbox.setSandboxDirectory('/sandbox')

        const absolutePathInSandbox = '/sandbox/output.pdf'

        // The path should be accepted as is, without appending the sandbox path again
        expect(sandbox.resolveOutputFilePath(absolutePathInSandbox)).toBe('/sandbox/output.pdf')
      })
    })
  })
})
