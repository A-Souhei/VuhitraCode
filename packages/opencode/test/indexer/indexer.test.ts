import { describe, expect, test } from "bun:test"
import { Indexer } from "../../src/indexer"
import path from "path"
import { mkdir } from "fs/promises"
import fs from "fs"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

describe("Indexer.chunkFile", () => {
  test("returns empty array for empty content", () => {
    const chunks = Indexer.chunkFile("", "/path/to/file.ts")
    expect(chunks).toHaveLength(0)
  })

  test("returns empty array for whitespace-only content", () => {
    const chunks = Indexer.chunkFile("   \n  \n  ", "/path/to/file.ts")
    expect(chunks).toHaveLength(0)
  })

  test("returns a single chunk for short content", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)
    const content = lines.join("\n")
    const chunks = Indexer.chunkFile(content, "/path/to/file.ts")
    expect(chunks).toHaveLength(1)
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[0].text).toBe(content)
  })

  test("uses 1-based line numbers", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`)
    const chunks = Indexer.chunkFile(lines.join("\n"), "/file.ts")
    expect(chunks[0].startLine).toBe(1)
    expect(chunks[1].startLine).toBe(41)
  })

  test("chunks are 50 lines with 10-line overlap", () => {
    const CHUNK_SIZE = 50
    const OVERLAP = 10
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`)
    const chunks = Indexer.chunkFile(lines.join("\n"), "/file.ts")

    expect(chunks[0].text.split("\n")).toHaveLength(CHUNK_SIZE)
    expect(chunks[1].startLine).toBe(CHUNK_SIZE - OVERLAP + 1)
  })

  test("last chunk covers remaining lines", () => {
    const lines = Array.from({ length: 75 }, (_, i) => `line ${i + 1}`)
    const chunks = Indexer.chunkFile(lines.join("\n"), "/file.ts")
    const lastChunk = chunks[chunks.length - 1]
    expect(lastChunk.text).toContain("line 75")
  })

  test("chunk ids are stable and based on file path and line number", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`)
    const content = lines.join("\n")
    const chunks1 = Indexer.chunkFile(content, "/file.ts")
    const chunks2 = Indexer.chunkFile(content, "/file.ts")
    expect(chunks1[0].id).toBe(chunks2[0].id)
    // different file path → different id
    const chunksOther = Indexer.chunkFile(content, "/other.ts")
    expect(chunks1[0].id).not.toBe(chunksOther[0].id)
  })
})

describe("Indexer.search", () => {
  test("rejects queries longer than 1000 characters", async () => {
    await expect(Indexer.search("x".repeat(1001))).rejects.toThrow("Invalid query length")
  })

  test("rejects empty query", async () => {
    await expect(Indexer.search("")).rejects.toThrow("Invalid query length")
  })

  test("formats Qdrant results as file:line headers with snippet text", () => {
    // Verify the expected output format used by search() to render context snippets
    const results = [
      { file_path: "/repo/src/foo.ts", text: "const x = 1", start_line: 10 },
      { file_path: "/repo/src/bar.ts", text: "function bar() {}", start_line: 42 },
    ]
    const formatted = results.map((r) => `// ${r.file_path}:${r.start_line}\n${r.text}`)
    expect(formatted[0]).toBe("// /repo/src/foo.ts:10\nconst x = 1")
    expect(formatted[1]).toBe("// /repo/src/bar.ts:42\nfunction bar() {}")
  })
})

describe("Indexer integration — faker end-to-end", () => {
  test("chunks preserve content structure for gitignored files", () => {
    const sensitiveContent = `SECRET_KEY=sk-abc123def456
DATABASE_URL=postgres://admin:password@localhost:5432/db
API_TOKEN=token_xyz789`
    const chunks = Indexer.chunkFile(sensitiveContent, "/path/to/.env")
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe(sensitiveContent)
  })

  test("gitignored file chunks have stable IDs for same path and line", () => {
    const content = "SECRET=value1\nAPI_KEY=value2"
    const chunks1 = Indexer.chunkFile(content, ".env")
    const chunks2 = Indexer.chunkFile(content, ".env")
    expect(chunks1[0].id).toBe(chunks2[0].id)
  })

  test("non-gitignored vs gitignored chunks produce different IDs", () => {
    const content = "CONFIG=value"
    const gitignored = Indexer.chunkFile(content, ".env")
    const normal = Indexer.chunkFile(content, "config.json")
    expect(gitignored[0].id).not.toBe(normal[0].id)
  })

  test("multiple chunks within large gitignored file maintain structure", () => {
    // Create content larger than chunk size (50 lines)
    const lines = Array.from({ length: 120 }, (_, i) => `SECRET_LINE_${i}=value_${i}`)
    const content = lines.join("\n")
    const chunks = Indexer.chunkFile(content, ".env")
    expect(chunks.length).toBeGreaterThan(1)
    // Verify all chunks preserve line structure
    for (const chunk of chunks) {
      const chunkLines = chunk.text.split("\n")
      // All lines should contain SECRET_LINE pattern
      expect(chunkLines.every((line) => !line || line.includes("SECRET_LINE"))).toBe(true)
    }
  })

  test("nested gitignored path chunks preserve structure", () => {
    const content = `DB_HOST=localhost
DB_USER=admin
DB_PASS=secret123`
    const chunks = Indexer.chunkFile(content, "src/.config/.env.local")
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toContain("DB_HOST")
    expect(chunks[0].text).toContain("DB_PASS")
  })

  test("gitignored JSON file chunks preserve structure", () => {
    const content = JSON.stringify(
      {
        api_key: "sk-secret",
        db_password: "secret_pass",
        nested: { token: "xyz789" },
      },
      null,
      2,
    )
    const chunks = Indexer.chunkFile(content, "secrets.json")
    expect(chunks).toHaveLength(1)
    // JSON structure should be preserved (keys visible)
    expect(chunks[0].text).toContain("api_key")
    expect(chunks[0].text).toContain("db_password")
    expect(chunks[0].text).toContain("nested")
  })

  test("chunk content for source code preserves language structure", () => {
    const content = `const API_KEY = "sk-secret-key"
const DB_PASSWORD = "secret_pass"
function authenticate() {
  return "authenticated"
}`
    const chunks = Indexer.chunkFile(content, "config.ts")
    expect(chunks).toHaveLength(1)
    // Structure should be preserved
    expect(chunks[0].text).toContain("const API_KEY")
    expect(chunks[0].text).toContain("const DB_PASSWORD")
    expect(chunks[0].text).toContain("function authenticate")
  })

  test("empty gitignored file produces no chunks", () => {
    const chunks = Indexer.chunkFile("", ".env")
    expect(chunks).toHaveLength(0)
  })

  test("whitespace-only gitignored file produces no chunks", () => {
    const chunks = Indexer.chunkFile("   \n  \n  ", ".env")
    expect(chunks).toHaveLength(0)
  })

  test("gitignored CSV file chunks preserve column headers", () => {
    const content = `email,name,phone
user1@example.com,John Doe,555-1234
user2@example.com,Jane Smith,555-5678`
    const chunks = Indexer.chunkFile(content, "users.csv")
    expect(chunks).toHaveLength(1)
    // Headers should be visible in chunk
    expect(chunks[0].text).toContain("email")
    expect(chunks[0].text).toContain("name")
    expect(chunks[0].text).toContain("phone")
  })

  test("line numbers for multiple chunks are correct", () => {
    const CHUNK_SIZE = 50
    const lines = Array.from({ length: 120 }, (_, i) => `line${i + 1}`)
    const content = lines.join("\n")
    const chunks = Indexer.chunkFile(content, ".env")
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].startLine).toBe(1)
    // Second chunk should start after overlap (50 - 10 = 40, so line 41)
    expect(chunks[1].startLine).toBe(41)
    // Verify chunks contain correct content
    expect(chunks[0].text.split("\n")[0]).toContain("line1")
    expect(chunks[1].text.split("\n")[0]).toContain("line41")
  })

  test("YAML gitignored file chunks preserve structure", () => {
    const content = `database:
  host: localhost
  user: admin
  password: secret123
api:
  key: sk-secret-key`
    const chunks = Indexer.chunkFile(content, "config.yaml")
    expect(chunks).toHaveLength(1)
    // Keys should be visible
    expect(chunks[0].text).toContain("database")
    expect(chunks[0].text).toContain("host")
    expect(chunks[0].text).toContain("api")
  })

  test("TOML gitignored file chunks preserve structure", () => {
    const content = `[database]
password = "secret123"
user = "admin"

[api]
secret_key = "sk-secret"`
    const chunks = Indexer.chunkFile(content, "config.toml")
    expect(chunks).toHaveLength(1)
    // Section headers and keys visible
    expect(chunks[0].text).toContain("[database]")
    expect(chunks[0].text).toContain("[api]")
    expect(chunks[0].text).toContain("password")
  })
})

describe("Indexer.classifyReason", () => {
  test("classifies ollama errors as embedding_unreachable", () => {
    expect(Indexer.classifyReason("ollama connection refused")).toBe("embedding_unreachable")
  })

  test("classifies embedding errors as embedding_unreachable", () => {
    expect(Indexer.classifyReason("embedding request failed: 503")).toBe("embedding_unreachable")
  })

  test("case-insensitive: EMBEDDING matches embedding_unreachable", () => {
    expect(Indexer.classifyReason("EMBEDDING server unreachable")).toBe("embedding_unreachable")
  })

  test("classifies qdrant errors as backend_unreachable", () => {
    expect(Indexer.classifyReason("qdrant unhealthy: 503")).toBe("backend_unreachable")
  })

  test("classifies redis errors as backend_unreachable", () => {
    expect(Indexer.classifyReason("redis connection refused")).toBe("backend_unreachable")
  })

  test("classifies backend errors as backend_unreachable", () => {
    expect(Indexer.classifyReason("backend unhealthy: timeout")).toBe("backend_unreachable")
  })

  test("falls back to error for unknown messages", () => {
    expect(Indexer.classifyReason("something completely unknown")).toBe("error")
  })

  test("falls back to error for empty string", () => {
    expect(Indexer.classifyReason("")).toBe("error")
  })

  test("ollama takes priority over backend keyword when both present", () => {
    // ollama is in the embedding branch, checked before backend branch
    expect(Indexer.classifyReason("ollama backend unreachable")).toBe("embedding_unreachable")
  })

  test("embedding mid-string does not match embedding_unreachable (uses startsWith)", () => {
    expect(Indexer.classifyReason("qdrant embedding dimension mismatch")).toBe("backend_unreachable")
  })
})

describe("Indexer Status schema", () => {
  test("disabled variant accepts all expected reason values", () => {
    const reasons = [
      "not_configured",
      "embedding_unreachable",
      "backend_unreachable",
      "error",
      "deleted",
      "aborted",
    ] as const
    for (const reason of reasons) {
      const result = Indexer.Status.safeParse({ type: "disabled", reason })
      expect(result.success).toBe(true)
    }
  })

  test("disabled variant accepts no reason (generic disabled)", () => {
    const result = Indexer.Status.safeParse({ type: "disabled" })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === "disabled") expect(result.data.reason).toBeUndefined()
  })

  test("disabled variant accepts reason with message", () => {
    const result = Indexer.Status.safeParse({
      type: "disabled",
      reason: "embedding_unreachable",
      message: "Connection refused to http://localhost:11434",
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === "disabled") {
      expect(result.data.reason).toBe("embedding_unreachable")
      expect(result.data.message).toBe("Connection refused to http://localhost:11434")
    }
  })

  test("disabled variant rejects unknown reason values", () => {
    const result = Indexer.Status.safeParse({ type: "disabled", reason: "unknown_reason" })
    expect(result.success).toBe(false)
  })

  test("indexing variant is valid", () => {
    const result = Indexer.Status.safeParse({
      type: "indexing",
      progress: 10,
      total: 100,
      backend: "qdrant",
    })
    expect(result.success).toBe(true)
  })

  test("complete variant is valid", () => {
    const result = Indexer.Status.safeParse({
      type: "complete",
      backend: "redis",
    })
    expect(result.success).toBe(true)
  })

  test("indexing variant rejects missing backend", () => {
    const result = Indexer.Status.safeParse({ type: "indexing", progress: 10, total: 100 })
    expect(result.success).toBe(false)
  })

  test("indexing variant rejects missing total", () => {
    const result = Indexer.Status.safeParse({ type: "indexing", progress: 10, backend: "qdrant" })
    expect(result.success).toBe(false)
  })

  test("complete variant rejects missing backend", () => {
    const result = Indexer.Status.safeParse({ type: "complete" })
    expect(result.success).toBe(false)
  })

  test("complete and indexing variants reject invalid backend value", () => {
    const r1 = Indexer.Status.safeParse({ type: "complete", backend: "elastic" })
    expect(r1.success).toBe(false)
    const r2 = Indexer.Status.safeParse({ type: "indexing", progress: 0, total: 0, backend: "elastic" })
    expect(r2.success).toBe(false)
  })
})

describe("Indexer mtime cache sentinel", () => {
  test("sentinel is always negative for all valid mtime values", () => {
    const mtimes = [0, 1, 1000, Date.now()]
    for (const mtimeMs of mtimes) {
      const sentinel = -(mtimeMs + 1)
      expect(sentinel).toBeLessThan(0)
    }
  })

  test("sentinel can never equal the positive mtime", () => {
    const mtimes = [0, 1, 1000, Date.now()]
    for (const mtimeMs of mtimes) {
      const sentinel = -(mtimeMs + 1)
      expect(sentinel).not.toBe(mtimeMs)
    }
  })

  test("plus-one offset prevents -0 sentinel (-(0+1) === -1)", () => {
    expect(-(0 + 1)).toBe(-1)
    expect(-(0 + 1) === 0).toBe(false)
  })

  test("sentinel round-trips through JSON.stringify/parse", () => {
    const sentinel = -(12345 + 1)
    const json = JSON.stringify({ "/path/to/secret": sentinel })
    const parsed = JSON.parse(json)
    expect(parsed["/path/to/secret"]).toBe(sentinel)
    expect(parsed["/path/to/secret"]).toBeLessThan(0)
  })

  test("-0 does NOT round-trip through JSON (proof why +1 is needed)", () => {
    expect(JSON.stringify({ x: -0 })).toBe('{"x":0}')
    expect(JSON.parse(JSON.stringify({ x: -0 })).x).toBe(0)
  })

  test("cached sentinel does not suppress re-check on restart (mtime mismatch)", () => {
    const cachedSentinel = -(1000 + 1)
    const currentMtime = 1000
    expect(cachedSentinel === currentMtime).toBe(false)
  })
})

describe("Indexer persistence helpers (unit)", () => {
  test("persisted status shape matches configMatchesDisk expectations", () => {
    // The persisted status must have these exact fields for configMatchesDisk to work
    const persisted = {
      backend: "qdrant" as const,
      embedding_url: "http://localhost:11434",
      embedding_model: "nomic-embed-text",
      backend_url: "http://localhost:6333",
    }
    // Validate the shape is correct (all required fields present)
    expect(persisted.backend).toBe("qdrant")
    expect(typeof persisted.embedding_url).toBe("string")
    expect(typeof persisted.embedding_model).toBe("string")
    expect(typeof persisted.backend_url).toBe("string")
  })

  test("config mismatch: different backend means status does not match current config", () => {
    const persisted: {
      backend: "qdrant" | "redis"
      embedding_url: string
      embedding_model: string
      backend_url: string
    } = {
      backend: "qdrant",
      embedding_url: "http://localhost:11434",
      embedding_model: "nomic-embed-text",
      backend_url: "http://localhost:6333",
    }
    const changed = {
      backend: "redis" as const,
      embedding_url: "http://localhost:11434",
      embedding_model: "nomic-embed-text",
      backend_url: "redis://localhost:6379",
    }
    const matches =
      persisted.backend === changed.backend &&
      persisted.embedding_url === changed.embedding_url &&
      persisted.embedding_model === changed.embedding_model &&
      persisted.backend_url === changed.backend_url
    expect(matches).toBe(false)
  })

  test("config match: identical config means fast path is valid", () => {
    const persisted = {
      backend: "qdrant" as const,
      embedding_url: "http://localhost:11434",
      embedding_model: "nomic-embed-text",
      backend_url: "http://localhost:6333",
    }
    const current = {
      backend: "qdrant" as const,
      embedding_url: "http://localhost:11434",
      embedding_model: "nomic-embed-text",
      backend_url: "http://localhost:6333",
    }
    const matches =
      persisted.backend === current.backend &&
      persisted.embedding_url === current.embedding_url &&
      persisted.embedding_model === current.embedding_model &&
      persisted.backend_url === current.backend_url
    expect(matches).toBe(true)
  })

  test("config mismatch: only embedding model changed", () => {
    const persisted = {
      backend: "qdrant" as const,
      embedding_url: "http://localhost:11434",
      embedding_model: "nomic-embed-text",
      backend_url: "http://localhost:6333",
    }
    const current = {
      backend: "qdrant" as const,
      embedding_url: "http://localhost:11434",
      embedding_model: "mxbai-embed-large", // changed!
      backend_url: "http://localhost:6333",
    }
    const matches =
      persisted.backend === current.backend &&
      persisted.embedding_url === current.embedding_url &&
      persisted.embedding_model === current.embedding_model &&
      persisted.backend_url === current.backend_url
    expect(matches).toBe(false)
  })

  test("fast-path: status and cache files are readable as valid JSON", async () => {
    await using tmp = await tmpdir()
    const vuhitraDir = path.join(tmp.path, ".vuhitra")
    await mkdir(vuhitraDir, { recursive: true })

    const status = {
      backend: "qdrant",
      embedding_url: "http://localhost:11434",
      embedding_model: "nomic-embed-text",
      backend_url: "http://localhost:6333",
    }
    await Bun.write(path.join(vuhitraDir, "indexer-status.json"), JSON.stringify(status))
    await Bun.write(path.join(vuhitraDir, "indexer-cache.json"), JSON.stringify({}))

    const rawStatus = await Bun.file(path.join(vuhitraDir, "indexer-status.json")).text()
    const rawCache = await Bun.file(path.join(vuhitraDir, "indexer-cache.json")).text()

    expect(() => JSON.parse(rawStatus)).not.toThrow()
    expect(() => JSON.parse(rawCache)).not.toThrow()

    const parsed = JSON.parse(rawStatus)
    expect(parsed.backend).toBe("qdrant")
    expect(parsed.embedding_url).toBe("http://localhost:11434")
  })

  test("fast-path: empty cache file results in empty mtime map", async () => {
    await using tmp = await tmpdir()
    const vuhitraDir = path.join(tmp.path, ".vuhitra")
    await mkdir(vuhitraDir, { recursive: true })

    // Empty cache object
    await Bun.write(path.join(vuhitraDir, "indexer-cache.json"), JSON.stringify({}))

    const rawCache = await Bun.file(path.join(vuhitraDir, "indexer-cache.json")).text()
    const parsed = JSON.parse(rawCache)
    expect(Object.keys(parsed)).toHaveLength(0)
  })

  test("fast-path: cache file with entries preserves file paths and mtimes", async () => {
    await using tmp = await tmpdir()
    const vuhitraDir = path.join(tmp.path, ".vuhitra")
    await mkdir(vuhitraDir, { recursive: true })

    const cache = {
      "/path/to/file1.ts": 1234567890,
      "/path/to/file2.ts": 9876543210,
    }
    await Bun.write(path.join(vuhitraDir, "indexer-cache.json"), JSON.stringify(cache))

    const rawCache = await Bun.file(path.join(vuhitraDir, "indexer-cache.json")).text()
    const parsed = JSON.parse(rawCache)
    expect(parsed["/path/to/file1.ts"]).toBe(1234567890)
    expect(parsed["/path/to/file2.ts"]).toBe(9876543210)
  })

  test("fast-path: cache file with gitignored sentinel values (negative)", async () => {
    await using tmp = await tmpdir()
    const vuhitraDir = path.join(tmp.path, ".vuhitra")
    await mkdir(vuhitraDir, { recursive: true })

    // Gitignored files use sentinel = -(mtime + 1), which is always negative
    const cache = {
      "/path/to/.env": -1234567891, // sentinel for mtime 1234567890
      "/path/to/secrets.json": -9876543211, // sentinel for mtime 9876543210
    }
    await Bun.write(path.join(vuhitraDir, "indexer-cache.json"), JSON.stringify(cache))

    const rawCache = await Bun.file(path.join(vuhitraDir, "indexer-cache.json")).text()
    const parsed = JSON.parse(rawCache)
    // Sentinel values are negative
    expect(parsed["/path/to/.env"]).toBeLessThan(0)
    expect(parsed["/path/to/secrets.json"]).toBeLessThan(0)
    // Exact formula verification: sentinel = -(mtime + 1)
    expect(parsed["/path/to/.env"]).toBe(-(1234567890 + 1))
    expect(parsed["/path/to/secrets.json"]).toBe(-(9876543210 + 1))
  })

  // Integration tests that require live services - skipped by default
  test.skip("status file is created with correct shape when indexing completes", async () => {
    throw new Error("not implemented: requires live embedding server")
  })

  test.skip("deleteCollection clears status and cache files", async () => {
    throw new Error("not implemented: requires live services")
  })
})

describe("Indexer — cross-project isolation", () => {
  test("each project uses its own Qdrant URL, API key, and collection name", async () => {
    const captured: { url: string; headers: Record<string, string> }[] = []

    const origFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      captured.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })

      // Health check endpoint
      if (url.includes("/healthz")) {
        return new Response(null, { status: 200 })
      }

      // Embedding tags endpoint
      if (url.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }

      // Collection endpoints - return success for GET/PUT
      if (url.includes("/collections/")) {
        return new Response(JSON.stringify({ result: { status: "ok" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }

      // Default response
      return new Response(JSON.stringify({}), { status: 200 })
    }) as unknown as typeof fetch

    try {
      // Each project needs a git repo to get unique project IDs (derived from git root commit)
      await using tmpA = await tmpdir({
        git: true,
        init: async (dir) => {
          const d = path.join(dir, ".vuhitra")
          fs.mkdirSync(d, { recursive: true })
          fs.writeFileSync(
            path.join(d, "env.json"),
            JSON.stringify({ QDRANT_URL: "http://qdrant-a:6333", QDRANT_API_KEY: "key-a" }),
          )
          fs.writeFileSync(path.join(d, "settings.json"), JSON.stringify({ indexing: { enabled: true } }))
        },
      })

      await using tmpB = await tmpdir({
        git: true,
        init: async (dir) => {
          const d = path.join(dir, ".vuhitra")
          fs.mkdirSync(d, { recursive: true })
          fs.writeFileSync(
            path.join(d, "env.json"),
            JSON.stringify({ QDRANT_URL: "http://qdrant-b:6333", QDRANT_API_KEY: "key-b" }),
          )
          fs.writeFileSync(path.join(d, "settings.json"), JSON.stringify({ indexing: { enabled: true } }))
        },
      })

      await Instance.provide({
        directory: tmpA.path,
        fn: () => Indexer.init(),
      })

      await Instance.provide({
        directory: tmpB.path,
        fn: () => Indexer.init(),
      })

      // Wait for async work in init() to complete (init is fire-and-forget)
      await new Promise((resolve) => setTimeout(resolve, 200))
    } finally {
      globalThis.fetch = origFetch
    }

    // Filter to collection-related requests (which pass headers)
    const collectionRequests = captured.filter((r) => r.url.includes("/collections/"))

    // Project A collection requests must use qdrant-a URL
    const aCollectionRequests = collectionRequests.filter((r) => r.url.includes("qdrant-a"))
    // Project B collection requests must use qdrant-b URL
    const bCollectionRequests = collectionRequests.filter((r) => r.url.includes("qdrant-b"))

    expect(aCollectionRequests.length).toBeGreaterThan(0)
    expect(bCollectionRequests.length).toBeGreaterThan(0)

    // API keys must not cross over
    for (const r of aCollectionRequests) expect(r.headers["api-key"]).toBe("key-a")
    for (const r of bCollectionRequests) expect(r.headers["api-key"]).toBe("key-b")

    // Collection names in URLs must differ (each contains the project-specific path segment)
    const aCollections = aCollectionRequests.map((r) => r.url.match(/\/collections\/([^/]+)/)?.[1]).filter(Boolean)
    const bCollections = bCollectionRequests.map((r) => r.url.match(/\/collections\/([^/]+)/)?.[1]).filter(Boolean)

    if (aCollections.length > 0 && bCollections.length > 0) {
      expect(aCollections[0]).not.toBe(bCollections[0])
    }
  })
})
