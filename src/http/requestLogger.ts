import type { RequestHandler } from 'express'
import { randomUUID } from 'node:crypto'

type HttpLogLevel = 'debug' | 'info'
type HttpLoggerMeta = Record<string, unknown>
type HttpLogger = (level: HttpLogLevel, message: string, meta?: HttpLoggerMeta) => void

const REDACTED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key'])

function parseDebugFlag(value?: string): boolean {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function isMcpDebugLoggingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseDebugFlag(env.MCP_DEBUG_LOGGING)
}

function sanitizeHeaders(headers: Record<string, string | string[] | undefined>) {
  const sanitized: Record<string, string | string[]> = {}

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }

    if (REDACTED_HEADERS.has(name.toLowerCase())) {
      sanitized[name] = '[REDACTED]'
      continue
    }

    sanitized[name] = value
  }

  return sanitized
}

function defaultLogger(level: HttpLogLevel, message: string, meta?: HttpLoggerMeta) {
  const timestamp = new Date().toISOString()
  const payload = meta ? `${message} ${JSON.stringify(meta)}` : message

  if (level === 'debug') {
    console.debug(`${timestamp} [DEBUG] ${payload}`)
    return
  }

  console.info(`${timestamp} [INFO] ${payload}`)
}

export function createRequestLoggerMiddleware(options?: { logger?: HttpLogger }): RequestHandler {
  const logger = options?.logger ?? defaultLogger

  return (req, res, next) => {
    const requestIdHeader = req.headers['x-request-id']
    const requestId =
      (typeof requestIdHeader === 'string' ? requestIdHeader : requestIdHeader?.[0]) ?? randomUUID()

    res.setHeader('x-request-id', requestId)

    const context = {
      requestId,
      method: req.method,
      path: req.originalUrl,
    }

    logger('info', 'HTTP request started', {
      ...context,
      headers: sanitizeHeaders(req.headers as Record<string, string | string[] | undefined>),
    })

    if (req.body !== undefined) {
      logger('debug', 'HTTP request body', {
        ...context,
        body: req.body,
      })
    }

    const startedAt = process.hrtime.bigint()
    let responseBody: unknown

    const originalSend = res.send.bind(res)
    res.send = ((body?: unknown) => {
      responseBody = body
      return originalSend(body as never)
    }) as typeof res.send

    const originalJson = res.json.bind(res)
    res.json = ((body?: unknown) => {
      responseBody = body
      return originalJson(body as never)
    }) as typeof res.json

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

      logger('info', 'HTTP request finished', {
        ...context,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      })

      if (responseBody !== undefined) {
        logger('debug', 'HTTP response body', {
          ...context,
          body: responseBody,
        })
      }
    })

    next()
  }
}
