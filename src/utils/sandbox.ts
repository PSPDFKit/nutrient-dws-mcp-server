/**
 * Parses sandbox directory from command line arguments and environment variables.
 * Command line arguments take precedence over environment variables.
 * 
 * @param args - Command line arguments (typically process.argv.slice(2))
 * @param envVar - Environment variable value (typically process.env.SANDBOX_PATH)
 * @returns The sandbox directory path or undefined if none specified
 */
export function parseSandboxPath(args: string[], envVar?: string): string | undefined {
  // Check command line arguments first (higher precedence)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sandbox' || args[i] === '-s') {
      if (i + 1 < args.length) {
        return args[i + 1]
      } else {
        throw new Error('--sandbox flag requires a directory path')
      }
    }
  }

  // Fall back to environment variable
  return envVar || undefined
}