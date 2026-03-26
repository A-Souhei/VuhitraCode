// Canonicalization utilities for biblion and memento cache improvement
// This module provides LOCAL (non-LLM) functions to normalize and extract
// structured data from session summaries and entries for deduplication.

export namespace Canonicalize {
  // Configuration
  export const SIMILARITY_THRESHOLD = 0.95 // For deduplication

  // Result of canonicalization
  export interface CanonicalResult {
    query: string // Canonical form of the query
    tags: string[] // Auto-generated tags
    problem?: string // Optional problem description
    context?: string // Optional additional context
    solution?: string // Optional solution description
    steps?: string[] // Optional step-by-step breakdown
  }

  // ─── Language and framework detection ─────────────────────────────────────────

  const LANGUAGES = [
    "typescript",
    "javascript",
    "python",
    "rust",
    "go",
    "java",
    "c\\+\\+",
    "c#",
    "ruby",
    "php",
    "swift",
    "kotlin",
    "scala",
    "r",
    "matlab",
    "bash",
    "shell",
    "powershell",
    "sql",
    "html",
    "css",
  ]

  const FRAMEWORKS = [
    "react",
    "vue",
    "angular",
    "svelte",
    "next\\.js",
    "nuxt",
    "remix",
    "express",
    "fastify",
    "nest",
    "django",
    "flask",
    "fastapi",
    "rails",
    "spring",
    "bun",
    "deno",
    "node",
    "electron",
    "tauri",
    "tailwind",
    "prisma",
    "drizzle",
    "trpc",
    "graphql",
    "rest",
  ]

  const CONCEPTS = [
    "async",
    "await",
    "promise",
    "callback",
    "middleware",
    "error-handling",
    "validation",
    "authentication",
    "authorization",
    "caching",
    "database",
    "migration",
    "schema",
    "api",
    "rest",
    "websocket",
    "grpc",
    "crud",
    "pagination",
    "filtering",
    "streaming",
    "batch",
    "transaction",
    "rollback",
    "hook",
    "context",
    "state",
    "rendering",
    "ssr",
    "csr",
    "isr",
    "routing",
    "proxy",
    "load-balancing",
  ]

  // ─── Regex patterns ───────────────────────────────────────────────────────────

  const UPPER_CAMEL = /[A-Z][a-z]+(?:[A-Z][a-z]+)+/
  const PATTERN_NAME = /\b([a-z]+(?:-[a-z]+)+)\b/
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
  const TIMESTAMP = /\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|\d+\s*(?:ms|s|min|hour|day)/gi
  const SESSION_ID = /ses_[a-z0-9]+/gi
  const FILE_PATH = /\/[a-zA-Z0-9_./-]+/g
  const URL_PATTERN = /https?:\/\/[^\s]+/gi
  const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  const REDACTED = /\[REDACTED\]/gi

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen - 3) + "..."
  }

  function removeNoise(text: string): string {
    return text
      .replace(UUID, "")
      .replace(SESSION_ID, "")
      .replace(TIMESTAMP, "")
      .replace(URL_PATTERN, "")
      .replace(EMAIL_PATTERN, "")
      .replace(FILE_PATH, "")
      .replace(REDACTED, "")
      .replace(/\s+/g, " ")
      .trim()
  }

  function extractMatches(text: string, patterns: string[]): string[] {
    const found: string[] = []
    for (const p of patterns) {
      const re = new RegExp(`\\b${p}\\b`, "gi")
      let m
      while ((m = re.exec(text)) !== null) {
        found.push(m[0].toLowerCase())
      }
    }
    return [...new Set(found)]
  }

  function inferType(content: string, type: string): string {
    const lower = content.toLowerCase()
    if (type === "structure") {
      if (lower.includes("schema") || lower.includes("table")) return "database schema"
      if (lower.includes("class") || lower.includes("interface")) return "type definition"
      if (lower.includes("config") || lower.includes("settings")) return "configuration"
      return "structure"
    }
    if (type === "pattern") {
      if (lower.includes("error") || lower.includes("exception")) return "error handling"
      if (lower.includes("cache")) return "caching"
      if (lower.includes("auth")) return "authentication"
      if (lower.includes("async")) return "async pattern"
      if (lower.includes("middleware")) return "middleware"
      return "pattern"
    }
    if (type === "issue" || type === "resolution") {
      if (lower.includes("fix") || lower.includes("bug")) return "bug fix"
      if (lower.includes("workaround")) return "workaround"
      if (lower.includes("optimize") || lower.includes("perf")) return "performance"
      if (lower.includes("security") || lower.includes("vuln")) return "security"
      return type
    }
    return type
  }

  // ─── extractQuery ─────────────────────────────────────────────────────────────

  export function extractQuery(content: string, type: string): string {
    const cleaned = removeNoise(content)
    const inferred = inferType(cleaned, type)
    let query = ""

    switch (type) {
      case "structure": {
        // Extract entity names (e.g., "UserSchema structure")
        const names = cleaned.match(UPPER_CAMEL) ?? []
        const unique = [...new Set(names)].slice(0, 3)
        if (unique.length > 0) {
          query = unique.join(", ") + " " + inferred
        } else {
          // Fallback: extract first capitalized words
          const words = cleaned
            .split(" ")
            .filter((w) => w[0] === w[0].toUpperCase())
            .slice(0, 3)
          query = words.length > 0 ? words.join(", ") + " " + inferred : inferred
        }
        break
      }
      case "pattern": {
        // Extract pattern name + context
        const patterns = cleaned.match(PATTERN_NAME)
        if (patterns && patterns.length > 0) {
          query = patterns[0] + " " + inferred
        } else {
          const words = cleaned
            .split(" ")
            .filter((w) => w.length > 3)
            .slice(0, 4)
          query = words.join(" ") + " " + inferred
        }
        break
      }
      case "issue":
      case "resolution": {
        // Extract the core problem/solution
        const sentences = cleaned.split(/[.!?]+/).filter((s) => s.trim().length > 10)
        if (sentences.length > 0) {
          query = truncate(sentences[0].trim(), 100)
        } else {
          query = truncate(cleaned, 100)
        }
        break
      }
      case "dependency": {
        // Extract package/module names
        const words = cleaned.match(/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*/g) ?? []
        const unique = [...new Set(words)].filter((w) => w.length > 2).slice(0, 5)
        query = unique.join(", ") || inferred
        break
      }
      case "api": {
        // Extract endpoint or function names
        const words = cleaned.match(/[A-Z][a-z]+|[a-z]+(?:-[a-z]+)+/g) ?? []
        const unique = [...new Set(words)].slice(0, 4)
        query = unique.length > 0 ? unique.join(", ") + " api" : inferred
        break
      }
      case "config": {
        // Extract config keys and context
        const keys = cleaned.match(/[A-Z_][A-Z0-9_]*/g) ?? []
        if (keys.length > 0) {
          query = keys.slice(0, 4).join(", ") + " config"
        } else {
          query = inferred
        }
        break
      }
      case "workflow": {
        // Extract workflow steps summary
        const words = cleaned
          .split(" ")
          .filter((w) => w.length > 3)
          .slice(0, 6)
        query = words.join(" ") || inferred
        break
      }
      case "procedure":
      case "command": {
        // Extract command or procedure name
        const words = cleaned
          .split(" ")
          .filter((w) => w.length > 1)
          .slice(0, 5)
        query = words.join(" ") || inferred
        break
      }
      case "finding": {
        // Extract key finding
        const sentences = cleaned.split(/[.!?]+/).filter((s) => s.trim().length > 5)
        query = sentences.length > 0 ? truncate(sentences[0].trim(), 100) : truncate(cleaned, 100)
        break
      }
      case "script": {
        // Extract script purpose
        const words = cleaned
          .split(" ")
          .filter((w) => w.length > 2)
          .slice(0, 6)
        query = (words.join(" ") + " script").trim() || inferred
        break
      }
      case "log":
      case "branch": {
        // Brief summary
        const words = cleaned
          .split(" ")
          .filter((w) => w.length > 2)
          .slice(0, 5)
        query = words.join(" ") || inferred
        break
      }
      default: {
        query = truncate(cleaned, 100)
      }
    }

    return truncate(query.replace(/\s+/g, " ").trim(), 100)
  }

  // ─── extractTags ──────────────────────────────────────────────────────────────

  export function extractTags(content: string, type: string): string[] {
    const lower = content.toLowerCase()
    const tags: string[] = []

    // Add type as first tag
    tags.push(type)

    // Extract languages
    const langs = extractMatches(lower, LANGUAGES)
    tags.push(...langs)

    // Extract frameworks
    const frameworks = extractMatches(lower, FRAMEWORKS)
    tags.push(...frameworks)

    // Extract concepts
    const concepts = extractMatches(lower, CONCEPTS)
    tags.push(...concepts)

    // Add inferred type tag
    const inferred = inferType(content, type)
    if (inferred !== type) {
      tags.push(inferred)
    }

    // Remove duplicates and limit to 10
    const unique = [...new Set(tags)]
    return unique.slice(0, 10)
  }

  // ─── createCanonicalResult ───────────────────────────────────────────────────

  export function createCanonicalResult(content: string, type: string, existingTags?: string[]): CanonicalResult {
    const query = extractQuery(content, type)
    const tags = extractTags(content, type)

    // Combine with existing tags if provided
    const combinedTags =
      existingTags && existingTags.length > 0 ? [...new Set([...tags, ...existingTags])].slice(0, 10) : tags

    const result: CanonicalResult = {
      query,
      tags: combinedTags,
    }

    // Extract optional metadata based on type
    const cleaned = removeNoise(content)

    if (type === "issue" || type === "resolution") {
      const sentences = cleaned.split(/[.!?]+/).filter((s) => s.trim().length > 15)
      if (sentences.length > 1) {
        result.problem = sentences[0].trim()
        result.solution = sentences.slice(1).join(". ").trim()
      }
    }

    if (type === "procedure" || type === "workflow") {
      const steps = cleaned
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 5 && s.length < 100)
        .slice(0, 5)
      if (steps.length > 1) {
        result.steps = steps
      }
    }

    return result
  }
}
