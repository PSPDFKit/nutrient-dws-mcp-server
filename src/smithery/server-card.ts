type JsonObject = Record<string, unknown>

type UserConfigProperty = {
  type?: unknown
  title?: unknown
  description?: unknown
  default?: unknown
  required?: unknown
}

type ConfigSchemaProperty = {
  type: 'string' | 'number' | 'boolean'
  title?: string
  description?: string
  default?: unknown
  'x-order': number
}

type ConfigSchema = {
  type: 'object'
  properties: Record<string, ConfigSchemaProperty>
  required?: string[]
}

type ShapedTool = {
  name: unknown
  description?: unknown
  inputSchema: JsonObject
  annotations?: unknown
  outputSchema?: unknown
}

type ShapedPromptArgument = {
  name: unknown
  description?: unknown
  required?: unknown
}

type ShapedPrompt = {
  name: unknown
  description?: unknown
  arguments?: ShapedPromptArgument[]
}

type BuildDeployPayloadInput = {
  initializeResult: {
    serverInfo: {
      name: string
      version: string
    }
  }
  tools: readonly unknown[]
  prompts: readonly unknown[]
  manifest: {
    user_config?: unknown
  }
  serverJson: {
    description: string
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function userConfigToConfigSchema(userConfig: unknown): ConfigSchema {
  const properties: Record<string, ConfigSchemaProperty> = {}
  const required: string[] = []
  const entries = isObject(userConfig) ? Object.entries(userConfig) : []

  entries.forEach(([key, rawProperty], index) => {
    const property = (isObject(rawProperty) ? rawProperty : {}) as UserConfigProperty
    const type = property.type === 'number' || property.type === 'boolean' ? property.type : 'string'
    const schemaProperty: ConfigSchemaProperty = {
      type,
      'x-order': index,
    }

    if (typeof property.title === 'string') {
      schemaProperty.title = property.title
    }
    if (typeof property.description === 'string') {
      schemaProperty.description = property.description
    }
    if (Object.prototype.hasOwnProperty.call(property, 'default')) {
      schemaProperty.default = property.default
    }
    if (property.required === true) {
      required.push(key)
    }

    properties[key] = schemaProperty
  })

  const schema: ConfigSchema = {
    type: 'object',
    properties,
  }
  if (required.length > 0) {
    schema.required = required
  }

  return schema
}

export function shapeTools(tools: readonly unknown[]): ShapedTool[] {
  return tools.map((rawTool) => {
    const tool = isObject(rawTool) ? rawTool : {}
    const inputSchema = isObject(tool.inputSchema) ? { ...tool.inputSchema } : {}
    if (inputSchema.type === undefined) {
      inputSchema.type = 'object'
    }

    const shaped: ShapedTool = {
      name: tool.name,
      inputSchema,
    }
    if (tool.description !== undefined) {
      shaped.description = tool.description
    }
    if (tool.annotations !== undefined && tool.annotations !== null) {
      shaped.annotations = tool.annotations
    }
    if (tool.outputSchema !== undefined && tool.outputSchema !== null) {
      shaped.outputSchema = tool.outputSchema
    }

    return shaped
  })
}

export function shapePrompts(prompts: readonly unknown[]): ShapedPrompt[] {
  return prompts.map((rawPrompt) => {
    const prompt = isObject(rawPrompt) ? rawPrompt : {}
    const shaped: ShapedPrompt = { name: prompt.name }

    if (prompt.description !== undefined) {
      shaped.description = prompt.description
    }
    if (Array.isArray(prompt.arguments)) {
      shaped.arguments = prompt.arguments.map((rawArgument) => {
        const argument = isObject(rawArgument) ? rawArgument : {}
        const shapedArgument: ShapedPromptArgument = { name: argument.name }

        if (argument.description !== undefined) {
          shapedArgument.description = argument.description
        }
        if (argument.required !== undefined) {
          shapedArgument.required = argument.required
        }

        return shapedArgument
      })
    }

    return shaped
  })
}

export function buildServerInfo({
  name,
  version,
  serverJsonDescription,
}: {
  name: string
  version: string
  serverJsonDescription: string
}) {
  return {
    name,
    version,
    title: 'Nutrient DWS MCP Server',
    description: serverJsonDescription,
    websiteUrl: 'https://www.nutrient.io/api/',
  }
}

export function buildDeployPayload({
  initializeResult,
  tools,
  prompts,
  manifest,
  serverJson,
}: BuildDeployPayloadInput) {
  return {
    type: 'stdio' as const,
    runtime: 'node' as const,
    configSchema: userConfigToConfigSchema(manifest.user_config),
    serverCard: {
      serverInfo: buildServerInfo({
        name: initializeResult.serverInfo.name,
        version: initializeResult.serverInfo.version,
        serverJsonDescription: serverJson.description,
      }),
      tools: shapeTools(tools),
      prompts: shapePrompts(prompts),
    },
  }
}

export function validateDeployPayload(payload: unknown): string[] {
  const problems: string[] = []
  if (!isObject(payload)) {
    return ['payload must be an object']
  }

  if (payload.type !== 'stdio') {
    problems.push('type must be "stdio"')
  }
  if (!['node', 'binary', 'python', 'bun'].includes(String(payload.runtime))) {
    problems.push('runtime must be one of "node", "binary", "python", or "bun"')
  }

  if (!isObject(payload.configSchema) || payload.configSchema.type !== 'object') {
    problems.push('configSchema must be an object schema')
  }

  const serverCard = isObject(payload.serverCard) ? payload.serverCard : undefined
  const serverInfo = serverCard && isObject(serverCard.serverInfo) ? serverCard.serverInfo : undefined
  if (!serverInfo || typeof serverInfo.name !== 'string' || serverInfo.name.length === 0) {
    problems.push('serverInfo.name must be a non-empty string')
  }
  if (!serverInfo || typeof serverInfo.version !== 'string' || serverInfo.version.length === 0) {
    problems.push('serverInfo.version must be a non-empty string')
  }

  const tools = serverCard?.tools
  if (tools !== undefined && !Array.isArray(tools)) {
    problems.push('serverCard.tools must be an array')
  } else if (Array.isArray(tools)) {
    tools.forEach((rawTool, index) => {
      const tool = isObject(rawTool) ? rawTool : undefined
      if (!tool || !isObject(tool.inputSchema) || tool.inputSchema.type !== 'object') {
        problems.push(`serverCard.tools[${index}].inputSchema must be an object schema`)
      }
    })
  }

  const prompts = serverCard?.prompts
  if (prompts !== undefined && !Array.isArray(prompts)) {
    problems.push('serverCard.prompts must be an array')
  } else if (Array.isArray(prompts)) {
    const allowedPromptKeys = new Set(['name', 'description', 'arguments'])
    const allowedArgumentKeys = new Set(['name', 'description', 'required'])

    prompts.forEach((rawPrompt, promptIndex) => {
      if (!isObject(rawPrompt)) {
        problems.push(`serverCard.prompts[${promptIndex}] must be an object`)
        return
      }

      for (const key of Object.keys(rawPrompt)) {
        if (!allowedPromptKeys.has(key)) {
          problems.push(`serverCard.prompts[${promptIndex}] has unsupported key "${key}"`)
        }
      }

      if (rawPrompt.arguments !== undefined && !Array.isArray(rawPrompt.arguments)) {
        problems.push(`serverCard.prompts[${promptIndex}].arguments must be an array`)
      } else if (Array.isArray(rawPrompt.arguments)) {
        rawPrompt.arguments.forEach((rawArgument, argumentIndex) => {
          if (!isObject(rawArgument)) {
            problems.push(`serverCard.prompts[${promptIndex}].arguments[${argumentIndex}] must be an object`)
            return
          }

          for (const key of Object.keys(rawArgument)) {
            if (!allowedArgumentKeys.has(key)) {
              problems.push(
                `serverCard.prompts[${promptIndex}].arguments[${argumentIndex}] has unsupported key "${key}"`,
              )
            }
          }
        })
      }
    })
  }

  return problems
}

export function assertVersionsAgree({
  expected,
  packageJsonVersion,
  serverVersion,
}: {
  expected: string
  packageJsonVersion: string
  serverVersion: string
}): void {
  if (expected !== packageJsonVersion || expected !== serverVersion) {
    throw new Error(
      `Version mismatch: expected=${expected}, package.json=${packageJsonVersion}, running server=${serverVersion}`,
    )
  }
}
