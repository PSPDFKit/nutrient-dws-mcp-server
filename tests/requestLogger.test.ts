import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createRequestLoggerMiddleware, isMcpDebugLoggingEnabled } from '../src/http/requestLogger.js'

type LogEntry = {
  level: 'debug' | 'info'
  message: string
}

describe('request logger middleware', () => {
  it('logs request and response in readable arrow format', async () => {
    const entries: LogEntry[] = []
    const logger = (level: 'debug' | 'info', message: string) => {
      entries.push({ level, message })
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
    expect(response.headers['x-request-id']).toBe('request-123')

    expect(entries).toContainEqual({ level: 'info', message: '<<< POST /mcp' })

    expect(entries).toContainEqual({
      level: 'debug',
      message: JSON.stringify({ jsonrpc: '2.0', method: 'initialize' }),
    })

    expect(entries).toContainEqual({ level: 'info', message: '>>> Sent 200' })

    expect(entries).toContainEqual({
      level: 'debug',
      message: JSON.stringify({
        ok: true,
        echo: { jsonrpc: '2.0', method: 'initialize' },
      }),
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
