import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { Stats } from 'fs'
import path from 'path'
import { FileHandle } from 'fs/promises'
import { performDirectoryTreeCall } from '../src/fs/directoryTree.js'

function createMockDirent(name: string, isDir: boolean = false): fs.Dirent {
  return {
    name,
    parentPath: '/test/dir',
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as unknown as fs.Dirent
}

describe('Directory Tree File Descriptor Handling', () => {
  let mockClose: ReturnType<typeof vi.fn>
  let mockFileHandle: FileHandle

  beforeEach(() => {
    vi.resetAllMocks()

    vi.spyOn(fs.promises, 'access').mockResolvedValue(undefined)
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({
      isFile: () => true,
      isDirectory: () => true,
    } as Stats)

    const mockFiles = [createMockDirent('file1.txt'), createMockDirent('file2.pdf')]

    vi.spyOn(fs.promises, 'readdir').mockResolvedValue(mockFiles as unknown as fs.Dirent<Buffer<ArrayBufferLike>>[])

    mockClose = vi.fn().mockResolvedValue(undefined)
    mockFileHandle = {
      fd: 16,
      close: mockClose,
    } as unknown as FileHandle
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should properly close file descriptors when processing files', async () => {
    const openSpy = vi.spyOn(fs.promises, 'open').mockResolvedValue(mockFileHandle)

    await performDirectoryTreeCall('/test/dir')

    expect(openSpy).toHaveBeenCalledTimes(2)
    expect(openSpy).toHaveBeenCalledWith(path.join('/test/dir', 'file1.txt'), 'r')
    expect(openSpy).toHaveBeenCalledWith(path.join('/test/dir', 'file2.pdf'), 'r')

    expect(mockClose).toHaveBeenCalledTimes(2)

    const fsCloseSpy = vi.spyOn(fs, 'close')
    expect(fsCloseSpy).not.toHaveBeenCalled()
  })

  it('should handle errors when opening files and continue processing', async () => {
    const openSpy = vi
      .spyOn(fs.promises, 'open')
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce(mockFileHandle)

    const result = await performDirectoryTreeCall('/test/dir')

    expect(result.isError).toBe(false)

    expect(openSpy).toHaveBeenCalledTimes(2)

    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('should use fd.close() instead of fs.close(fd.fd)', async () => {
    const specialMockClose = vi.fn().mockResolvedValue(undefined)
    const specialMockFileHandle = {
      fd: 42,
      close: specialMockClose,
    } as unknown as FileHandle

    vi.spyOn(fs.promises, 'open').mockResolvedValue(specialMockFileHandle)

    const fsCloseSpy = vi.spyOn(fs, 'close')

    await performDirectoryTreeCall('/test/dir')

    expect(specialMockClose).toHaveBeenCalledTimes(2)

    expect(fsCloseSpy).not.toHaveBeenCalled()
    expect(fsCloseSpy).not.toHaveBeenCalledWith(42)
  })
})
