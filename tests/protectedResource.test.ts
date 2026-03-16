import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { buildWwwAuthenticateHeader, createProtectedResourceHandler } from '../src/http/protectedResource.js'

describe('protected resource metadata', () => {
  it('serves RFC9728 metadata document', async () => {
    const app = express()

    app.get(
      '/.well-known/oauth-protected-resource',
      createProtectedResourceHandler({
        resourceUrl: 'https://mcp.nutrient.io/mcp',
        authServerUrl: 'https://api.nutrient.io',
        resourceMetadataUrl: 'https://mcp.nutrient.io/.well-known/oauth-protected-resource',
      }),
    )

    const response = await request(app).get('/.well-known/oauth-protected-resource')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      resource: 'https://mcp.nutrient.io/mcp',
      authorization_servers: ['https://api.nutrient.io'],
    })
  })

  it('builds WWW-Authenticate header with resource metadata', () => {
    const header = buildWwwAuthenticateHeader({
      resourceMetadataUrl: 'https://mcp.nutrient.io/.well-known/oauth-protected-resource',
    })

    expect(header).toBe('Bearer resource_metadata="https://mcp.nutrient.io/.well-known/oauth-protected-resource"')
  })
})
