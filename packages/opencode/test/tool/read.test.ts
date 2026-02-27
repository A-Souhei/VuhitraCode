import { describe, expect, test } from "bun:test"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import { PermissionNext } from "../../src/permission/next"
import { Agent } from "../../src/agent/agent"
import { Env } from "../../src/env"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.read external_directory permission", () => {
  test("allows reading absolute path inside project directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "test.txt") }, ctx)
        expect(result.output).toContain("hello world")
      },
    })
  })

  test("allows reading file in subdirectory inside project directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "test.txt"), "nested content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "subdir", "test.txt") }, ctx)
        expect(result.output).toContain("nested content")
      },
    })
  })

  test("asks for external_directory permission when reading absolute path outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "secret.txt"), "secret data")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await read.execute({ filePath: path.join(outerTmp.path, "secret.txt") }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns.some((p) => p.includes(outerTmp.path))).toBe(true)
      },
    })
  })

  test("asks for directory-scoped external_directory permission when reading external directory", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "external", "a.txt"), "a")
      },
    })
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await read.execute({ filePath: path.join(outerTmp.path, "external") }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(path.join(outerTmp.path, "external", "*"))
      },
    })
  })

  test("asks for external_directory permission when reading relative path outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        // This will fail because file doesn't exist, but we can check if permission was asked
        await read.execute({ filePath: "../outside.txt" }, testCtx).catch(() => {})
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("does not ask for external_directory permission when reading inside project", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "internal.txt"), "internal content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await read.execute({ filePath: path.join(tmp.path, "internal.txt") }, testCtx)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })
})

describe("tool.read env file permissions", () => {
  const cases: [string, boolean][] = [
    [".env", true],
    [".env.local", true],
    [".env.production", true],
    [".env.development.local", true],
    [".env.example", false],
    [".envrc", false],
    ["environment.ts", false],
  ]

  describe.each(["build", "plan"])("agent=%s", (agentName) => {
    test.each(cases)("%s asks=%s", async (filename, shouldAsk) => {
      await using tmp = await tmpdir({
        init: (dir) => Bun.write(path.join(dir, filename), "content"),
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const agent = await Agent.get(agentName)
          let askedForEnv = false
          const ctxWithPermissions = {
            ...ctx,
            ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
              for (const pattern of req.patterns) {
                const rule = PermissionNext.evaluate(req.permission, pattern, agent.permission)
                if (rule.action === "ask" && req.permission === "read") {
                  askedForEnv = true
                }
                if (rule.action === "deny") {
                  throw new PermissionNext.DeniedError(agent.permission)
                }
              }
            },
          }
          const read = await ReadTool.init()
          await read.execute({ filePath: path.join(tmp.path, filename) }, ctxWithPermissions)
          expect(askedForEnv).toBe(shouldAsk)
        },
      })
    })
  })
})

describe("tool.read truncation", () => {
  test("truncates large file by bytes and sets truncated metadata", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const base = await Filesystem.readText(path.join(FIXTURES_DIR, "models-api.json"))
        const target = 60 * 1024
        const content = base.length >= target ? base : base.repeat(Math.ceil(target / base.length))
        await Filesystem.write(path.join(dir, "large.json"), content)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "large.json") }, ctx)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("Output capped at")
        expect(result.output).toContain("Use offset=")
      },
    })
  })

  test("truncates by line count when limit is specified", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        await Bun.write(path.join(dir, "many-lines.txt"), lines)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "many-lines.txt"), limit: 10 }, ctx)
        expect(result.metadata.truncated).toBe(true)
        expect(result.output).toContain("Showing lines 1-10 of 100")
        expect(result.output).toContain("Use offset=11")
        expect(result.output).toContain("line0")
        expect(result.output).toContain("line9")
        expect(result.output).not.toContain("line10")
      },
    })
  })

  test("does not truncate small file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "small.txt"), "hello world")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "small.txt") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output).toContain("End of file")
      },
    })
  })

  test("respects offset parameter", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n")
        await Bun.write(path.join(dir, "offset.txt"), lines)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "offset.txt"), offset: 10, limit: 5 }, ctx)
        expect(result.output).toContain("10: line10")
        expect(result.output).toContain("14: line14")
        expect(result.output).not.toContain("9: line10")
        expect(result.output).not.toContain("15: line15")
        expect(result.output).toContain("line10")
        expect(result.output).toContain("line14")
        expect(result.output).not.toContain("line0")
        expect(result.output).not.toContain("line15")
      },
    })
  })

  test("throws when offset is beyond end of file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const lines = Array.from({ length: 3 }, (_, i) => `line${i + 1}`).join("\n")
        await Bun.write(path.join(dir, "short.txt"), lines)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(
          read.execute({ filePath: path.join(tmp.path, "short.txt"), offset: 4, limit: 5 }, ctx),
        ).rejects.toThrow("Offset 4 is out of range for this file (3 lines)")
      },
    })
  })

  test("allows reading empty file at default offset", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "empty.txt"), "")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "empty.txt") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output).toContain("End of file - total 0 lines")
      },
    })
  })

  test("throws when offset > 1 for empty file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "empty.txt"), "")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(tmp.path, "empty.txt"), offset: 2 }, ctx)).rejects.toThrow(
          "Offset 2 is out of range for this file (0 lines)",
        )
      },
    })
  })

  test("does not mark final directory page as truncated", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Promise.all(
          Array.from({ length: 10 }, (_, i) => Bun.write(path.join(dir, "dir", `file-${i + 1}.txt`), `line${i}`)),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "dir"), offset: 6, limit: 5 }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output).not.toContain("Showing 5 of 10 entries")
      },
    })
  })

  test("truncates long lines", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const longLine = "x".repeat(3000)
        await Bun.write(path.join(dir, "long-line.txt"), longLine)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "long-line.txt") }, ctx)
        expect(result.output).toContain("(line truncated to 2000 chars)")
        expect(result.output.length).toBeLessThan(3000)
      },
    })
  })

  test("image files set truncated to false", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // 1x1 red PNG
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
          "base64",
        )
        await Bun.write(path.join(dir, "image.png"), png)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "image.png") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
        expect(result.attachments?.[0]).not.toHaveProperty("id")
        expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
        expect(result.attachments?.[0]).not.toHaveProperty("messageID")
      },
    })
  })

  test("large image files are properly attached without error", async () => {
    await Instance.provide({
      directory: FIXTURES_DIR,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(FIXTURES_DIR, "large-image.png") }, ctx)
        expect(result.metadata.truncated).toBe(false)
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
        expect(result.attachments?.[0].type).toBe("file")
        expect(result.attachments?.[0]).not.toHaveProperty("id")
        expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
        expect(result.attachments?.[0]).not.toHaveProperty("messageID")
      },
    })
  })

  test(".fbs files (FlatBuffers schema) are read as text, not images", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // FlatBuffers schema content
        const fbsContent = `namespace MyGame;

table Monster {
  pos:Vec3;
  name:string;
  inventory:[ubyte];
}

root_type Monster;`
        await Bun.write(path.join(dir, "schema.fbs"), fbsContent)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "schema.fbs") }, ctx)
        // Should be read as text, not as image
        expect(result.attachments).toBeUndefined()
        expect(result.output).toContain("namespace MyGame")
        expect(result.output).toContain("table Monster")
      },
    })
  })
})

describe("tool.read loaded instructions", () => {
  test("loads AGENTS.md from parent directory and includes in metadata", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "AGENTS.md"), "# Test Instructions\nDo something special.")
        await Bun.write(path.join(dir, "subdir", "nested", "test.txt"), "test content")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "subdir", "nested", "test.txt") }, ctx)
        expect(result.output).toContain("test content")
        expect(result.output).toContain("system-reminder")
        expect(result.output).toContain("Test Instructions")
        expect(result.metadata.loaded).toBeDefined()
        expect(result.metadata.loaded).toContain(path.join(tmp.path, "subdir", "AGENTS.md"))
      },
    })
  })
})

describe("tool.read binary detection", () => {
  test("rejects text extension files with null bytes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const bytes = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f, 0x72, 0x6c, 0x64])
        await Bun.write(path.join(dir, "null-byte.txt"), bytes)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(tmp.path, "null-byte.txt") }, ctx)).rejects.toThrow(
          "Cannot read binary file",
        )
      },
    })
  })

  test("rejects known binary extensions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "module.wasm"), "not really wasm")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(read.execute({ filePath: path.join(tmp.path, "module.wasm") }, ctx)).rejects.toThrow(
          "Cannot read binary file",
        )
      },
    })
  })
})

// ---------------------------------------------------------------------------
// Privacy — gitignore interception
// ---------------------------------------------------------------------------

describe("tool.read privacy — gitignore interception", () => {
  const sensitiveEnv = [
    "APP_NAME=myapp",
    "DATABASE_URL=postgres://admin:s3cr3t@prod.db/mydb",
    "API_KEY=sk-realkey123456",
  ].join("\n")

  test("when OLLAMA_MODEL is set: throws redirect error for gitignored file", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env\n")
        await Bun.write(path.join(dir, ".env"), sensitiveEnv)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("OLLAMA_MODEL", "llama3.2")
        try {
          const read = await ReadTool.init()
          await expect(
            read.execute({ filePath: path.join(tmp.path, ".env") }, { ...ctx, agent: "build" }),
          ).rejects.toThrow("@secret")
        } finally {
          Env.remove("OLLAMA_MODEL")
        }
      },
    })
  })

  test("when OLLAMA_MODEL is not set: returns faked content with privacy notice", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env\n")
        await Bun.write(path.join(dir, ".env"), sensitiveEnv)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, ".env") }, { ...ctx, agent: "build" })

        // Real sensitive values must not appear
        expect(result.output).not.toContain("s3cr3t")
        expect(result.output).not.toContain("sk-realkey123456")
        // Structure is preserved
        expect(result.output).toContain("APP_NAME=myapp")
        expect(result.output).toContain("DATABASE_URL=")
        expect(result.output).toContain("API_KEY=")
        // Privacy notice is present
        expect(result.output).toContain("privacy-notice")
        expect(result.output).toContain("gitignored")
      },
    })
  })

  test("secret agent bypasses gitignore — reads real content", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env\n")
        await Bun.write(path.join(dir, ".env"), sensitiveEnv)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("OLLAMA_MODEL", "llama3.2")
        try {
          const read = await ReadTool.init()
          const result = await read.execute({ filePath: path.join(tmp.path, ".env") }, { ...ctx, agent: "secret" })
          expect(result.output).toContain("s3cr3t")
          expect(result.output).toContain("sk-realkey123456")
          expect(result.output).not.toContain("privacy-notice")
        } finally {
          Env.remove("OLLAMA_MODEL")
        }
      },
    })
  })

  test("non-gitignored file reads normally regardless of OLLAMA_MODEL", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "other.env\n")
        await Bun.write(path.join(dir, "config.env"), "DB_HOST=localhost\nDB_PORT=5432")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("OLLAMA_MODEL", "llama3.2")
        try {
          const read = await ReadTool.init()
          const result = await read.execute({ filePath: path.join(tmp.path, "config.env") }, { ...ctx, agent: "build" })
          expect(result.output).toContain("localhost")
          expect(result.output).toContain("5432")
          expect(result.output).not.toContain("privacy-notice")
        } finally {
          Env.remove("OLLAMA_MODEL")
        }
      },
    })
  })

  test("gitignored image throws error for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "secret.png\n")
        // 1x1 red PNG
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
          "base64",
        )
        await Bun.write(path.join(dir, "secret.png"), png)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(
          read.execute({ filePath: path.join(tmp.path, "secret.png") }, { ...ctx, agent: "build" }),
        ).rejects.toThrow('Access denied: "secret.png" is gitignored (private).')
      },
    })
  })

  test("gitignored PDF throws error for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "secret.pdf\n")
        // Minimal valid PDF structure
        const pdf = Buffer.from("%PDF-1.4\n%dummy PDF content\n", "utf8")
        await Bun.write(path.join(dir, "secret.pdf"), pdf)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(
          read.execute({ filePath: path.join(tmp.path, "secret.pdf") }, { ...ctx, agent: "build" }),
        ).rejects.toThrow('Access denied: "secret.pdf" is gitignored (private).')
      },
    })
  })

  test("secret agent can read gitignored image", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "secret.png\n")
        // 1x1 red PNG
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
          "base64",
        )
        await Bun.write(path.join(dir, "secret.png"), png)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "secret.png") }, { ...ctx, agent: "secret" })
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
        expect(result.attachments?.[0].type).toBe("file")
      },
    })
  })

  test("secret agent can read gitignored PDF", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "secret.pdf\n")
        const pdf = Buffer.from("%PDF-1.4\n%dummy PDF content\n", "utf8")
        await Bun.write(path.join(dir, "secret.pdf"), pdf)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "secret.pdf") }, { ...ctx, agent: "secret" })
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
        expect(result.attachments?.[0].type).toBe("file")
      },
    })
  })

  test("non-gitignored image reads normally for all agents", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "other.png\n")
        // 1x1 red PNG
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
          "base64",
        )
        await Bun.write(path.join(dir, "public.png"), png)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "public.png") }, { ...ctx, agent: "build" })
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
        expect(result.attachments?.[0].type).toBe("file")
      },
    })
  })
})

describe("tool.read integration — faker end-to-end", () => {
  test("gitignored symlink: faked consistently for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "secrets/*\n")
        await Bun.write(path.join(dir, "secrets", ".env"), "API_KEY=sk-secret123\nDATABASE_PASSWORD=prod_password_real")
        // Create symlink from public area to gitignored file
        await Bun.spawn(["ln", "-s", path.join(dir, "secrets", ".env"), path.join(dir, "public-env-link")]).exited
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute(
          { filePath: path.join(tmp.path, "public-env-link") },
          { ...ctx, agent: "build" },
        )
        // Sensitive values must not appear
        expect(result.output).not.toContain("sk-secret123")
        expect(result.output).not.toContain("prod_password_real")
        // Keys are visible
        expect(result.output).toContain("API_KEY=")
        expect(result.output).toContain("DATABASE_PASSWORD=")
        // Privacy notice indicates faking
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("gitignored directory: throws error for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "private/\n")
        await Bun.write(path.join(dir, "private", "config.env"), "DB_URL=postgres://secret")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        await expect(
          read.execute({ filePath: path.join(tmp.path, "private") }, { ...ctx, agent: "build" }),
        ).rejects.toThrow("is a gitignored directory")
      },
    })
  })

  test("gitignored nested path: fakes values in nested .env file", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".config/.env\n")
        await Bun.write(
          path.join(dir, ".config", ".env"),
          "DATABASE_URL=postgres://admin:s3cr3t@db.example.com/mydb\nJWT_SECRET=super_secret_key_12345",
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute(
          { filePath: path.join(tmp.path, ".config", ".env") },
          { ...ctx, agent: "build" },
        )
        // Real credentials must not appear
        expect(result.output).not.toContain("s3cr3t")
        expect(result.output).not.toContain("super_secret_key_12345")
        expect(result.output).not.toContain("admin")
        // Credentials are faked, but hostname is preserved
        expect(result.output).toContain("fakepassword@db.example.com")
        // Structure is preserved
        expect(result.output).toContain("DATABASE_URL=")
        expect(result.output).toContain("JWT_SECRET=")
        // Privacy notice present
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("gitignored JSON config: fakes nested secrets", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "secrets.json\n")
        await Bun.write(
          path.join(dir, "secrets.json"),
          JSON.stringify({
            api_key: "sk-proj-abc123def456",
            password: "MyS3cur3P@ssw0rd",
            oauth_token: "ghp_abc123def456ghi789",
            nested: {
              db_connection_string: "mongodb+srv://admin:secret@cluster.mongodb.net/mydb",
            },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "secrets.json") }, { ...ctx, agent: "build" })
        // Real secrets must not appear
        expect(result.output).not.toContain("sk-proj-abc123def456")
        expect(result.output).not.toContain("MyS3cur3P@ssw0rd")
        expect(result.output).not.toContain("ghp_abc123def456ghi789")
        expect(result.output).not.toContain("secret@cluster")
        // Keys are visible
        expect(result.output).toContain("api_key")
        expect(result.output).toContain("password")
        expect(result.output).toContain("nested")
        // Privacy notice
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("gitignored source code: fakes string literals", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "config.ts\n")
        await Bun.write(
          path.join(dir, "config.ts"),
          `export const CONFIG = {
  api_key: "sk-real-api-key-123",
  secret_token: "real_secret_token_xyz",
  db_password_url: "postgres://admin:realpassword@prod.db/mydb"
}`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "config.ts") }, { ...ctx, agent: "build" })
        // Real values must not appear
        expect(result.output).not.toContain("sk-real-api-key-123")
        expect(result.output).not.toContain("real_secret_token_xyz")
        expect(result.output).not.toContain("realpassword")
        // Structure is visible
        expect(result.output).toContain("api_key")
        expect(result.output).toContain("secret_token")
        expect(result.output).toContain("db_password_url")
        expect(result.output).toContain("export const CONFIG")
        // Privacy notice
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("non-gitignored file: not faked even with sensitive names", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "ignored.env\n")
        await Bun.write(path.join(dir, "config.env"), "DB_HOST=localhost\nAPI_KEY=public_info")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("OLLAMA_MODEL", "llama3.2")
        try {
          const read = await ReadTool.init()
          const result = await read.execute({ filePath: path.join(tmp.path, "config.env") }, { ...ctx, agent: "build" })
          // Real values appear
          expect(result.output).toContain("localhost")
          expect(result.output).toContain("public_info")
          // No privacy notice for non-gitignored
          expect(result.output).not.toContain("privacy-notice")
        } finally {
          Env.remove("OLLAMA_MODEL")
        }
      },
    })
  })

  test("secret agent bypasses faking for gitignored files", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env\n")
        await Bun.write(path.join(dir, ".env"), "API_SECRET=real_secret_value_12345\nDB_KEY=genuine_key_99999")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("OLLAMA_MODEL", "llama3.2")
        try {
          const read = await ReadTool.init()
          const result = await read.execute({ filePath: path.join(tmp.path, ".env") }, { ...ctx, agent: "secret" })
          // Real values appear for secret agent
          expect(result.output).toContain("real_secret_value_12345")
          expect(result.output).toContain("genuine_key_99999")
          // No privacy notice
          expect(result.output).not.toContain("privacy-notice")
        } finally {
          Env.remove("OLLAMA_MODEL")
        }
      },
    })
  })
})

// ---------------------------------------------------------------------------
// Comprehensive tests for secret agent redaction with gitignored files
// ---------------------------------------------------------------------------

describe("tool.read comprehensive secret agent redaction", () => {
  test("secret agent with OLLAMA_MODEL set: receives real content, not faked", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env\n")
        await Bun.write(path.join(dir, ".env"), "API_KEY=sk-realkey123456\nDATABASE_PASSWORD=prod_s3cr3t_pass")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("OLLAMA_MODEL", "llama3.2")
        try {
          const read = await ReadTool.init()
          const result = await read.execute({ filePath: path.join(tmp.path, ".env") }, { ...ctx, agent: "secret" })
          // Secret agent gets real content even with OLLAMA_MODEL set
          expect(result.output).toContain("sk-realkey123456")
          expect(result.output).toContain("prod_s3cr3t_pass")
          expect(result.output).not.toContain("privacy-notice")
        } finally {
          Env.remove("OLLAMA_MODEL")
        }
      },
    })
  })

  test("secret agent receives faked content for non-ollama environment", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env\n")
        await Bun.write(path.join(dir, ".env"), "API_KEY=sk-realkey123456\nDATABASE_PASSWORD=prod_s3cr3t_pass")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, ".env") }, { ...ctx, agent: "secret" })
        // Even secret agent gets faked content when not using ollama
        expect(result.output).not.toContain("sk-realkey123456")
        expect(result.output).not.toContain("prod_s3cr3t_pass")
        // Structure is preserved
        expect(result.output).toContain("API_KEY=")
        expect(result.output).toContain("DATABASE_PASSWORD=")
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("regular agent still gets error for gitignored file with OLLAMA_MODEL", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env\n")
        await Bun.write(path.join(dir, ".env"), "API_KEY=sk-realkey123456")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("OLLAMA_MODEL", "llama3.2")
        try {
          const read = await ReadTool.init()
          await expect(
            read.execute({ filePath: path.join(tmp.path, ".env") }, { ...ctx, agent: "build" }),
          ).rejects.toThrow("@secret")
        } finally {
          Env.remove("OLLAMA_MODEL")
        }
      },
    })
  })

  test("regular agent gets faked content for gitignored file without OLLAMA_MODEL", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env\n")
        await Bun.write(path.join(dir, ".env"), "REAL_API_KEY=sk-12345\nREAL_PASSWORD=password123")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, ".env") }, { ...ctx, agent: "build" })
        // Real secrets are not present
        expect(result.output).not.toContain("sk-12345")
        expect(result.output).not.toContain("password123")
        // Structure is preserved
        expect(result.output).toContain("REAL_API_KEY=")
        expect(result.output).toContain("REAL_PASSWORD=")
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("empty gitignored file returns empty content for secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env\n")
        await Bun.write(path.join(dir, ".env"), "")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, ".env") }, { ...ctx, agent: "secret" })
        expect(result.output).toContain("End of file - total 0 lines")
      },
    })
  })

  test("very large gitignored file faked properly for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "secrets.txt\n")
        // Create a large file with repeated secret patterns
        const lines = Array.from({ length: 100 }, (_, i) => `SECRET_${i}=real_secret_value_${i}_xyz`).join("\n")
        await Bun.write(path.join(dir, "secrets.txt"), lines)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "secrets.txt") }, { ...ctx, agent: "build" })
        // Real values must not appear
        for (let i = 0; i < 100; i++) {
          expect(result.output).not.toContain(`real_secret_value_${i}_xyz`)
        }
        // Structure is preserved (keys visible)
        expect(result.output).toContain("SECRET_")
        expect(result.output).toContain("=")
        // Privacy notice present
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("nested gitignored path fakes values properly for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".config/.env\n")
        await Bun.write(
          path.join(dir, ".config", ".env"),
          "API_ENDPOINT=https://api.prod.example.com\nAPI_TOKEN=ghp_real_github_token_xyz123",
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute(
          { filePath: path.join(tmp.path, ".config", ".env") },
          { ...ctx, agent: "build" },
        )
        // Real values not exposed
        expect(result.output).not.toContain("prod.example.com")
        expect(result.output).not.toContain("ghp_real_github_token_xyz123")
        // Structure preserved
        expect(result.output).toContain("API_ENDPOINT=")
        expect(result.output).toContain("API_TOKEN=")
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("gitignored JSON with real API keys faked for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "config.json\n")
        await Bun.write(
          path.join(dir, "config.json"),
          JSON.stringify({
            api_key: "sk-proj-real-api-key-abc123",
            database_url: "mongodb://admin:password@prod.db:27017/myapp",
            jwt_secret: "super_secret_key_that_signs_tokens_12345",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "config.json") }, { ...ctx, agent: "build" })
        // Real secrets must not appear
        expect(result.output).not.toContain("sk-proj-real-api-key-abc123")
        expect(result.output).not.toContain("admin")
        expect(result.output).not.toContain("super_secret_key_that_signs_tokens_12345")
        // Credentials are faked but hostname is preserved
        expect(result.output).toContain("fakepassword@prod.db")
        // Keys and structure visible
        expect(result.output).toContain("api_key")
        expect(result.output).toContain("database_url")
        expect(result.output).toContain("jwt_secret")
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("gitignored database URL fakes credentials for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env.production\n")
        await Bun.write(
          path.join(dir, ".env.production"),
          "DB_CONNECTION=postgres://dbadmin:realpassword123@prod-db.example.com:5432/production_db",
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute(
          { filePath: path.join(tmp.path, ".env.production") },
          { ...ctx, agent: "build" },
        )
        // Real credentials not exposed
        expect(result.output).not.toContain("dbadmin")
        expect(result.output).not.toContain("realpassword123")
        // Hostname is preserved, credentials are faked
        expect(result.output).toContain("fakepassword@prod-db.example.com")
        expect(result.output).toContain("5432")
        // URL structure preserved
        expect(result.output).toContain("DB_CONNECTION=")
        expect(result.output).toContain("postgres://")
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("multiple real secret patterns all faked for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".secrets\n")
        await Bun.write(
          path.join(dir, ".secrets"),
          [
            "AWS_ACCESS_KEY_ID=AKIA5H7REALKEY12345",
            "AWS_SECRET_ACCESS_KEY=realSecretKey1234567890abcdefghijklmnop",
            "STRIPE_SECRET_KEY=sk_live_real_stripe_secret_key_xyz",
            "SLACK_WEBHOOK=https://hooks.slack.com/services/T1234567/B1234567/realwebbooktoken",
            "GITHUB_TOKEN=ghp_abc123def456ghi789real_token_jkl",
          ].join("\n"),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, ".secrets") }, { ...ctx, agent: "build" })
        // All real secrets must be absent
        expect(result.output).not.toContain("AKIA5H7REALKEY12345")
        expect(result.output).not.toContain("realSecretKey1234567890abcdefghijklmnop")
        expect(result.output).not.toContain("sk_live_real_stripe_secret_key_xyz")
        expect(result.output).not.toContain("realwebbooktoken")
        expect(result.output).not.toContain("ghp_abc123def456ghi789real_token_jkl")
        // All keys visible
        expect(result.output).toContain("AWS_ACCESS_KEY_ID=")
        expect(result.output).toContain("AWS_SECRET_ACCESS_KEY=")
        expect(result.output).toContain("STRIPE_SECRET_KEY=")
        expect(result.output).toContain("SLACK_WEBHOOK=")
        expect(result.output).toContain("GITHUB_TOKEN=")
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("gitignored file with URL paths fakes host and port for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".db-urls\n")
        await Bun.write(
          path.join(dir, ".db-urls"),
          [
            "REDIS_URL=redis://default:redis_password_123@redis.prod.internal:6379/0",
            "MYSQL_URL=mysql://root:mysql_root_pass@prod-mysql.internal:3306/mydb",
            "ELASTICSEARCH_URL=http://elastic:elastic_password_real@elasticsearch.prod.internal:9200",
          ].join("\n"),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, ".db-urls") }, { ...ctx, agent: "build" })
        // Real credentials and hosts must not appear
        expect(result.output).not.toContain("redis_password_123")
        expect(result.output).not.toContain("mysql_root_pass")
        expect(result.output).not.toContain("elastic_password_real")
        // Hostnames are preserved, credentials are faked
        expect(result.output).toContain("fakepassword@redis.prod.internal")
        expect(result.output).toContain("fakepassword@prod-mysql.internal")
        expect(result.output).toContain("fakepassword@elasticsearch.prod.internal")
        // Keys and URL schemes visible
        expect(result.output).toContain("REDIS_URL=")
        expect(result.output).toContain("redis://")
        expect(result.output).toContain("MYSQL_URL=")
        expect(result.output).toContain("mysql://")
        expect(result.output).toContain("ELASTICSEARCH_URL=")
        expect(result.output).toContain("http://")
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("secret agent with OLLAMA_MODEL: bypasses faking and gets all real data", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env.secret\n")
        const realData = "PROD_API_KEY=sk-real-prod-key-xyz\nPROD_PASSWORD=real_prod_password_secure_123"
        await Bun.write(path.join(dir, ".env.secret"), realData)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.set("OLLAMA_MODEL", "llama3.2")
        try {
          const read = await ReadTool.init()
          const result = await read.execute(
            { filePath: path.join(tmp.path, ".env.secret") },
            { ...ctx, agent: "secret" },
          )
          // Secret agent gets real data with OLLAMA_MODEL set
          expect(result.output).toContain("sk-real-prod-key-xyz")
          expect(result.output).toContain("real_prod_password_secure_123")
          // No privacy notice (secret agent gets real content)
          expect(result.output).not.toContain("privacy-notice")
        } finally {
          Env.remove("OLLAMA_MODEL")
        }
      },
    })
  })

  test("secret agent without OLLAMA_MODEL: gets faked content for defense-in-depth", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), ".env.secret\n")
        const realData = "PROD_API_KEY=sk-real-prod-key-xyz\nPROD_PASSWORD=real_prod_password_secure_123"
        await Bun.write(path.join(dir, ".env.secret"), realData)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, ".env.secret") }, { ...ctx, agent: "secret" })
        // Secret agent gets faked data without OLLAMA_MODEL for defense-in-depth
        expect(result.output).not.toContain("sk-real-prod-key-xyz")
        expect(result.output).not.toContain("real_prod_password_secure_123")
        // Keys visible
        expect(result.output).toContain("PROD_API_KEY=")
        expect(result.output).toContain("PROD_PASSWORD=")
        // Privacy notice (still faking content)
        expect(result.output).toContain("privacy-notice")
      },
    })
  })

  test("gitignored file with special characters faked properly for non-secret agent", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, ".gitignore"), "keys.json\n")
        await Bun.write(
          path.join(dir, "keys.json"),
          JSON.stringify({
            "secret-key": "value!@#$%^&*()",
            token:
              "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP5THqWZg",
            password: "P@ssw0rd!#$%^&*()_+-=[]{}|;:',.<>?/",
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Env.remove("OLLAMA_MODEL")
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "keys.json") }, { ...ctx, agent: "build" })
        // Real complex secrets must not appear
        expect(result.output).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")
        expect(result.output).not.toContain("P@ssw0rd!#$%^&*()_+-=[]{}|;:',.<>?/")
        // Keys visible
        expect(result.output).toContain("secret-key")
        expect(result.output).toContain("token")
        expect(result.output).toContain("password")
        expect(result.output).toContain("privacy-notice")
      },
    })
  })
})
