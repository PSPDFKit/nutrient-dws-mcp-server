import type { RequestHandler } from 'express'
import { randomUUID } from 'node:crypto'
import { logger as globalLogger, setRequestId } from '../logger.js'

type HttpLogLevel = 'debug' | 'info'
type HttpLoggerMeta = Record<string, unknown>
type HttpLogger = (level: HttpLogLevel, message: string, meta?: HttpLoggerMeta) => void

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

function defaultLogger(level: HttpLogLevel, message: string, meta?: HttpLoggerMeta) {
  const payload = meta ? `${message} ${JSON.stringify(meta)}` : message
  globalLogger.log({ level, message: payload })
}

function inspectBody(body: unknown) {
  if (typeof body === 'string') {
    return body
  }

  if (Buffer.isBuffer(body)) {
    return body.toString('utf8')
  }

  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

function sendInterceptor(
  res: Parameters<RequestHandler>[1],
  send: Parameters<RequestHandler>[1]['send'],
  onSend: (content: unknown) => void,
) {
  return ((content?: unknown) => {
    onSend(content)
    res.send = send
    return res.send(content as never)
  }) as typeof res.send
}

export function createRequestLoggerMiddleware(options?: { logger?: HttpLogger }): RequestHandler {
  const logger = options?.logger ?? defaultLogger

  return (req, res, next) => {
    const requestIdHeader = req.headers['x-request-id']
    const requestId = (typeof requestIdHeader === 'string' ? requestIdHeader : requestIdHeader?.[0]) ?? randomUUID()

    setRequestId(requestId)
    res.setHeader('x-request-id', requestId)

    logger('info', `<<< ${req.method} ${req.url}`)

    if (req.body !== undefined) {
      logger('debug', inspectBody(req.body))
    }

    let responseBody: unknown

    res.send = sendInterceptor(res, res.send.bind(res), (content) => {
      responseBody = content
    })

    res.on('finish', () => {
      setRequestId(requestId)
      logger('info', `>>> Sent ${res.statusCode}`)

      if (responseBody !== undefined) {
        logger('debug', inspectBody(responseBody))
      }
    })

    next()
  }
}
