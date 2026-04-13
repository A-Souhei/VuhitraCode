import { test, expect, describe } from "bun:test"
import { Biblion } from "../../src/biblion"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// ─── sanitize (pure function, no Instance context needed) ─────────────────────

describe("Biblion.sanitize", () => {
  test("redacts env-style secret assignments", () => {
    expect(Biblion.sanitize("API_KEY=abc123def456ghi789jkl012mno345")).toContain("[REDACTED]")
    expect(Biblion.sanitize("SECRET_TOKEN=hunter2")).toContain("[REDACTED]")
  })

  test("redacts Bearer tokens", () => {
    const result = Biblion.sanitize("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")
    expect(result).toContain("Bearer [REDACTED]")
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")
  })

  test("redacts long hex strings", () => {
    const hex = "a".repeat(32)
    expect(Biblion.sanitize(`token: ${hex}`)).toContain("[REDACTED]")
  })

  test("redacts PEM private keys", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----"
    expect(Biblion.sanitize(pem)).toContain("[REDACTED_PRIVATE_KEY]")
  })

  test("preserves normal text unchanged", () => {
    const text = "The quick brown fox jumps over the lazy dog"
    expect(Biblion.sanitize(text)).toBe(text)
  })

  test("preserves short identifiers that are not secrets", () => {
    expect(Biblion.sanitize("uuid: 550e8400")).toBe("uuid: 550e8400")
  })
})

// ─── classifyReason (pure function, no Instance context needed) ───────────────

describe("Biblion.classifyReason", () => {
  test("classifies embedding errors correctly", () => {
    expect(Biblion.classifyReason("embedding unreachable: connection refused")).toBe("embedding_unreachable")
    expect(Biblion.classifyReason("ollama failed to respond")).toBe("embedding_unreachable")
  })

  test("classifies backend errors correctly", () => {
    expect(Biblion.classifyReason("Qdrant unhealthy: 503")).toBe("backend_unreachable")
    expect(Biblion.classifyReason("Redis ECONNREFUSED")).toBe("backend_unreachable")
    expect(Biblion.classifyReason("backend unhealthy")).toBe("backend_unreachable")
  })

  test("falls back to 'error' for unrecognized messages", () => {
    expect(Biblion.classifyReason("something completely unexpected")).toBe("error")
    expect(Biblion.classifyReason("")).toBe("error")
  })
})

// ─── state-dependent functions (require Instance context) ────────────────────

describe("Biblion state-dependent functions (disabled backend)", () => {
  test("search returns empty array when biblion is disabled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await Biblion.search("hello world")
        expect(Array.isArray(results)).toBe(true)
        expect(results.length).toBe(0)
      },
    })
  })

  test("searchWithScores returns empty array when biblion is disabled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await Biblion.searchWithScores("hello world")
        expect(Array.isArray(results)).toBe(true)
        expect(results.length).toBe(0)
      },
    })
  })

  test("searchWithScores with projectId returns empty array when disabled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const results = await Biblion.searchWithScores("hello world", 5, "some-project-id")
        expect(Array.isArray(results)).toBe(true)
        expect(results.length).toBe(0)
      },
    })
  })

  test("clearAll resolves without throwing when biblion is disabled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Biblion.clearAll()).resolves.toBeUndefined()
      },
    })
  })

  test("clear resolves without throwing when biblion is disabled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Biblion.clear()).resolves.toBeUndefined()
      },
    })
  })

  test("clear with explicit projectId resolves without throwing when disabled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Biblion.clear("some-project-id")).resolves.toBeUndefined()
      },
    })
  })

  test("list returns empty array when biblion is disabled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const entries = await Biblion.list()
        expect(Array.isArray(entries)).toBe(true)
        expect(entries.length).toBe(0)
      },
    })
  })

  test("status returns disabled when not initialized", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const s = Biblion.status()
        expect(s.type).toBe("disabled")
      },
    })
  })
})
