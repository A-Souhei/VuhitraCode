import * as path from "path"
import { Instance } from "../project/instance"

export async function isGitignored(filepath: string): Promise<boolean> {
  const worktree = Instance.worktree
  const relative = path.relative(worktree, filepath)
  if (relative.startsWith("..")) return false
  try {
    const proc = Bun.spawn(["git", "check-ignore", "-q", relative], {
      cwd: worktree,
      stdout: "ignore",
      stderr: "ignore",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return true
  }
}

/**
 * Extracts potential file paths from inline code strings (used by python -c, node -e, etc.)
 * Looks for string literals that appear to be file paths.
 */
export function extractPathsFromCode(code: string): string[] {
  const paths: string[] = []
  // Match single-quoted strings, double-quoted strings, and template literals
  // We capture strings that could be file paths:
  // 1. Paths with separators (/ or \)
  // 2. Strings with file extensions (.txt, .env, .csv, .json, .yaml, etc.)
  const stringPatterns = [
    // Triple-quoted strings (Python) - must match before single quotes
    /'''([\s\S]*?)'''/g,
    /"""([\s\S]*?)"""/g,
    // Single-quoted strings (with escape handling for \' and \\)
    /'([^'\\]*(?:\\.[^'\\]*)*)'/g,
    // Double-quoted strings (with escape handling for \" and \\)
    /"([^"\\]*(?:\\.[^"\\]*)*)"/g,
    // Template literals (with escape handling)
    /`([^`\\]*(?:\\.[^`\\]*)*)`/g,
  ]

  // Common file extensions that indicate a file path
  const fileExtensionPattern = /\.[a-zA-Z0-9]{1,10}$/
  // Extensions that are typically NOT file paths (common JS/TS imports)
  const excludeExtensions = new Set([
    "js",
    "ts",
    "jsx",
    "tsx",
    "mjs",
    "cjs",
    "json",
    "css",
    "scss",
    "html",
    "vue",
    "svelte",
  ])

  for (const pattern of stringPatterns) {
    let match
    while ((match = pattern.exec(code)) !== null) {
      const extracted = match[1]
      if (!extracted) continue

      // Filter out things that look like URLs or imports
      if (extracted.startsWith("http") || extracted.startsWith("//")) continue

      // Check if this looks like a file path:
      // 1. Contains path separator
      // 2. Has a file extension (but not common import extensions)
      const hasSeparator = extracted.includes("/") || extracted.includes("\\")
      const extMatch = extracted.match(fileExtensionPattern)
      const hasValidExtension = extMatch && !excludeExtensions.has(extMatch[0].slice(1))

      if (hasSeparator || hasValidExtension) {
        // Unescape common escape sequences in the extracted string
        // Handles: \\ -> \, \' -> ', \" -> ", \n -> newline, \t -> tab, etc.
        const unescaped = extracted
          .replace(/\\\\/g, "\x00") // Temporarily replace \\ with null char
          .replace(/\\'/g, "'") // Unescape \'
          .replace(/\\"/g, '"') // Unescape \"
          .replace(/\\n/g, "\n") // Unescape \n
          .replace(/\\t/g, "\t") // Unescape \t
          .replace(/\\r/g, "\r") // Unescape \r
          .replace(/\x00/g, "\\") // Restore single backslash
        paths.push(unescaped)
      }
    }
  }

  return paths
}
