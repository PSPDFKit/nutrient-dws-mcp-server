import type { RequestHandler } from 'express'

type ProtectedResourceConfig = {
  resourceUrl: string
  authServerUrl: string
  resourceMetadataUrl: string
}

export function createProtectedResourceHandler(config: ProtectedResourceConfig): RequestHandler {
  return (_req, res) => {
    res.json({
      resource: config.resourceUrl,
      authorization_servers: [config.authServerUrl],
    })
  }
}

function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildWwwAuthenticateHeader(options: {
  resourceMetadataUrl: string
  error?: string
  errorDescription?: string
  scope?: string
}) {
  const params: string[] = []

  if (options.error) {
    params.push(`error="${quote(options.error)}"`)
  }

  if (options.errorDescription) {
    params.push(`error_description="${quote(options.errorDescription)}"`)
  }

  if (options.scope) {
    params.push(`scope="${quote(options.scope)}"`)
  }

  params.push(`resource_metadata="${quote(options.resourceMetadataUrl)}"`)

  return `Bearer ${params.join(', ')}`
}
