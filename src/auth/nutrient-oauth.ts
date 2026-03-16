import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../logger.js'

/** Fixed callback port for OAuth redirect URI. Must match the registered redirect_uri on the auth server. */
const DEFAULT_CALLBACK_PORT = 19423

export type NutrientOAuthConfig = {
  /** Nutrient OAuth authorize endpoint. */
  authorizeUrl: string
  /** Nutrient OAuth token endpoint. */
  tokenUrl: string
  /** Public client ID (no secret needed for local CLI). */
  clientId: string
  /** OAuth scopes to request. */
  scopes: string[]
  /** Path to cache credentials. Defaults to `~/.nutrient/credentials.json`. */
  credentialsPath?: string
  /** Fixed port for the OAuth callback server. Defaults to 19423. */
  callbackPort?: number
  /** OAuth resource parameter (RFC 8707). Identifies the target API. */
  resource?: string
}

type CachedCredentials = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.nutrient', 'credentials.json')

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

async function readCachedCredentials(credentialsPath: string): Promise<CachedCredentials | null> {
  try {
    const content = await readFile(credentialsPath, 'utf-8')
    return JSON.parse(content) as CachedCredentials
  } catch {
    return null
  }
}

async function writeCachedCredentials(credentialsPath: string, credentials: CachedCredentials): Promise<void> {
  const dir = join(credentialsPath, '..')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 })
}

function isTokenExpired(credentials: CachedCredentials): boolean {
  if (!credentials.expiresAt) {
    return false
  }
  // Consider expired 60 seconds early to avoid edge cases
  return Date.now() >= (credentials.expiresAt - 60_000)
}

async function refreshAccessToken(
  config: NutrientOAuthConfig,
  refreshToken: string,
): Promise<CachedCredentials | null> {
  try {
    logger.debug('Attempting token refresh', { tokenUrl: config.tokenUrl, clientId: config.clientId })
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.clientId,
        refresh_token: refreshToken,
      }),
    })

    if (!response.ok) {
      logger.warn('Token refresh failed', { status: response.status, statusText: response.statusText })
      return null
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    }
  } catch {
    return null
  }
}

async function exchangeCodeForToken(
  config: NutrientOAuthConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<CachedCredentials> {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Token exchange failed', { status: response.status, body: errorText })
    throw new Error(`Token exchange failed (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  }
}

function buildAuthorizeUrl(
  config: NutrientOAuthConfig,
  redirectUri: string,
  codeChallenge: string,
  state: string,
): string {
  const url = new URL(config.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)

  if (config.scopes.length > 0) {
    url.searchParams.set('scope', config.scopes.join(' '))
  }

  if (config.resource) {
    url.searchParams.set('resource', config.resource)
  }

  return url.toString()
}

async function performBrowserOAuthFlow(config: NutrientOAuthConfig): Promise<CachedCredentials> {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  const state = randomBytes(16).toString('hex')

  return new Promise<CachedCredentials>((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', `http://localhost`)
        if (url.pathname !== '/callback') {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        const error = url.searchParams.get('error')
        if (error) {
          const description = url.searchParams.get('error_description') ?? error
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end(`<html><body><h1>Authorization Failed</h1><p>${description}</p><p>You can close this tab.</p></body></html>`)
          server.close()
          reject(new Error(`OAuth authorization failed: ${description}`))
          return
        }

        const returnedState = url.searchParams.get('state')
        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Invalid State</h1><p>OAuth state mismatch. Please try again.</p></body></html>')
          server.close()
          reject(new Error('OAuth state mismatch'))
          return
        }

        const code = url.searchParams.get('code')
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Missing Code</h1><p>No authorization code received.</p></body></html>')
          server.close()
          reject(new Error('No authorization code received'))
          return
        }

        const cbPort = config.callbackPort ?? DEFAULT_CALLBACK_PORT
        const redirectUri = `http://localhost:${cbPort}/callback`

        const credentials = await exchangeCodeForToken(config, code, codeVerifier, redirectUri)

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Authenticated!</h1><p>You can close this tab and return to your terminal.</p></body></html>')
        server.close()
        resolve(credentials)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Error</h1><p>Something went wrong during authentication.</p></body></html>')
        server.close()
        reject(err)
      }
    })

    const callbackPort = config.callbackPort ?? DEFAULT_CALLBACK_PORT

    server.listen(callbackPort, '127.0.0.1', async () => {
      const redirectUri = `http://localhost:${callbackPort}/callback`
      const authorizeUrl = buildAuthorizeUrl(config, redirectUri, codeChallenge, state)

      logger.info('OAuth callback server listening', { port: callbackPort, redirectUri })
      logger.debug('Authorize URL', { authorizeUrl })

      // Dynamic import to avoid bundling issues — `open` is an ESM-only package
      const { default: open } = await import('open')
      logger.info('Opening browser for Nutrient authentication...')
      await open(authorizeUrl)
    })

    server.on('error', reject)
  })
}

/**
 * Returns a valid Nutrient DWS API access token.
 *
 * Checks cached credentials first, attempts token refresh if expired,
 * and falls back to a browser-based OAuth flow if no valid token is available.
 */
export async function getToken(config: NutrientOAuthConfig): Promise<string> {
  const credentialsPath = config.credentialsPath ?? DEFAULT_CREDENTIALS_PATH

  logger.debug('getToken called', { clientId: config.clientId, credentialsPath })

  // 1. Check cached token
  const cached = await readCachedCredentials(credentialsPath)

  if (cached) {
    // 2. Valid token — return it
    if (!isTokenExpired(cached)) {
      logger.debug('Using cached token (not expired)')
      return cached.accessToken
    }

    logger.debug('Cached token expired', { expiresAt: cached.expiresAt ? new Date(cached.expiresAt).toISOString() : 'unknown' })

    // 3. Expired but has refresh token — try refresh
    if (cached.refreshToken) {
      logger.info('Attempting token refresh')
      const refreshed = await refreshAccessToken(config, cached.refreshToken)
      if (refreshed) {
        logger.info('Token refreshed successfully')
        await writeCachedCredentials(credentialsPath, refreshed)
        return refreshed.accessToken
      }
      logger.warn('Token refresh failed, falling back to browser flow')
    }
  } else {
    logger.info('No cached credentials found')
  }

  // 4. No valid token — browser OAuth flow
  logger.info('Starting browser OAuth flow', { authorizeUrl: config.authorizeUrl, clientId: config.clientId })
  const credentials = await performBrowserOAuthFlow(config)
  logger.info('Browser OAuth flow completed successfully')
  await writeCachedCredentials(credentialsPath, credentials)
  return credentials.accessToken
}
