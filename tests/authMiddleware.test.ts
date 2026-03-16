import { describe, expect, it } from 'vitest'
import { buildJwtAudiences } from '../src/http/authMiddleware.js'

describe('buildJwtAudiences', () => {
  it('includes root and path audience variants for resource URLs', () => {
    const audiences = buildJwtAudiences('http://localhost:3000/mcp')

    expect(audiences).toEqual(
      expect.arrayContaining([
        'dws-mcp',
        'http://localhost:3000',
        'http://localhost:3000/',
        'http://localhost:3000/mcp',
        'http://localhost:3000/mcp/',
      ]),
    )
  })

  it('keeps defaults for non-URL resource values', () => {
    const audiences = buildJwtAudiences('dws-mcp-dev')

    expect(audiences).toEqual(expect.arrayContaining(['dws-mcp', 'dws-mcp-dev', 'dws-mcp-dev/']))
  })
})
