import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import winston from 'winston'

type RequestContext = {
  requestId?: string
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>()

/**
 * Sets the request ID used for logging for the current asynchronous execution context.
 */
export function setRequestId(requestId: string) {
  const store = asyncLocalStorage.getStore()

  if (store) {
    store.requestId = requestId
    return
  }

  asyncLocalStorage.enterWith({ requestId })
}

function getRequestId() {
  const store = asyncLocalStorage.getStore()
  return store?.requestId ?? null
}

const customMessageFormat = winston.format.printf(({ level, message, timestamp, service: _service, ...meta }) => {
  const requestId = getRequestId()
  const serializedMessage = typeof message === 'string' ? message : JSON.stringify(message)
  const metaStr = Object.keys(meta).length > 0 ? ' ' + JSON.stringify(meta) : ''

  if (requestId) {
    return `${timestamp} [${level}]: ${serializedMessage}${metaStr} requestId=${requestId}`
  }

  return `${timestamp} [${level}]: ${serializedMessage}${metaStr}`
})

const isStdioMode = process.env.MCP_TRANSPORT !== 'http'
const logFilePath = process.env.MCP_LOG_FILE || (isStdioMode ? join(tmpdir(), 'nutrient-dws-mcp-server.log') : undefined)

function createTransports(): winston.transport[] {
  // In stdio mode, Console transport interferes with MCP protocol — use file only
  if (logFilePath) {
    return [
      new winston.transports.File({
        filename: logFilePath,
        format: winston.format.combine(
          winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
          customMessageFormat,
        ),
      }),
    ]
  }

  return [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
        winston.format.colorize(),
        winston.format.json(),
        customMessageFormat,
      ),
    }),
  ]
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'dws-mcp-server' },
  transports: createTransports(),
})
