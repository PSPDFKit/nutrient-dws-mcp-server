import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * Creates a success response with a message
 */
export function createSuccessResponse(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: false,
  }
}

/**
 * Creates an error response with a message
 */
export function createErrorResponse(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}
