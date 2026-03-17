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
    // Template literals (with escape handling and ${} expression support)
    /`((?:[^`\\$]|\\.|\$(?!\{)|\$\{[^}]*\})*)`/g,
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

/**
 * Extracts potential bare file paths from shell command code.
 * Used for shell interpreters like bash, sh, zsh, fish where arguments
 * are often not quoted.
 *
 * A token is considered a potential file path if:
 * - It contains a path separator (/)
 * - OR it has a file extension pattern (.xxx)
 * - AND it's not a shell keyword or common command
 */
export function extractBarePaths(code: string): string[] {
  const paths: string[] = []

  // Shell keywords that should be excluded
  const shellKeywords = new Set([
    "if",
    "else",
    "elif",
    "fi",
    "case",
    "esac",
    "for",
    "while",
    "until",
    "do",
    "done",
    "in",
    "select",
    "function",
    "time",
    "coproc",
    "!",
  ])

  // Common shell commands that should be excluded (not file paths)
  const commonCommands = new Set([
    "cat",
    "ls",
    "echo",
    "printf",
    "read",
    "cd",
    "pwd",
    "pushd",
    "popd",
    "mkdir",
    "rmdir",
    "rm",
    "cp",
    "mv",
    "touch",
    "chmod",
    "chown",
    "ln",
    "head",
    "tail",
    "less",
    "more",
    "wc",
    "sort",
    "uniq",
    "cut",
    "paste",
    "grep",
    "sed",
    "awk",
    "find",
    "xargs",
    "tee",
    "tr",
    "basename",
    "dirname",
    "realpath",
    "readlink",
    "stat",
    "file",
    "du",
    "df",
    "mount",
    "umount",
    "ps",
    "kill",
    "killall",
    "top",
    "htop",
    "bg",
    "fg",
    "jobs",
    "nohup",
    "tar",
    "gzip",
    "gunzip",
    "zip",
    "unzip",
    "curl",
    "wget",
    "ssh",
    "scp",
    "rsync",
    "git",
    "svn",
    "hg",
    "diff",
    "patch",
    "make",
    "cmake",
    "gcc",
    "g++",
    "clang",
    "node",
    "python",
    "python3",
    "ruby",
    "perl",
    "php",
    "java",
    "javac",
    "go",
    "rustc",
    "cargo",
    "npm",
    "yarn",
    "pnpm",
    "bun",
    "pip",
    "pip3",
    "gem",
    "composer",
    "docker",
    "docker-compose",
    "kubectl",
    "systemctl",
    "journalctl",
    "iptables",
    "ufw",
    "crontab",
    "at",
    "watch",
    "env",
    "export",
    "unset",
    "set",
    "source",
    "alias",
    "unalias",
    "type",
    "which",
    "whereis",
    "man",
    "info",
    "help",
    "history",
    "clear",
    "exit",
    "true",
    "false",
    "test",
    "[",
    "[[",
    "return",
    "break",
    "continue",
    "shift",
    "getopts",
    "eval",
    "exec",
    "trap",
    "wait",
    "suspend",
  ])

  // Common file extensions pattern
  const fileExtensionPattern = /\.[a-zA-Z0-9]{1,10}$/

  // Shell operators
  const shellOperators = new Set(["|", "||", "&&", ";", "&", ">", ">>", "<", "<<", "2>", "2>>"])

  // Tokenize shell commands, handling quoted strings
  // Matches: unquoted words, double-quoted strings, single-quoted strings
  const tokens = code.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) || []

  for (const token of tokens) {
    // Skip empty tokens
    if (!token) continue

    // Skip comments (shell comments start with #)
    if (token.startsWith("#")) continue

    // Skip shell keywords
    if (shellKeywords.has(token)) continue

    // Skip common commands
    if (commonCommands.has(token)) continue

    // Skip flags/options (starting with -)
    if (token.startsWith("-")) continue

    // Skip shell variables (starting with $)
    if (token.startsWith("$")) continue

    // Skip shell operators
    if (shellOperators.has(token)) continue

    // Check if this looks like a file path:
    // 1. Contains path separator
    // 2. OR has a file extension
    const hasSeparator = token.includes("/") || token.includes("\\")
    // Strip surrounding quotes for extension check
    const strippedToken = token.replace(/^["']|["']$/g, "")
    const hasExtension = fileExtensionPattern.test(strippedToken)

    if (hasSeparator || hasExtension) {
      paths.push(token)
    }
  }

  return paths
}
