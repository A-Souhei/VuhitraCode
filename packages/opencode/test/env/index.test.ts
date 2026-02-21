import { test, expect, describe } from "bun:test"
import { Env } from "../../src/env"
import { Instance } from "../../src/project/instance"
import path from "path"
import fs from "fs"
import os from "os"

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"))
}

describe("Env.loadEnvFile", () => {
  test("loads basic key-value pairs", async () => {
    const tmp = makeTmp()
    fs.writeFileSync(path.join(tmp, ".env"), "FOO=bar\nBAZ=qux")

    await Instance.provide({
      directory: tmp,
      fn: () => {
        expect(Env.get("FOO")).toBe("bar")
        expect(Env.get("BAZ")).toBe("qux")
      },
    })
  })

  test("handles export prefix", async () => {
    const tmp = makeTmp()
    fs.writeFileSync(path.join(tmp, ".env"), "export OLLAMA_MODEL=qwen2.5-coder:7b\nexport OLLAMA_URL=http://192.168.31.23:11434")

    await Instance.provide({
      directory: tmp,
      fn: () => {
        expect(Env.get("OLLAMA_MODEL")).toBe("qwen2.5-coder:7b")
        expect(Env.get("OLLAMA_URL")).toBe("http://192.168.31.23:11434")
      },
    })
  })

  test("handles quoted values", async () => {
    const tmp = makeTmp()
    fs.writeFileSync(path.join(tmp, ".env"), "SINGLE='value with spaces'\nDOUBLE=\"another value\"\nNO_QUOTES=plain")

    await Instance.provide({
      directory: tmp,
      fn: () => {
        expect(Env.get("SINGLE")).toBe("value with spaces")
        expect(Env.get("DOUBLE")).toBe("another value")
        expect(Env.get("NO_QUOTES")).toBe("plain")
      },
    })
  })

  test("ignores comments and empty lines", async () => {
    const tmp = makeTmp()
    fs.writeFileSync(path.join(tmp, ".env"), "# comment\nFOO=bar\n\n# another\nBAZ=qux")

    await Instance.provide({
      directory: tmp,
      fn: () => {
        expect(Env.get("FOO")).toBe("bar")
        expect(Env.get("BAZ")).toBe("qux")
      },
    })
  })

  test("process.env takes precedence over .env file", async () => {
    const tmp = makeTmp()
    fs.writeFileSync(path.join(tmp, ".env"), "TEST_VAR=from_file")
    process.env.TEST_VAR = "from_process"

    await Instance.provide({
      directory: tmp,
      fn: () => {
        expect(Env.get("TEST_VAR")).toBe("from_process")
      },
    })

    delete process.env.TEST_VAR
  })

  test("returns undefined for non-existent keys", async () => {
    const tmp = makeTmp()

    await Instance.provide({
      directory: tmp,
      fn: () => {
        expect(Env.get("NON_EXISTENT_KEY")).toBeUndefined()
      },
    })
  })

  test("handles missing .env file gracefully", async () => {
    const tmp = makeTmp()

    await Instance.provide({
      directory: tmp,
      fn: () => {
        expect(Env.get("FOO")).toBeUndefined()
      },
    })
  })
})
