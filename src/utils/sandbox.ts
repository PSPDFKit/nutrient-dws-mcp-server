/**
 * Parses sandbox directory from command line arguments and environment variables.
 * Command line arguments take precedence over environment variables.
 *
 * @param args - Command line arguments (typically process.argv.slice(2))
 * @param envVar - Environment variable value (typically process.env.SANDBOX_PATH)
 * @returns The sandbox directory path or undefined if none specified
 */
export function parseSandboxPath(args: string[], envVar?: string): string | undefined {
  if (args.length === 0) {
    return envVar || undefined
  }

  let sandboxPath: string | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--sandbox' || arg === '-s') {
      if (i + 1 < args.length) {
        sandboxPath = args[i + 1]
        i += 1
        continue
      }

      throw new Error('--sandbox flag requires a directory path')
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown CLI flag: ${arg}`)
    }

    throw new Error(`Unexpected argument: ${arg}`)
  }

  return sandboxPath || envVar || undefined
}
