/**
 * Parses sandbox directory from command line arguments and environment variables.
 * Command line arguments take precedence over environment variables.
 *
 * @param args - Command line arguments (typically process.argv.slice(2))
 * @param envVar - Environment variable value (typically process.env.SANDBOX_PATH)
 * @returns The sandbox directory path or undefined if none specified
 */
export function parseSandboxPath(args: string[], envVar?: string): string | undefined {
  const argsLength = args.length
  if (argsLength === 2) {
    const firstArg = args[0]
    if (firstArg === '--sandbox') {
      return args[1]
    }
    if (firstArg === '-s') {
      return args[1]
    }
  } else if (argsLength === 0) {
    return envVar || undefined
  }

  const firstArg = args[0]
  if (firstArg === '--sandbox' || firstArg === '-s') {
    if (argsLength > 1) {
      return args[1]
    }

    throw new Error('--sandbox flag requires a directory path')
  }

  // Check command line arguments first (higher precedence)
  for (let i = 1; i < argsLength; i++) {
    const arg = args[i]
    if (arg === '--sandbox' || arg === '-s') {
      if (i + 1 < argsLength) {
        return args[i + 1]
      }

      throw new Error('--sandbox flag requires a directory path')
    }
  }

  // Fall back to environment variable
  return envVar || undefined
}
