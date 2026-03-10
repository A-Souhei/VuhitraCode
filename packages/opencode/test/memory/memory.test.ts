import { describe, test, expect } from "bun:test"
import { Memory } from "../../src/memory"

describe("Memory.Status schema", () => {
  test("accepts disabled status", () => {
    const result = Memory.Status.safeParse({ type: "disabled" })
    expect(result.success).toBe(true)
  })

  test("accepts disabled status with reason", () => {
    const result = Memory.Status.safeParse({ type: "disabled", reason: "not_configured" })
    expect(result.success).toBe(true)
  })

  test("accepts ready status", () => {
    const result = Memory.Status.safeParse({
      type: "ready",
      entry_count: 10,
      token_count: 500,
      backend: "qdrant",
    })
    expect(result.success).toBe(true)
  })

  test("rejects unknown type", () => {
    const result = Memory.Status.safeParse({ type: "unknown" })
    expect(result.success).toBe(false)
  })

  test("rejects ready status missing required fields", () => {
    const result = Memory.Status.safeParse({ type: "ready" })
    expect(result.success).toBe(false)
  })
})

describe("Memory.sanitize", () => {
  test("redacts env-var style secret assignments with equals", () => {
    const out = Memory.sanitize("export API_KEY=abc123secret")
    expect(out).toContain("[REDACTED]")
    expect(out).not.toContain("abc123secret")
  })

  test("redacts env-var style secret assignments with colon", () => {
    const out = Memory.sanitize("SECRET_TOKEN: mysupersecret")
    expect(out).toContain("[REDACTED]")
    expect(out).not.toContain("mysupersecret")
  })

  test("does NOT redact generic prose like 'key: value'", () => {
    const out = Memory.sanitize("the key: value pair is important")
    expect(out).toBe("the key: value pair is important")
  })

  test("does NOT redact 'auth: basic'", () => {
    const out = Memory.sanitize("auth: basic")
    expect(out).toBe("auth: basic")
  })

  test("redacts Bearer tokens", () => {
    const out = Memory.sanitize("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")
    expect(out).toContain("Bearer [REDACTED]")
  })

  test("redacts long hex strings (32+ chars)", () => {
    const out = Memory.sanitize("hash: abcdef1234567890abcdef1234567890")
    expect(out).toContain("[REDACTED]")
  })

  test("redacts private key blocks", () => {
    const out = Memory.sanitize("-----BEGIN RSA PRIVATE KEY-----\nMIIEo...\n-----END RSA PRIVATE KEY-----")
    expect(out).toContain("[REDACTED_PRIVATE_KEY]")
  })

  test("leaves normal content untouched", () => {
    const out = Memory.sanitize("Fixed the bug in auth module by updating the logic.")
    expect(out).toBe("Fixed the bug in auth module by updating the logic.")
  })
})

describe("Memory.classifyReason", () => {
  test("classifies embedding errors", () => {
    expect(Memory.classifyReason("embedding unreachable: connect refused")).toBe("embedding_unreachable")
  })

  test("classifies qdrant errors", () => {
    expect(Memory.classifyReason("Qdrant unhealthy: 503")).toBe("backend_unreachable")
  })

  test("classifies redis errors", () => {
    expect(Memory.classifyReason("Redis unhealthy: unexpected PING response")).toBe("backend_unreachable")
  })

  test("classifies backend errors", () => {
    expect(Memory.classifyReason("backend unhealthy: timeout")).toBe("backend_unreachable")
  })

  test("classifies unknown errors as 'error'", () => {
    expect(Memory.classifyReason("something went wrong")).toBe("error")
  })
})
