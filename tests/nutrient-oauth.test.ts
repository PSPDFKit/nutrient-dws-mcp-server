import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  isTokenExpired,
  readCachedCredentials,
} from '../src/auth/nutrient-oauth.js'

describe('generateCodeVerifier', () => {
  it('produces a valid base64url string', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/) // no +, /, or =
    expect(verifier.length).toBeGreaterThanOrEqual(43) // RFC 7636 minimum
  })

  it('produces different values on each call', () => {
    const a = generateCodeVerifier()
    const b = generateCodeVerifier()
    expect(a).not.toBe(b)
  })
})

describe('generateCodeChallenge', () => {
  it('produces RFC 7636-compliant S256 challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(generateCodeChallenge(verifier)).toBe(expected)
  })

  it('produces a valid base64url string', () => {
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/) // no +, /, or =
  })

  it('is deterministic for the same input', () => {
    const verifier = 'test-verifier'
    expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier))
  })
})

describe('isTokenExpired', () => {
  it('treats missing expiresAt as expired', () => {
    expect(isTokenExpired({ accessToken: 'tok' })).toBe(true)
  })

  it('treats token expiring in 30s as expired (within 60s buffer)', () => {
    expect(isTokenExpired({ accessToken: 'tok', expiresAt: Date.now() + 30_000 })).toBe(true)
  })

  it('treats token expiring in 90s as valid (outside 60s buffer)', () => {
    expect(isTokenExpired({ accessToken: 'tok', expiresAt: Date.now() + 90_000 })).toBe(false)
  })

  it('treats token already past expiresAt as expired', () => {
    expect(isTokenExpired({ accessToken: 'tok', expiresAt: Date.now() - 1000 })).toBe(true)
  })

  it('treats token expiring far in the future as valid', () => {
    expect(isTokenExpired({ accessToken: 'tok', expiresAt: Date.now() + 3600_000 })).toBe(false)
  })
})

describe('readCachedCredentials', () => {
  const testDir = join(tmpdir(), `nutrient-oauth-test-${Date.now()}`)
  const testPath = join(testDir, 'credentials.json')

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('returns null for non-existent file', async () => {
    const result = await readCachedCredentials(join(testDir, 'nonexistent.json'))
    expect(result).toBeNull()
  })

  it('returns parsed credentials for valid file', async () => {
    const creds = { accessToken: 'tok123', refreshToken: 'ref456', expiresAt: 9999999999999 }
    await writeFile(testPath, JSON.stringify(creds))
    const result = await readCachedCredentials(testPath)
    expect(result).toEqual(creds)
  })

  it('returns null for malformed JSON', async () => {
    await writeFile(testPath, 'not-json')
    const result = await readCachedCredentials(testPath)
    expect(result).toBeNull()
  })

  it('returns null for valid JSON missing required fields', async () => {
    await writeFile(testPath, JSON.stringify({ refreshToken: 'ref' }))
    const result = await readCachedCredentials(testPath)
    expect(result).toBeNull()
  })

  it('includes clientId when present', async () => {
    const creds = { accessToken: 'tok', clientId: 'my-client' }
    await writeFile(testPath, JSON.stringify(creds))
    const result = await readCachedCredentials(testPath)
    expect(result?.clientId).toBe('my-client')
  })
})
