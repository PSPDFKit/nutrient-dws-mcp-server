import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createRequestLoggerMiddleware, isMcpDebugLoggingEnabled } from '../src/http/requestLogger.js'

type LogEntry = {
  level: 'debug' | 'info'
  message: string
  meta?: Record<string, unknown>
}

describe('request logger middleware', () => {
  it('logs request and response with redacted sensitive headers', async () => {
    const entries: LogEntry[] = []
    const logger = (level: 'debug' | 'info', message: string, meta?: Record<string, unknown>) => {
      entries.push({ level, message, meta })
    }

    const app = express()
    app.use(express.json())
    app.use(createRequestLoggerMiddleware({ logger }))
    app.post('/mcp', (req, res) => {
      res.status(200).json({
        ok: true,
        echo: req.body,
      })
    })

    const response = await request(app)
      .post('/mcp')
      .set('authorization', 'Bearer super-secret')
      .set('x-request-id', 'request-123')
      .send({ jsonrpc: '2.0', method: 'initialize' })

    expect(response.status).toBe(200)

    const requestStarted = entries.find((entry) => entry.message === 'HTTP request started')
    expect(requestStarted).toBeDefined()
    expect(requestStarted?.meta?.requestId).toBe('request-123')
    expect((requestStarted?.meta?.headers as Record<string, unknown>).authorization).toBe('[REDACTED]')

    const requestBodyLog = entries.find((entry) => entry.message === 'HTTP request body')
    expect(requestBodyLog?.meta?.body).toEqual({ jsonrpc: '2.0', method: 'initialize' })

    const requestFinished = entries.find((entry) => entry.message === 'HTTP request finished')
    expect(requestFinished?.meta?.statusCode).toBe(200)

    const responseBodyLog = entries.find((entry) => entry.message === 'HTTP response body')
    expect(JSON.parse(responseBodyLog?.meta?.body as string)).toEqual({
      ok: true,
      echo: { jsonrpc: '2.0', method: 'initialize' },
    })
  })
})

describe('isMcpDebugLoggingEnabled', () => {
  it('recognizes common truthy values', () => {
    expect(isMcpDebugLoggingEnabled({ MCP_DEBUG_LOGGING: 'true' })).toBe(true)
    expect(isMcpDebugLoggingEnabled({ MCP_DEBUG_LOGGING: '1' })).toBe(true)
    expect(isMcpDebugLoggingEnabled({ MCP_DEBUG_LOGGING: 'on' })).toBe(true)
  })

  it('returns false for unset or falsey values', () => {
    expect(isMcpDebugLoggingEnabled({})).toBe(false)
    expect(isMcpDebugLoggingEnabled({ MCP_DEBUG_LOGGING: 'false' })).toBe(false)
    expect(isMcpDebugLoggingEnabled({ MCP_DEBUG_LOGGING: '0' })).toBe(false)
  })
})
