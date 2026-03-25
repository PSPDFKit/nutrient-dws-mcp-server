import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  version: string
}

const manifestJson = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf8')) as {
  version: string
}

describe('package metadata', () => {
  it('keeps package.json and manifest.json versions in sync', () => {
    expect(manifestJson.version).toBe(packageJson.version)
  })
})
