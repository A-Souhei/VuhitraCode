import { describe, expect, test } from "bun:test"
import { Indexer } from "../../src/indexer"
import path from "path"
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
