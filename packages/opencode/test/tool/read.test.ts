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
        expect(result.output).not.toContain("db.example.com")
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
