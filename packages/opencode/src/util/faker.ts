import * as path from "path"
import * as fs from "fs/promises"
import { Instance } from "../project/instance"

// Field names that suggest sensitive content
const SENSITIVE_KEY =
  /password|passwd|secret|token|api[_\-.]?key|apikey|auth(?:entication|orization)?|credential|private[_\-.]?key|dsn|database[_\-.]?url|db[_\-.]?url|connection[_\-.]?string|access[_\-.]?(?:key|secret)|webhook[_\-.]?secret|signing[_\-.]?key|encryption[_\-.]?key|bearer|oauth|jwt|client[_\-.]?secret|app[_\-.]?secret|master[_\-.]?key|salt|passphrase|private[_\-.]?token|session[_\-.]?secret/i

// Column headers that suggest PII in tabular data (fallback when no pii.yml)
const PII_COLUMN =
  /\b(?:first[_\-.]?name|last[_\-.]?name|full[_\-.]?name|display[_\-.]?name|email|phone|mobile|tel(?:ephone)?|address|street|city|zip|postal|dob|birth(?:day|date)?|ssn|social[_\-.]?security|credit[_\-.]?card|card[_\-.]?number|iban|ip[_\-.]?(?:addr(?:ess)?)?|user(?:name)?|login|account[_\-.]?(?:name|number))\b/i

/**
 * Load PII column config.
 * Lookup order:
 *   1. {worktree}/.sensible.yaml   (project-local, not committed)
 *   2. {worktree}/.opencode/pii.yml (opencode folder fallback)
 *
 * Format (same for both files):
 *   customers.csv:
 *     - email
 *     - phone
 *
 * Returns a map of filename → Set of column names.
 */
async function loadPiiConfig(): Promise<Map<string, Set<string>>> {
  const candidates = [
    path.join(Instance.worktree, ".sensible.yaml"),
    path.join(Instance.worktree, ".opencode", "pii.yml"),
  ]

  for (const configPath of candidates) {
    try {
      const content = await fs.readFile(configPath, "utf-8")
      const result = new Map<string, Set<string>>()
      let currentFile: string | null = null
      for (const line of content.split("\n")) {
        const fileMatch = line.match(/^([^\s#:][^:]*\.(?:csv|tsv))\s*:\s*$/)
        if (fileMatch) {
          currentFile = fileMatch[1].trim()
          result.set(currentFile, new Set())
          continue
        }
        if (currentFile) {
          const colMatch = line.match(/^\s+-\s+(\S+)/)
          if (colMatch) result.get(currentFile)!.add(colMatch[1].trim())
        }
      }
      return result
    } catch {
      // file not found, try next candidate
    }
  }

  return new Map()
}

export namespace Faker {
  /**
   * Fake sensitive values in file content based on file extension.
   * Returns the faked content string.
   */
  export async function fakeContent(content: string, filepath: string): Promise<string> {
    const ext = path.extname(filepath).toLowerCase()
    const base = path.basename(filepath).toLowerCase()

    if (base === ".env" || ext === ".env" || /\.env\.\w+$/.test(base)) return fakeEnv(content)
    if (ext === ".json") return fakeJson(content)
    if (ext === ".csv" || ext === ".tsv") {
      const piiConfig = await loadPiiConfig()
      return fakeCsv(content, ext === ".tsv" ? "\t" : ",", path.basename(filepath), piiConfig)
    }
    if (ext === ".yml" || ext === ".yaml") return fakeYaml(content)
    if (ext === ".ini" || ext === ".cfg" || ext === ".conf" || ext === ".properties") return fakeIni(content)
    if (ext === ".toml") return fakeToml(content)
    if (
      [
        ".r", ".py", ".js", ".ts", ".jsx", ".tsx",
        ".rb", ".go", ".php", ".java", ".cs", ".swift",
        ".kt", ".sh", ".bash", ".zsh", ".fish",
      ].includes(ext)
    )
      return fakeSourceCode(content)

    // Unknown format: try env-style as best-effort fallback
    return fakeEnv(content)
  }

  // ---------------------------------------------------------------------------
  // Format handlers
  // ---------------------------------------------------------------------------

  function fakeEnv(content: string): string {
    // Matches: KEY=value  KEY="value"  KEY='value'  export KEY=value
    return content.replace(/^(\s*(?:export\s+)?([A-Z_][A-Z0-9_.]*)\s*=\s*)(.*)/gim, (_match, prefix, key, rawVal) => {
      if (!SENSITIVE_KEY.test(key)) return _match
      const val = rawVal.trim().replace(/^(["'])(.*)\1$/, "$2")
      const quote = rawVal.trim().startsWith('"') ? '"' : rawVal.trim().startsWith("'") ? "'" : ""
      return `${prefix}${quote}${fakeValue(val)}${quote}`
    })
  }

  function fakeJson(content: string): string {
    try {
      const obj = JSON.parse(content)
      return JSON.stringify(fakeObject(obj), null, 2)
    } catch {
      // Not valid JSON — fall back to line-by-line
      return fakeIni(content)
    }
  }

  function fakeObject(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(fakeObject)
    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        if (SENSITIVE_KEY.test(key) && typeof val === "string") {
          result[key] = fakeValue(val)
        } else {
          result[key] = fakeObject(val)
        }
      }
      return result
    }
    return obj
  }

  function fakeIni(content: string): string {
    // key = value  or  key: value  (skip section headers and comments)
    return content.replace(/^(\s*([^=:#\[;\s][^=:]*?)\s*[=:]\s*)(.+)$/gm, (_match, prefix, key, val) => {
      if (!SENSITIVE_KEY.test(key.trim())) return _match
      return `${prefix}${fakeValue(val.trim())}`
    })
  }

  function fakeToml(content: string): string {
    // TOML: key = "value" or key = 'value' or key = value
    return content.replace(/^(\s*(\w[\w.\-]*)\s*=\s*)(["']?)(.+?)\3\s*$/gm, (_match, prefix, key, quote, val) => {
      if (!SENSITIVE_KEY.test(key.trim())) return _match
      return `${prefix}${quote}${fakeValue(val)}${quote}`
    })
  }

  function fakeSourceCode(content: string): string {
    // The entire file is gitignored → treat all string literals as sensitive.
    // Replace every quoted string value with a type-aware fake, preserving
    // code structure, variable names, keywords, and comments.

    // Handle Python/R/shell triple-quoted strings first ("""...""" and '''...''')
    let result = content
      .replace(/"""([\s\S]*?)"""/g, (_m, val) => `"""${fakeValue(val.trim()) || "redacted"}"""`)
      .replace(/'''([\s\S]*?)'''/g, (_m, val) => `'''${fakeValue(val.trim()) || "redacted"}'''`)

    // Replace all remaining double-quoted string literals
    result = result.replace(/"((?:[^"\\]|\\.)*)"/g, (_m, val) => {
      // Skip empty strings and strings that look like format placeholders / regex / HTML tags
      if (!val || /^[{}%<>]/.test(val) || val === "*" || val === "?" || val === ".") return _m
      return `"${fakeValue(val) || "example_value"}"`
    })

    // Replace all remaining single-quoted string literals
    // Skip single-char literals (common in C-family languages for char type)
    result = result.replace(/'((?:[^'\\]|\\.)*)'/g, (_m, val) => {
      if (!val || val.length === 1) return _m
      if (/^[{}%<>]/.test(val) || val === "*" || val === "?" || val === ".") return _m
      return `'${fakeValue(val) || "example_value"}'`
    })

    return result
  }

  function fakeYaml(content: string): string {
    // YAML: key: value  or  key: "value"  (handles leading whitespace for nesting)
    return content.replace(/^(\s*([\w][\w.\-]*)\s*:\s*)(["']?)(.+?)\3\s*$/gm, (_match, prefix, key, quote, val) => {
      if (!SENSITIVE_KEY.test(key.trim())) return _match
      return `${prefix}${quote}${fakeValue(val)}${quote}`
    })
  }

  function fakeCsv(content: string, sep: string, filename: string, piiConfig: Map<string, Set<string>>): string {
    const lines = content.split("\n")
    if (lines.length === 0) return content

    const headers = parseCsvRow(lines[0], sep)
    const declaredColumns = piiConfig.get(filename)

    const sensitiveIndices = headers
      .map((h, i) => {
        const clean = h.replace(/^["']|["']$/g, "").trim()
        if (declaredColumns) return declaredColumns.has(clean) ? i : -1
        return PII_COLUMN.test(clean) ? i : -1
      })
      .filter((i) => i !== -1)

    if (sensitiveIndices.length === 0) return content

    return lines
      .map((line, lineIdx) => {
        if (lineIdx === 0) return line
        if (!line.trim()) return line
        const cols = parseCsvRow(line, sep)
        sensitiveIndices.forEach((colIdx) => {
          if (cols[colIdx] !== undefined) {
            cols[colIdx] = fakePii(headers[colIdx] ?? "")
          }
        })
        return cols.join(sep)
      })
      .join("\n")
  }

  function parseCsvRow(line: string, sep: string): string[] {
    // Simple CSV parser — handles quoted fields
    const result: string[] = []
    let current = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"' && !inQuotes) {
        inQuotes = true
      } else if (ch === '"' && inQuotes) {
        inQuotes = false
      } else if (ch === sep && !inQuotes) {
        result.push(current)
        current = ""
      } else {
        current += ch
      }
    }
    result.push(current)
    return result
  }

  // ---------------------------------------------------------------------------
  // Value-type detection and faking
  // ---------------------------------------------------------------------------

  function fakeValue(value: string): string {
    if (!value || value === '""' || value === "''") return value

    // JWT: three base64url segments
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
      return "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJleGFtcGxlIn0.fake_sig_redacted"
    }

    // UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return "00000000-0000-0000-0000-000000000000"
    }

    // Database / service URLs with embedded credentials
    const dbUrl = value.match(/^([a-z][a-z0-9+\-.]*):\/\/([^:@/?#]*)(:([^@/?#]*))?@(.+)$/i)
    if (dbUrl) {
      return `${dbUrl[1]}://user:fakepassword@localhost${dbUrl[5].replace(/^[^/?#]*/, "")}`
    }

    // Known vendor key prefixes
    const prefix = value.match(/^(sk-|pk-|rk-|tok_|key-|ghp_|gho_|github_pat_|xoxb-|xoxp-|xoxa-|xoxs-|Bearer |basic )/i)
    if (prefix) {
      const p = prefix[1]
      return `${p}${"x".repeat(Math.max(16, Math.min(value.length - p.length, 32)))}`
    }

    // Hex string of known lengths
    if (/^[0-9a-f]+$/i.test(value) && [16, 32, 40, 48, 64, 128].includes(value.length)) {
      return "0".repeat(value.length)
    }

    // Base64 (>16 chars)
    if (/^[A-Za-z0-9+/]+=*$/.test(value) && value.length > 16 && value.length % 4 === 0) {
      return "ZmFrZXZhbHVlcmVkYWN0ZWQ="
    }

    // Email
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      return "user@example.com"
    }

    // URL (no credentials)
    if (/^https?:\/\/\S+/.test(value)) {
      return "https://example.com"
    }

    // Fallback
    return "example_value"
  }

  function fakePii(columnName: string): string {
    const col = columnName.toLowerCase()
    if (/email/.test(col)) return "user@example.com"
    if (/phone|mobile|tel/.test(col)) return "+1-555-0100"
    if (/first/.test(col)) return "John"
    if (/last/.test(col)) return "Doe"
    if (/name/.test(col)) return "John Doe"
    if (/address|street/.test(col)) return "123 Example Street"
    if (/city/.test(col)) return "Springfield"
    if (/zip|postal/.test(col)) return "00000"
    if (/dob|birth/.test(col)) return "1970-01-01"
    if (/ssn|social/.test(col)) return "000-00-0000"
    if (/ip/.test(col)) return "0.0.0.0"
    if (/user|login/.test(col)) return "example_user"
    if (/account/.test(col)) return "000000000"
    if (/card|iban/.test(col)) return "0000-0000-0000-0000"
    return "REDACTED"
  }
}
