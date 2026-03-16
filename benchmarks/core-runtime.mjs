import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const distRoot = path.join(repoRoot, '.autoresearch-dist')

async function importModule(relativePath) {
  const modulePath = path.join(distRoot, relativePath)
  return import(pathToFileURL(modulePath).href)
}

const sandboxModule = await importModule(path.join('fs', 'sandbox.js'))
const directoryTreeModule = await importModule(path.join('fs', 'directoryTree.js'))
const parseSandboxModule = await importModule(path.join('utils', 'sandbox.js'))
const versionModule = await importModule(path.join('version.js'))

const { setSandboxDirectory, resolveReadFilePath, resolveWriteFilePath } = sandboxModule
const { performDirectoryTreeCall } = directoryTreeModule
const { parseSandboxPath } = parseSandboxModule
const { getVersion } = versionModule

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nutrient-dws-autoresearch-'))
const sandboxRoot = path.join(fixtureRoot, 'sandbox')

async function createFixtures() {
  await fs.mkdir(sandboxRoot, { recursive: true })

  const readTargets = []
  const existingWriteTargets = []
  const newWriteTargets = []

  for (let dirIndex = 0; dirIndex < 12; dirIndex += 1) {
    const inputDir = path.join(sandboxRoot, 'input', `dir-${dirIndex}`)
    const existingOutputDir = path.join(sandboxRoot, 'output-existing', `dir-${dirIndex}`)
    const newOutputDir = path.join(sandboxRoot, 'output-new', `dir-${dirIndex}`)

    await fs.mkdir(inputDir, { recursive: true })
    await fs.mkdir(existingOutputDir, { recursive: true })
    await fs.mkdir(newOutputDir, { recursive: true })

    for (let fileIndex = 0; fileIndex < 12; fileIndex += 1) {
      const inputFile = path.join(inputDir, `file-${fileIndex}.txt`)
      const existingOutputFile = path.join(existingOutputDir, `file-${fileIndex}.txt`)
      const newOutputFile = path.join(newOutputDir, `generated-${fileIndex}.txt`)

      await fs.writeFile(inputFile, `input-${dirIndex}-${fileIndex}`)
      await fs.writeFile(existingOutputFile, `output-${dirIndex}-${fileIndex}`)

      readTargets.push(path.relative(sandboxRoot, inputFile))
      existingWriteTargets.push(path.relative(sandboxRoot, existingOutputFile))
      newWriteTargets.push(path.relative(sandboxRoot, newOutputFile))
    }
  }

  return { readTargets, existingWriteTargets, newWriteTargets }
}

const { readTargets, existingWriteTargets, newWriteTargets } = await createFixtures()

async function runSingleBenchmark() {
  const workloadMultiplier = 800
  const warmupReadTargets = readTargets.slice(0, 8)
  const warmupWriteTargets = existingWriteTargets.slice(0, 8)

  await setSandboxDirectory(sandboxRoot)

  for (const target of warmupReadTargets) {
    await resolveReadFilePath(target)
  }

  for (const target of warmupWriteTargets) {
    await resolveWriteFilePath(target)
  }

  await performDirectoryTreeCall('input')
  parseSandboxPath(['--sandbox', sandboxRoot], undefined)

  const start = performance.now()

  for (let iteration = 0; iteration < 80 * workloadMultiplier; iteration += 1) {
    for (const target of readTargets) {
      await resolveReadFilePath(target)
    }
  }

  for (let iteration = 0; iteration < 80 * workloadMultiplier; iteration += 1) {
    for (const target of existingWriteTargets) {
      await resolveWriteFilePath(target)
    }
  }

  for (let iteration = 0; iteration < 40 * workloadMultiplier; iteration += 1) {
    for (const target of newWriteTargets) {
      await resolveWriteFilePath(target)
    }
  }

  for (let iteration = 0; iteration < 12 * workloadMultiplier; iteration += 1) {
    const result = await performDirectoryTreeCall('input')
    if (result.isError) {
      throw new Error('Directory tree benchmark failed')
    }
  }

  for (let iteration = 0; iteration < 50000 * workloadMultiplier; iteration += 1) {
    parseSandboxPath(['--sandbox', sandboxRoot], undefined)
  }

  for (let iteration = 0; iteration < 400 * workloadMultiplier; iteration += 1) {
    getVersion()
  }

  const end = performance.now()
  return Math.round(end - start)
}

async function runBenchmark() {
  const samples = []

  for (let warmupSampleIndex = 0; warmupSampleIndex < 3; warmupSampleIndex += 1) {
    await runSingleBenchmark()
  }

  for (let sampleIndex = 0; sampleIndex < 9; sampleIndex += 1) {
    samples.push(await runSingleBenchmark())
  }

  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]
}

try {
  const totalMs = await runBenchmark()
  console.log(`METRIC total_ms=${totalMs}`)
} finally {
  await setSandboxDirectory(null)
  await fs.rm(fixtureRoot, { recursive: true, force: true })
}
