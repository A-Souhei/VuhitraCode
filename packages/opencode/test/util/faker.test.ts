import { describe, expect, test } from "bun:test"
import path from "path"
import { Faker } from "../../src/util/faker"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// ---------------------------------------------------------------------------
// .env
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — .env", () => {
  test("replaces sensitive keys, preserves non-sensitive keys", async () => {
    const content = [
      "APP_NAME=myapp",
      "DATABASE_URL=postgres://admin:s3cr3t@prod.db/mydb",
      "API_KEY=sk-realkey123456",
      "DEBUG=true",
      'JWT_SECRET=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWFsIn0.real_sig',
    ].join("\n")

    const result = await Faker.fakeContent(content, ".env")

    expect(result).toContain("APP_NAME=myapp")
    expect(result).toContain("DEBUG=true")
    expect(result).not.toContain("s3cr3t")
    expect(result).not.toContain("sk-realkey123456")
    expect(result).not.toContain("real_sig")
    expect(result).toContain("DATABASE_URL=")
    expect(result).toContain("API_KEY=")
  })

  test("handles export prefix", async () => {
    const content = "export SECRET_TOKEN=abc123def456"
    const result = await Faker.fakeContent(content, ".env")
    expect(result).not.toContain("abc123def456")
    expect(result).toContain("export SECRET_TOKEN=")
  })

  test("handles quoted values", async () => {
    const content = 'PASSWORD="mysecretpass"'
    const result = await Faker.fakeContent(content, ".env")
    expect(result).not.toContain("mysecretpass")
    expect(result).toContain('"')
  })

  test("matches .env.local extension", async () => {
    const content = "DB_PASSWORD=hunter2"
    const result = await Faker.fakeContent(content, ".env.local")
    expect(result).not.toContain("hunter2")
  })
})

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — JSON", () => {
  test("replaces sensitive keys recursively", async () => {
    const obj = {
      name: "myapp",
      database: {
        password: "secret123",
        host: "localhost",
      },
      api_key: "sk-prod-key-xyz",
    }
    const result = await Faker.fakeContent(JSON.stringify(obj), "config.json")
    const parsed = JSON.parse(result)

    expect(parsed.name).toBe("myapp")
    expect(parsed.database.host).toBe("localhost")
    expect(parsed.database.password).not.toBe("secret123")
    expect(parsed.api_key).not.toBe("sk-prod-key-xyz")
  })

  test("preserves array structure", async () => {
    const obj = { tokens: ["real-token-1", "real-token-2"], labels: ["a", "b"] }
    const result = await Faker.fakeContent(JSON.stringify(obj), "data.json")
    const parsed = JSON.parse(result)
    expect(Array.isArray(parsed.labels)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// YAML
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — YAML", () => {
  test("replaces top-level sensitive keys", async () => {
    const content = [
      "app: myservice",
      "db_host: db.internal",
      "api_key: ghp_realtoken",
      "db_password: supersecret",
    ].join("\n")

    const result = await Faker.fakeContent(content, "config.yml")

    expect(result).toContain("app: myservice")
    expect(result).toContain("db_host: db.internal")
    expect(result).not.toContain("ghp_realtoken")
    expect(result).not.toContain("supersecret")
  })
})

// ---------------------------------------------------------------------------
// Source code
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — source code", () => {
  test("replaces all double-quoted string literals in .py", async () => {
    const content = `
import os
API_KEY = "sk-real-key-12345"
endpoint = "https://api.real-service.com/v1"
debug = True
`.trim()

    const result = await Faker.fakeContent(content, "secrets.py")

    expect(result).not.toContain("sk-real-key-12345")
    expect(result).not.toContain("https://api.real-service.com/v1")
    expect(result).toContain("import os")
    expect(result).toContain("API_KEY =")
    expect(result).toContain("debug = True")
  })

  test("replaces all single-quoted string literals in .py", async () => {
    const content = `token = 'ghp_realtoken123456'`
    const result = await Faker.fakeContent(content, "config.py")
    expect(result).not.toContain("ghp_realtoken123456")
    expect(result).toContain("token =")
  })

  test("replaces string literals in .r files", async () => {
    const content = `db_pass <- "my_db_password"\nhost <- "prod.server.com"`
    const result = await Faker.fakeContent(content, "analysis.r")
    expect(result).not.toContain("my_db_password")
    expect(result).not.toContain("prod.server.com")
  })

  test("preserves empty strings", async () => {
    const content = `x = ""\ny = ''`
    const result = await Faker.fakeContent(content, "code.py")
    expect(result).toContain('""')
  })
})

// ---------------------------------------------------------------------------
// Value type detection
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — value type faking", () => {
  test("fakes JWT tokens", async () => {
    const content = `TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.real_signature_here`
    const result = await Faker.fakeContent(content, ".env")
    expect(result).toContain("eyJhbGciOiJIUzI1NiJ9")
    expect(result).not.toContain("real_signature_here")
  })

  test("fakes UUID values", async () => {
    const content = `CLIENT_SECRET=550e8400-e29b-41d4-a716-446655440000`
    const result = await Faker.fakeContent(content, ".env")
    expect(result).toContain("00000000-0000-0000-0000-000000000000")
  })

  test("fakes database URLs", async () => {
    const content = `DATABASE_URL=postgres://admin:realpass@prod.host:5432/mydb`
    const result = await Faker.fakeContent(content, ".env")
    expect(result).toContain("fakepassword")
    expect(result).not.toContain("realpass")
  })

  test("fakes vendor key prefixes (sk-, ghp_, xoxb-)", async () => {
    const cases = [
      ["API_KEY=sk-realkey1234567890", "sk-"],
      ["TOKEN=ghp_realtoken123456789", "ghp_"],
      ["SLACK=xoxb-real-slack-token-here", "xoxb-"],
    ]
    for (const [input, prefix] of cases) {
      const result = await Faker.fakeContent(input, ".env")
      expect(result).toContain(prefix)
    }
  })

  test("fakes email values (when key matches sensitive pattern)", async () => {
    // KEY must match SENSITIVE_KEY pattern — use a token/secret key that happens to hold an email
    const content = `SMTP_SECRET=admin@company.com`
    const result = await Faker.fakeContent(content, ".env")
    expect(result).not.toContain("admin@company.com")
    expect(result).toContain("example.com")
  })

  test("fakes URL values", async () => {
    const content = `WEBHOOK_SECRET_URL=https://real.internal.host/hook`
    const result = await Faker.fakeContent(content, ".env")
    expect(result).not.toContain("real.internal.host")
    expect(result).toContain("example.com")
  })
})

// ---------------------------------------------------------------------------
// CSV — heuristic PII detection
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — CSV heuristic", () => {
  test("fakes PII columns by header name pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = [
          "id,email,phone,country",
          "1,alice@real.com,+1-555-9999,US",
          "2,bob@real.com,+1-555-8888,UK",
        ].join("\n")

        const result = await Faker.fakeContent(content, path.join(tmp.path, "users.csv"))

        expect(result).toContain("id,email,phone,country")
        expect(result).not.toContain("alice@real.com")
        expect(result).not.toContain("+1-555-9999")
        expect(result).toContain("US")
        expect(result).toContain("UK")
      },
    })
  })
})

// ---------------------------------------------------------------------------
// CSV — explicit .sensible.yaml config
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — CSV with .sensible.yaml", () => {
  test("fakes only declared columns, ignores heuristic", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Write .sensible.yaml declaring only "order_ref" as sensitive
        await Bun.write(
          path.join(tmp.path, ".sensible.yaml"),
          ["orders.csv:", "  - order_ref"].join("\n"),
        )

        const content = [
          "id,order_ref,email,total",
          "1,ORD-REAL-001,buyer@real.com,99.99",
        ].join("\n")

        const result = await Faker.fakeContent(content, path.join(tmp.path, "orders.csv"))

        // order_ref should be faked (declared), email should NOT be faked
        expect(result).not.toContain("ORD-REAL-001")
        expect(result).toContain("buyer@real.com")
        expect(result).toContain("99.99")
      },
    })
  })
})
