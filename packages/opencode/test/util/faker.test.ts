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
      "JWT_SECRET=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWFsIn0.real_sig",
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

  test("preserves Python f-string interpolation markers", async () => {
    const content = `f"user_id: {db.user_id}"`
    const result = await Faker.fakeContent(content, "code.py")
    expect(result).toContain("{db.user_id}")
    expect(result).toMatch(/^f".*\{db\.user_id\}.*"$/)
  })

  test("preserves Python f-string with multiple interpolations", async () => {
    const content = `f"Name: {user.name}, ID: {user.id}"`
    const result = await Faker.fakeContent(content, "code.py")
    expect(result).toContain("{user.name}")
    expect(result).toContain("{user.id}")
  })

  test("preserves JavaScript template literal markers", async () => {
    const content = "`Hello ${name}, your ID is ${user_id}`"
    const result = await Faker.fakeContent(content, "code.js")
    expect(result).toContain("${name}")
    expect(result).toContain("${user_id}")
  })

  test("preserves shell expansion $(cmd) markers", async () => {
    const content = `"The output is $(command)"`
    const result = await Faker.fakeContent(content, "script.sh")
    expect(result).toContain("$(command)")
  })

  test("fakes non-interpolation parts while preserving markers", async () => {
    const content = `f"User: {user.name} at {user.location}"`
    const result = await Faker.fakeContent(content, "code.py")
    // Should preserve both interpolation markers
    expect(result).toContain("{user.name}")
    expect(result).toContain("{user.location}")
    // The text parts should be faked
    expect(result).toContain("example_value")
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
        // Write .vuhitra/sensible.yaml declaring only "order_ref" as sensitive
        await Bun.write(path.join(tmp.path, ".vuhitra", "sensible.yaml"), ["orders.csv:", "  - order_ref"].join("\n"))

        const content = ["id,order_ref,email,total", "1,ORD-REAL-001,buyer@real.com,99.99"].join("\n")

        const result = await Faker.fakeContent(content, path.join(tmp.path, "orders.csv"))

        // order_ref should be faked (declared), email should NOT be faked
        expect(result).not.toContain("ORD-REAL-001")
        expect(result).toContain("buyer@real.com")
        expect(result).toContain("99.99")
      },
    })
  })
})

// ---------------------------------------------------------------------------
// INI files
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — .ini files", () => {
  test("fakes INI file sensitive keys", async () => {
    const content = `[database]
host=localhost
password=real_secret_123
[api]
api_key=sk_live_xxx
debug=true`
    const result = await Faker.fakeContent(content, "config.ini")
    expect(result).toContain("[database]")
    expect(result).toContain("[api]")
    expect(result).toContain("host=localhost")
    expect(result).toContain("debug=true")
    expect(result).not.toContain("real_secret_123")
    expect(result).not.toContain("sk_live_xxx")
  })

  test("fakes .cfg file extensions", async () => {
    const content = `db_password=supersecret
log_level=DEBUG`
    const result = await Faker.fakeContent(content, "app.cfg")
    expect(result).not.toContain("supersecret")
    expect(result).toContain("log_level=DEBUG")
  })

  test("fakes .conf file extensions", async () => {
    const content = `authentication_key=abc123def456
server_port=8080`
    const result = await Faker.fakeContent(content, "nginx.conf")
    expect(result).not.toContain("abc123def456")
    expect(result).toContain("server_port=8080")
  })

  test("fakes .properties file extensions", async () => {
    const content = `database.password=prod_password_123
logging.level=INFO`
    const result = await Faker.fakeContent(content, "app.properties")
    expect(result).not.toContain("prod_password_123")
    expect(result).toContain("logging.level=INFO")
  })

  test("handles INI with colon separator", async () => {
    const content = `api_token: ghp_realtoken
host: db.example.com`
    const result = await Faker.fakeContent(content, "config.ini")
    expect(result).not.toContain("ghp_realtoken")
    expect(result).toContain("host: db.example.com")
  })
})

// ---------------------------------------------------------------------------
// TOML files
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — .toml files", () => {
  test("fakes TOML file sensitive keys", async () => {
    const content = `[database]
password = "real_secret_123"
host = "localhost"
[api]
api_key = "sk_live_xxx"
debug = true`
    const result = await Faker.fakeContent(content, "config.toml")
    expect(result).toContain("[database]")
    expect(result).toContain("[api]")
    expect(result).toContain('host = "localhost"')
    expect(result).toContain("debug = true")
    expect(result).not.toContain("real_secret_123")
    expect(result).not.toContain("sk_live_xxx")
  })

  test("handles TOML single-quoted strings", async () => {
    const content = `auth_token = 'ghp_realtoken123456'
port = 5432`
    const result = await Faker.fakeContent(content, "app.toml")
    expect(result).not.toContain("ghp_realtoken123456")
    expect(result).toContain("port = 5432")
  })

  test("handles TOML unquoted string values", async () => {
    const content = `webhook_secret = realwebhooksecret123
max_retries = 3`
    const result = await Faker.fakeContent(content, "settings.toml")
    expect(result).not.toContain("realwebhooksecret123")
    expect(result).toContain("max_retries = 3")
  })
})

// ---------------------------------------------------------------------------
// JavaScript/TypeScript source code
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — JavaScript/TypeScript source code", () => {
  test("fakes string literals in .js files", async () => {
    const content = `const apiKey = "sk-real-key-12345"
const endpoint = "https://api.real.com"
const debug = true`
    const result = await Faker.fakeContent(content, "config.js")
    expect(result).not.toContain("sk-real-key-12345")
    expect(result).not.toContain("https://api.real.com")
    expect(result).toContain("const apiKey =")
    expect(result).toContain("const debug = true")
  })

  test("fakes string literals in .ts files", async () => {
    const content = `const secret: string = "ghp_realtoken123"
const port: number = 3000`
    const result = await Faker.fakeContent(content, "config.ts")
    expect(result).not.toContain("ghp_realtoken123")
    expect(result).toContain("const port: number = 3000")
  })

  test("fakes string literals in .jsx files", async () => {
    const content = `export const API_URL = "https://real-api.internal/v1"
export const isProduction = true`
    const result = await Faker.fakeContent(content, "constants.jsx")
    expect(result).not.toContain("https://real-api.internal/v1")
    expect(result).toContain("isProduction = true")
  })

  test("fakes string literals in .tsx files", async () => {
    const content = `const AUTH_TOKEN = "Bearer real-token-xyz"
const component = <div>Test</div>`
    const result = await Faker.fakeContent(content, "App.tsx")
    expect(result).not.toContain("real-token-xyz")
    expect(result).toContain("<div>Test</div>")
  })

  test("preserves JavaScript template literal markers", async () => {
    const content = "`API: ${API_URL}, Token: ${AUTH_TOKEN}`"
    const result = await Faker.fakeContent(content, "script.js")
    expect(result).toContain("${API_URL}")
    expect(result).toContain("${AUTH_TOKEN}")
    expect(result).toMatch(/^`.*\$\{.*\}.*`$/)
  })

  test("fakes non-interpolation parts in template literals", async () => {
    const content = "`User secret is real_secret_here with ID ${userId}`"
    const result = await Faker.fakeContent(content, "script.js")
    expect(result).toContain("${userId}")
    expect(result).not.toContain("real_secret_here")
  })
})

// ---------------------------------------------------------------------------
// Go source code
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — Go source code", () => {
  test("fakes string literals in .go files", async () => {
    const content = `const apiKey = "sk-real-key-12345"
const endpoint = "https://api.real.com"
var debug bool = true`
    const result = await Faker.fakeContent(content, "config.go")
    expect(result).not.toContain("sk-real-key-12345")
    expect(result).not.toContain("https://api.real.com")
    expect(result).toContain("const apiKey =")
    expect(result).toContain("var debug bool = true")
  })
})

// ---------------------------------------------------------------------------
// Ruby source code
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — Ruby source code", () => {
  test("fakes string literals in .rb files", async () => {
    const content = `API_KEY = "sk-real-key-12345"
ENDPOINT = "https://api.real.com"
DEBUG = true`
    const result = await Faker.fakeContent(content, "config.rb")
    expect(result).not.toContain("sk-real-key-12345")
    expect(result).not.toContain("https://api.real.com")
    expect(result).toContain("API_KEY =")
    expect(result).toContain("DEBUG = true")
  })
})

// ---------------------------------------------------------------------------
// PHP source code
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — PHP source code", () => {
  test("fakes string literals in .php files", async () => {
    const content = `<?php
$apiKey = "sk-real-key-12345";
$endpoint = "https://api.real.com";
$debug = true;`
    const result = await Faker.fakeContent(content, "config.php")
    expect(result).not.toContain("sk-real-key-12345")
    expect(result).not.toContain("https://api.real.com")
    expect(result).toContain("<?php")
    expect(result).toContain("$debug = true")
  })
})

// ---------------------------------------------------------------------------
// Shell scripts
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — Shell scripts", () => {
  test("fakes string literals in .sh files", async () => {
    const content = `#!/bin/bash
API_KEY="sk-real-key-12345"
ENDPOINT="https://api.real.com"
DEBUG=true`
    const result = await Faker.fakeContent(content, "script.sh")
    expect(result).toContain("#!/bin/bash")
    expect(result).not.toContain("sk-real-key-12345")
    expect(result).not.toContain("https://api.real.com")
    expect(result).toContain("DEBUG=true")
  })

  test("fakes string literals in .bash files", async () => {
    const content = `#!/bin/bash
DB_PASSWORD="realdbpass123"
echo "Hello"`
    const result = await Faker.fakeContent(content, "deploy.bash")
    expect(result).toContain("#!/bin/bash")
    expect(result).not.toContain("realdbpass123")
    expect(result).toContain('echo "')
  })

  test("fakes string literals in .zsh files", async () => {
    const content = `API_TOKEN="ghp_realtoken123"
PORT=8080`
    const result = await Faker.fakeContent(content, "config.zsh")
    expect(result).not.toContain("ghp_realtoken123")
    expect(result).toContain("PORT=8080")
  })
})

// ---------------------------------------------------------------------------
// TSV (Tab-Separated Values)
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — TSV files", () => {
  test("fakes PII columns in TSV format", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = [
          "id\temail\tphone\tcountry",
          "1\talice@real.com\t+1-555-9999\tUS",
          "2\tbob@real.com\t+1-555-8888\tUK",
        ].join("\n")

        const result = await Faker.fakeContent(content, path.join(tmp.path, "users.tsv"))

        expect(result).toContain("id\temail\tphone\tcountry")
        expect(result).not.toContain("alice@real.com")
        expect(result).not.toContain("+1-555-9999")
        expect(result).toContain("US")
        expect(result).toContain("UK")
      },
    })
  })
})

// ---------------------------------------------------------------------------
// Edge cases: Empty files
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — empty files", () => {
  test("handles empty .env file", async () => {
    const result = await Faker.fakeContent("", ".env")
    expect(result).toBe("")
  })

  test("handles empty JSON file", async () => {
    const result = await Faker.fakeContent("", "config.json")
    expect(result).toBe("")
  })

  test("handles empty YAML file", async () => {
    const result = await Faker.fakeContent("", "config.yml")
    expect(result).toBe("")
  })

  test("handles empty source code file", async () => {
    const result = await Faker.fakeContent("", "script.js")
    expect(result).toBe("")
  })

  test("handles whitespace-only file", async () => {
    const result = await Faker.fakeContent("   \n\n  \n", "config.ini")
    expect(result).toBe("   \n\n  \n")
  })
})

// ---------------------------------------------------------------------------
// Edge cases: Malformed JSON
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — malformed JSON", () => {
  test("gracefully degrades malformed JSON to INI-style parsing", async () => {
    const content = `{
  "database": "host": localhost,
  "password": "real_secret_123"
}`
    const result = await Faker.fakeContent(content, "config.json")
    // Should not throw, should fall back to INI parsing
    expect(result).toBeDefined()
    expect(result).not.toContain("real_secret_123")
  })

  test("handles incomplete JSON object", async () => {
    const content = `{
  "name": "myapp",
  "password": "secret123"`
    const result = await Faker.fakeContent(content, "config.json")
    expect(result).toBeDefined()
    expect(result).not.toContain("secret123")
  })
})

// ---------------------------------------------------------------------------
// Edge cases: Nested YAML
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — nested YAML", () => {
  test("handles YAML with sensitive keys with values on same line", async () => {
    const content = `app: myapp
database_host: db.internal
database_password: supersecret
api_key: ghp_realtoken
debug: true`
    const result = await Faker.fakeContent(content, "config.yml")
    expect(result).toContain("app: myapp")
    expect(result).toContain("database_host: db.internal")
    expect(result).toContain("debug: true")
    expect(result).not.toContain("supersecret")
    expect(result).not.toContain("ghp_realtoken")
  })

  test("handles YAML with quoted sensitive values", async () => {
    const content = `root: "value"
password: "real_password_123"
api_key: "sk_live_xxx"
debug: false`
    const result = await Faker.fakeContent(content, "config.yaml")
    expect(result).toContain("root: ")
    expect(result).toContain("debug: false")
    expect(result).not.toContain("real_password_123")
    expect(result).not.toContain("sk_live_xxx")
  })
})

// ---------------------------------------------------------------------------
// Edge cases: Large files
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — large files", () => {
  test("handles large .env files efficiently", async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `VAR_${i}=value_${i}`).join("\n")
    const sensitiveLines = Array.from({ length: 100 }, (_, i) => `PASSWORD_${i}=secret_${i}`).join("\n")
    const content = lines + "\n" + sensitiveLines

    const result = await Faker.fakeContent(content, ".env")
    expect(result).toBeDefined()
    expect(result.length).toBeGreaterThan(0)
    // Verify some non-sensitive vars are preserved
    expect(result).toContain("VAR_0=value_0")
    // Verify sensitive vars are faked
    expect(result).not.toContain("secret_0")
  })

  test("handles large JSON files", async () => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < 100; i++) {
      obj[`field_${i}`] = `value_${i}`
      obj[`password_${i}`] = `secret_${i}`
    }
    const content = JSON.stringify(obj)

    const result = await Faker.fakeContent(content, "data.json")
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed).length).toBe(200)
    // Non-sensitive fields preserved
    expect(parsed.field_0).toBe("value_0")
    // Sensitive fields faked
    expect(parsed.password_0).not.toBe("secret_0")
  })

  test("handles large source code files with many strings", async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `const var${i} = "value_${i}"`).join("\n")
    const secretLines = Array.from({ length: 50 }, (_, i) => `const secret${i} = "realtoken_${i}"`).join("\n")
    const content = lines + "\n" + secretLines

    const result = await Faker.fakeContent(content, "code.js")
    expect(result).toBeDefined()
    expect(result).toContain("const var0 = ")
    expect(result).not.toContain("realtoken_0")
  })
})

// ---------------------------------------------------------------------------
// Edge cases: SQL-like strings (fallback via env-style)
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — SQL-like strings", () => {
  test("fakes SQL in source files (.sql treated as unknown, falls back to env)", async () => {
    const content = `SELECT * FROM users WHERE password = 'real_password_123'; -- comment
UPDATE accounts SET debug = true;`
    const result = await Faker.fakeContent(content, "query.sql")
    // SQL files are not explicitly supported, fallback to env-style
    // env-style fakes quoted values based on SENSITIVE_KEY patterns
    expect(result).toContain("-- comment")
    expect(result).toContain("SELECT * FROM users")
    expect(result).toContain("UPDATE accounts SET debug = true")
  })

  test("fakes shell variable assignments in shell scripts", async () => {
    const content = `#!/bin/bash
DB_PASSWORD="realdbpass123"
API_URL="https://api.real.com"
echo "Hello"`
    const result = await Faker.fakeContent(content, "deploy.sh")
    expect(result).toContain("#!/bin/bash")
    expect(result).toContain("echo")
    expect(result).not.toContain("realdbpass123")
    expect(result).not.toContain("https://api.real.com")
  })
})

// ---------------------------------------------------------------------------
// Edge cases: Python advanced syntax
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — Python advanced syntax", () => {
  test("preserves complex f-string expressions", async () => {
    const content = `f"Prefix {obj.attr.nested} middle {func(x)} suffix"`
    const result = await Faker.fakeContent(content, "script.py")
    expect(result).toContain("{obj.attr.nested}")
    expect(result).toContain("{func(x)}")
    expect(result).toMatch(/^f".*\{obj\.attr\.nested\}.*\{func\(x\)\}.*"$/)
  })

  test("fakes f-string with interpolation", async () => {
    const content = `msg1 = f"User: {user_id}"`
    const result = await Faker.fakeContent(content, "messages.py")
    expect(result).toContain("{user_id}")
    expect(result).toContain("msg1 =")
  })

  test("handles triple-quoted strings", async () => {
    const content = `doc = """This is a real password: prod_secret_123
And a token: ghp_realtoken123456
"""
normal = "another_secret_here"`
    const result = await Faker.fakeContent(content, "docs.py")
    expect(result).toContain('doc = """')
    expect(result).toContain('"""')
    expect(result).not.toContain("prod_secret_123")
    expect(result).not.toContain("ghp_realtoken123456")
    expect(result).not.toContain("another_secret_here")
  })
})

// ---------------------------------------------------------------------------
// Integration tests with Instance and read.ts workflow
// ---------------------------------------------------------------------------

describe("Faker.fakeContent — integration with Instance", () => {
  test("fakes .ini file through Instance context", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = `[database]
password=real_secret_123
host=db.internal`
        const result = await Faker.fakeContent(content, path.join(tmp.path, "config.ini"))
        expect(result).toContain("[database]")
        expect(result).toContain("host=db.internal")
        expect(result).not.toContain("real_secret_123")
      },
    })
  })

  test("fakes .toml file through Instance context", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = `[auth]
token = "ghp_realtoken123"
secret = "prod_secret"`
        const result = await Faker.fakeContent(content, path.join(tmp.path, "app.toml"))
        expect(result).toContain("[auth]")
        expect(result).not.toContain("ghp_realtoken123")
        expect(result).not.toContain("prod_secret")
      },
    })
  })

  test("handles edge case empty gitignored file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await Faker.fakeContent("", path.join(tmp.path, "secrets.ini"))
        expect(result).toBe("")
      },
    })
  })

  test("fakes source code file with mixed content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = `import os
API_KEY = "sk-real-key-12345"
ENDPOINT = "https://api.real.com"
def connect():
    db_password = "prod_password_123"
    return db_password`
        const result = await Faker.fakeContent(content, path.join(tmp.path, "config.py"))
        expect(result).toContain("import os")
        expect(result).toContain("def connect():")
        expect(result).not.toContain("sk-real-key-12345")
        expect(result).not.toContain("prod_password_123")
      },
    })
  })
})
