import { AsyncLocalStorage } from 'node:async_hooks'
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

const customMessageFormat = winston.format.printf(({ level, message, timestamp }) => {
  const requestId = getRequestId()
  const serializedMessage = typeof message === 'string' ? message : JSON.stringify(message)

  if (requestId) {
    return `${timestamp} [${level}]: ${serializedMessage} requestId=${requestId}`
  }

  return `${timestamp} [${level}]: ${serializedMessage}`
})

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  format: winston.format.json(),
  defaultMeta: { service: 'dws-mcp-server' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
        winston.format.colorize(),
        winston.format.json(),
        customMessageFormat,
      ),
    }),
  ],
})
