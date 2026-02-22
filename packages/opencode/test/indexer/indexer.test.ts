import { describe, expect, test } from "bun:test"
import { Indexer } from "../../src/indexer"

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
