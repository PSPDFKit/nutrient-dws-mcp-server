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
import path from 'path'
import { FileHandle } from 'fs/promises'
import { parseSandboxPath } from '../src/utils/sandbox.js'

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

    vi.spyOn(fs.promises, 'access').mockImplementation(async () => {})
    vi.spyOn(fs.promises, 'stat').mockReturnValue(
      Promise.resolve({
        isFile: () => true,
        isDirectory: () => true,
      } as Stats),
    )
    vi.spyOn(fs.promises, 'open').mockReturnValue(Promise.resolve({ close: async () => {} } as FileHandle))

    vi.spyOn(fs.promises, 'readFile').mockReturnValue(Promise.resolve(Buffer.from('test file content')))
    vi.spyOn(fs.promises, 'writeFile').mockImplementation(async () => {})

    vi.spyOn(fs.promises, 'readdir').mockImplementation(() => Promise.resolve([]))
    vi.spyOn(fs.promises, 'mkdir').mockReturnValue(Promise.resolve(undefined))
    vi.spyOn(fs.promises, 'unlink').mockImplementation(async () => {})
    vi.spyOn(fs.promises, 'rm').mockImplementation(async () => {})

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
      const resolvedPath = path.resolve('/test.pdf')

      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {
        throw new Error(`Path not found: ${resolvedPath}`)
      })

      const buildCall = performBuildCall({ parts: [{ file: '/test.pdf' }] }, '/test_processed.pdf')

      await expect(buildCall).rejects.toThrowError(
        `Error with referenced file /test.pdf: Path not found: ${resolvedPath}`,
      )
    })

    it('should throw an error if API key is not set', async () => {
      // Mock callNutrientApi to throw an error
      vi.mocked(api.callNutrientApi).mockRejectedValue(
        new Error(
          'Error: NUTRIENT_DWS_API_KEY environment variable is required. Please visit https://www.nutrient.io/api/ to get your free API key.',
        ),
      )

      const result = await performBuildCall({ parts: [{ file: '/test.pdf' }] }, '/test_processed.pdf')

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

      const result = await performBuildCall(instructions, '/test_processed.pdf')

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

      expect(fs.promises.writeFile).toHaveBeenCalledWith(expect.stringContaining('_processed.pdf'), expect.any(Buffer))
    })

    it('should handle errors from the API', async () => {
      vi.mocked(axios.AxiosError).mockReturnValue({
        response: {
          data: createMockStream('Error message from API'),
        },
      } as unknown as AxiosError)
      vi.mocked(axios.isAxiosError).mockImplementation(() => true)
      vi.mocked(api.callNutrientApi).mockRejectedValue(new AxiosError())
      const result = await performBuildCall({ parts: [{ file: '/test.pdf' }] }, '/test_processed.pdf')

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

      const result = await performBuildCall({ parts: [{ file: '/test.pdf' }] }, '/test_processed.pdf')

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
      const resolvedPath = path.resolve('/test.pdf')

      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {
        throw new Error(`Error with referenced file /test.pdf: Path not found: ${resolvedPath}`)
      })

      const buildCall = performBuildCall({ parts: [{ file: '/test.pdf' }] }, '/test_processed.pdf')

      await expect(buildCall).rejects.toThrowError(
        `Error with referenced file /test.pdf: Path not found: ${resolvedPath}`,
      )
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

      expect(fs.promises.readFile).toHaveBeenCalledWith(path.resolve('/watermark.png'))
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

      expect(fs.promises.readFile).toHaveBeenCalledWith(path.resolve('/graphic.png'))
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

      expect(fs.promises.writeFile).toHaveBeenCalledWith(expect.stringContaining('_signed.pdf'), expect.any(Buffer))
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
      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {})

      vi.spyOn(fs.promises, 'stat').mockReturnValue(
        Promise.resolve({
          isDirectory: () => true,
        } as Stats),
      )

      const mockEntries = [
        {
          name: 'file1.txt',
          parentPath: '/test/dir',
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
          parentPath: '/test/dir',
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
          parentPath: '/test/dir',
          isDirectory: () => true,
          isFile: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        },
      ]

      vi.spyOn(fs.promises, 'readdir').mockImplementationOnce(() =>
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
      vi.spyOn(fs.promises, 'stat').mockReturnValue(
        Promise.resolve({
          isDirectory: () => false,
        } as Stats),
      )

      const result = await performDirectoryTreeCall('/nonexistent/dir')

      const resolvedDirectory = path.resolve('/nonexistent/dir')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain(`Error: Path is not a directory: ${resolvedDirectory}`)
    })

    it('should return an error if the path is not a directory', async () => {
      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {})

      vi.spyOn(fs.promises, 'stat').mockReturnValue(
        Promise.resolve({
          isDirectory: () => false,
        } as Stats),
      )

      const result = await performDirectoryTreeCall('/test/file.txt')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Path is not a directory')
    })

    it('should handle empty directories', async () => {
      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {})

      vi.spyOn(fs.promises, 'stat').mockReturnValue(
        Promise.resolve({
          isDirectory: () => true,
        } as Stats),
      )

      vi.spyOn(fs.promises, 'readdir').mockImplementation(() => Promise.resolve([] as unknown as fs.Dirent<Buffer>[]))

      const result = await performDirectoryTreeCall('/test/empty-dir')

      expect(result.isError).toBe(false)

      const treeData = JSON.parse(result.content[0].text as string)
      expect(treeData).toEqual([])
    })

    it('should handle errors during tree building', async () => {
      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {})

      vi.spyOn(fs.promises, 'stat').mockReturnValue(
        Promise.resolve({
          isDirectory: () => true,
        } as Stats),
      )

      const mockError = new Error('Permission denied')
      vi.spyOn(fs.promises, 'readdir').mockImplementation(() => Promise.reject(mockError))

      const result = await performDirectoryTreeCall('/test/dir')

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain(
        'Cannot read the directory tree, make sure to allow this application access to',
      )
    })
  })

  describe('Sandbox Functionality', () => {
    beforeEach(async () => {
      vi.resetAllMocks()

      vi.spyOn(fs.promises, 'access').mockImplementation(async () => {})
      vi.spyOn(fs.promises, 'stat').mockReturnValue(
        Promise.resolve({
          isFile: () => true,
          isDirectory: () => true,
        } as Stats),
      )
      vi.spyOn(fs.promises, 'open').mockReturnValue(Promise.resolve({ close: async () => {} } as FileHandle))

      vi.spyOn(fs.promises, 'mkdir').mockReturnValue(Promise.resolve(undefined))
      vi.spyOn(fs.promises, 'unlink').mockImplementation(async () => {})
      vi.spyOn(fs.promises, 'rm').mockImplementation(async () => {})

      await sandbox.setSandboxDirectory(null)
    })

    describe('resolveReadFilePath', () => {
      it('should append sandbox dir to absolute file paths when sandbox mode is enabled', async () => {
        await sandbox.setSandboxDirectory('/sandbox')

        const absolutePathOutsideSandbox = '/outside/test.pdf'

        const resolvedAbsolutePathOutsideSandbox = path.resolve('/sandbox/outside/test.pdf')

        const answerPath = await sandbox.resolveReadFilePath(absolutePathOutsideSandbox)

        // Paths should resolve inside the sandbox.
        expect(answerPath).toBe(resolvedAbsolutePathOutsideSandbox)
      })

      it('should resolve relative paths to the sandbox directory when sandbox mode is enabled', async () => {
        await sandbox.setSandboxDirectory('/sandbox')

        const relativePath = 'test.pdf'

        const resolvedRelativePath = path.resolve('/sandbox/test.pdf')

        const answerPath = await sandbox.resolveReadFilePath(relativePath)

        // Paths should resolve inside the sandbox.
        expect(answerPath).toBe(resolvedRelativePath)
      })

      it('should resolve absolute paths when sandbox is not enabled', async () => {
        const absolutePath = '/test.pdf'

        const resolvedAbsolutePath = path.resolve('/test.pdf')

        const answerPath = await sandbox.resolveReadFilePath(absolutePath)

        expect(answerPath).toBe(resolvedAbsolutePath)
      })

      it('should reject relative paths when sandbox is not enabled', async () => {
        const relativePath = 'test.pdf'

        await expect(async () => await sandbox.resolveReadFilePath(relativePath)).rejects.toThrowError(
          'Invalid Path: test.pdf. Absolute paths are required when sandbox is not enabled. Use / (MacOS/Linux) or C:\\ (Windows) to start from the root directory.',
        )
      })

      it('should reject file path if it resolves outside the sandbox', async () => {
        await sandbox.setSandboxDirectory('/sandbox')

        const relativePath = '../output.pdf'

        await expect(async () => await sandbox.resolveReadFilePath(relativePath)).rejects.toThrowError(
          'Invalid Path: ../output.pdf. You may only access files within the sandbox directory, please use relative paths.',
        )
      })

      it('should accept absolute paths that already start with the sandbox directory', async () => {
        await sandbox.setSandboxDirectory('/sandbox')

        const absolutePathInSandbox = '/sandbox/test.pdf'

        const resolvedAbsolutePathInSandbox = path.resolve('/sandbox/test.pdf')

        const answerPath = await sandbox.resolveReadFilePath(absolutePathInSandbox)

        // The path should be accepted as is, without appending the sandbox path again
        expect(answerPath).toBe(resolvedAbsolutePathInSandbox)
      })
    })

    describe('resolveWriteFilePath', () => {
      it('absolute paths should be within sandbox when sandbox mode is enabled', async () => {
        await sandbox.setSandboxDirectory('/sandbox')

        const absolutePathInSandbox = '/output.pdf'

        const resolvedPathInSandbox = path.resolve('/sandbox/output.pdf')

        const answerPath = await sandbox.resolveWriteFilePath(absolutePathInSandbox)

        // The resolved path should be the same as the input
        expect(answerPath).toBe(resolvedPathInSandbox)
      })

      it('should resolve relative paths to the sandbox directory when sandbox mode is enabled', async () => {
        await sandbox.setSandboxDirectory('/sandbox')

        const relativePath = 'output.pdf'

        const resolvedRelativePath = path.resolve('/sandbox/output.pdf')

        const answerPath = await sandbox.resolveWriteFilePath(relativePath)

        // Relative paths should resolve to the sandbox directory.
        expect(answerPath).toBe(resolvedRelativePath)
      })

      it('should resolve absolute paths when sandbox is not enabled', async () => {
        const absolutePath = '/output.pdf'

        const resolvedAbsolutePath = path.resolve('/output.pdf')

        const answerPath = await sandbox.resolveWriteFilePath(absolutePath)

        expect(answerPath).toBe(resolvedAbsolutePath)
      })

      it('should reject relative paths when sandbox is not enabled', async () => {
        const relativePath = 'output.pdf'

        await expect(async () => await sandbox.resolveWriteFilePath(relativePath)).rejects.toThrowError(
          'Invalid Path: output.pdf. Absolute paths are required when sandbox is not enabled. Use / (MacOS/Linux) or C:\\ (Windows) to start from the root directory.',
        )
      })

      it('should reject file path if it resolves outside the sandbox', async () => {
        await sandbox.setSandboxDirectory('/sandbox')

        const relativePath = '../output.pdf'

        await expect(async () => await sandbox.resolveWriteFilePath(relativePath)).rejects.toThrowError(
          'Invalid Path: ../output.pdf. You may only access files within the sandbox directory, please use relative paths.',
        )
      })

      it('should accept absolute paths that already start with the sandbox directory', async () => {
        await sandbox.setSandboxDirectory('/sandbox')

        const absolutePathInSandbox = '/sandbox/output.pdf'

        const resolvedAbsolutePathInSandbox = path.resolve('/sandbox/output.pdf')

        const answerPath = await sandbox.resolveWriteFilePath(absolutePathInSandbox)

        // The path should be accepted as is, without appending the sandbox path again
        expect(answerPath).toBe(resolvedAbsolutePathInSandbox)
      })
    })
  })

  describe('parseSandboxPath utility', () => {
    it('should return undefined when no args or env var provided', () => {
      const result = parseSandboxPath([], undefined)
      expect(result).toBeUndefined()
    })

    it('should use environment variable when provided and no args', () => {
      const result = parseSandboxPath([], '/env/sandbox')
      expect(result).toBe('/env/sandbox')
    })

    it('should prefer command line --sandbox over environment variable', () => {
      const args = ['--sandbox', '/cli/sandbox']
      const result = parseSandboxPath(args, '/env/sandbox')
      expect(result).toBe('/cli/sandbox')
    })

    it('should work with short flag -s', () => {
      const args = ['-s', '/cli/sandbox']
      const result = parseSandboxPath(args, '/env/sandbox')
      expect(result).toBe('/cli/sandbox')
    })

    it('should throw error when --sandbox flag has no path', () => {
      const args = ['--sandbox']
      expect(() => parseSandboxPath(args, undefined)).toThrow('--sandbox flag requires a directory path')
    })

    it('should throw error when -s flag has no path', () => {
      const args = ['-s']
      expect(() => parseSandboxPath(args, undefined)).toThrow('--sandbox flag requires a directory path')
    })

    it('should handle multiple arguments and find sandbox flag', () => {
      const args = ['--help', '--sandbox', '/path/to/sandbox', '--verbose']
      const result = parseSandboxPath(args, undefined)
      expect(result).toBe('/path/to/sandbox')
    })

    it('should return undefined when empty env var provided', () => {
      const result = parseSandboxPath([], '')
      expect(result).toBeUndefined()
    })
  })
})
