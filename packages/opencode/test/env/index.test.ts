import { test, expect, describe, beforeEach } from "bun:test"
import { Env } from "../../src/env"
import { Instance } from "../../src/project/instance"
import path from "path"
import fs from "fs"
import os from "os"

describe("Env.loadEnvFile", () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"))
  })

  test("loads basic key-value pairs", () => {
    const envPath = path.join(tmp, ".env")
    fs.writeFileSync(
      envPath,
      `
FOO=bar
BAZ=qux
    `.trim(),
    )

    Instance.init({ directory: tmp })
    expect(Env.get("FOO")).toBe("bar")
    expect(Env.get("BAZ")).toBe("qux")
  })

  test("handles export prefix", () => {
    const envPath = path.join(tmp, ".env")
    fs.writeFileSync(
      envPath,
      `
export OLLAMA_MODEL=qwen2.5-coder:7b
export OLLAMA_URL=http://192.168.31.23:11434
    `.trim(),
    )

    Instance.init({ directory: tmp })
    expect(Env.get("OLLAMA_MODEL")).toBe("qwen2.5-coder:7b")
    expect(Env.get("OLLAMA_URL")).toBe("http://192.168.31.23:11434")
  })

  test("handles quoted values", () => {
    const envPath = path.join(tmp, ".env")
    fs.writeFileSync(
      envPath,
      `
SINGLE='value with spaces'
DOUBLE="another value"
NO_QUOTES=plain
    `.trim(),
    )

    Instance.init({ directory: tmp })
    expect(Env.get("SINGLE")).toBe("value with spaces")
    expect(Env.get("DOUBLE")).toBe("another value")
    expect(Env.get("NO_QUOTES")).toBe("plain")
  })

  test("ignores comments and empty lines", () => {
    const envPath = path.join(tmp, ".env")
    fs.writeFileSync(
      envPath,
      `
# This is a comment
FOO=bar

# Another comment
BAZ=qux
    `.trim(),
    )

    Instance.init({ directory: tmp })
    expect(Env.get("FOO")).toBe("bar")
    expect(Env.get("BAZ")).toBe("qux")
  })

  test("process.env takes precedence over .env file", () => {
    const envPath = path.join(tmp, ".env")
    fs.writeFileSync(
      envPath,
      `
TEST_VAR=from_file
    `.trim(),
    )

    process.env.TEST_VAR = "from_process"
    Instance.init({ directory: tmp })

    expect(Env.get("TEST_VAR")).toBe("from_process")

    delete process.env.TEST_VAR
  })

  test("returns undefined for non-existent keys", () => {
    Instance.init({ directory: tmp })
    expect(Env.get("NON_EXISTENT_KEY")).toBeUndefined()
  })

  test("handles missing .env file gracefully", () => {
    Instance.init({ directory: tmp })
    expect(Env.get("FOO")).toBeUndefined()
  })
})
