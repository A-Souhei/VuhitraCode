import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import { mkdir, writeFile } from "fs/promises"
import ignore from "ignore"
import { DEFAULT_INDEX_IGNORE } from "../../src/cli/cmd/init"

/**
 * Test suite for DEFAULT_INDEX_IGNORE patterns defined in init.ts
 * Uses the real exported constant so tests stay coupled to the source of truth.
 */
describe("Index-ignore patterns — DEFAULT_INDEX_IGNORE coverage", () => {
  function createIgnoreChecker() {
    return ignore().add(DEFAULT_INDEX_IGNORE)
  }

  describe("Dependencies & build output", () => {
    test("matches node_modules", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("node_modules/")).toBe(true)
      expect(checker.ignores("node_modules/express/index.js")).toBe(true)
    })

    test("matches build directories", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("dist/")).toBe(true)
      expect(checker.ignores("build/")).toBe(true)
      expect(checker.ignores("build/index.js")).toBe(true)
      expect(checker.ignores("out/")).toBe(true)
    })

    test("matches .git directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".git/")).toBe(true)
      expect(checker.ignores(".git/HEAD")).toBe(true)
    })

    test("matches coverage directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("coverage/")).toBe(true)
      expect(checker.ignores("coverage/lcov-report/index.html")).toBe(true)
    })
  })

  describe("Framework build output", () => {
    test("matches .next/ directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".next/")).toBe(true)
      expect(checker.ignores(".next/build-manifest.json")).toBe(true)
    })

    test("matches .nuxt/ directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".nuxt/")).toBe(true)
    })

    test("matches .output/ directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".output/")).toBe(true)
    })
  })

  describe("Lock files & minified assets", () => {
    test("matches lock files", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("yarn.lock")).toBe(true)
      expect(checker.ignores("output.lock")).toBe(true)
      expect(checker.ignores("bun.lockb")).toBe(true)
    })

    test("matches minified JS and CSS", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("bundle.min.js")).toBe(true)
      expect(checker.ignores("styles.min.css")).toBe(true)
    })

    test("matches log files", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("error.log")).toBe(true)
      expect(checker.ignores("debug.log")).toBe(true)
    })
  })

  describe(".env files", () => {
    test("matches .env files", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".env")).toBe(true)
      expect(checker.ignores(".env.local")).toBe(true)
      expect(checker.ignores(".env.test")).toBe(true)
    })
  })

  describe("VuHitra self-exclusion", () => {
    test("matches .vuhitra directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".vuhitra/")).toBe(true)
      expect(checker.ignores(".vuhitra/settings.json")).toBe(true)
    })
  })

  describe("Files that should NOT be ignored", () => {
    test("does not match source files", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("src/main.ts")).toBe(false)
      expect(checker.ignores("src/utils.js")).toBe(false)
      expect(checker.ignores("package.json")).toBe(false)
      expect(checker.ignores(".gitignore")).toBe(false)
      expect(checker.ignores("README.md")).toBe(false)
    })
  })

  describe("Integration: realistic project structure", () => {
    test("correctly classifies files in a typical JS/TS project", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const dirs = ["src", "node_modules/express", "dist", ".next", "coverage"]
          for (const d of dirs) await mkdir(path.join(dir, d), { recursive: true })

          const files = [
            "src/main.ts",
            "src/utils.js",
            "node_modules/express/index.js",
            "dist/bundle.js",
            ".next/build-manifest.json",
            "coverage/lcov.info",
            "package.json",
            ".gitignore",
          ]
          for (const f of files) await writeFile(path.join(dir, f), "test content")
        },
      })

      const checker = createIgnoreChecker()

      const shouldIgnore = [
        "node_modules/express/index.js",
        "dist/bundle.js",
        ".next/build-manifest.json",
        "coverage/lcov.info",
      ]
      const shouldNotIgnore = ["src/main.ts", "src/utils.js", "package.json", ".gitignore"]

      for (const file of shouldIgnore) expect(checker.ignores(file)).toBe(true)
      for (const file of shouldNotIgnore) expect(checker.ignores(file)).toBe(false)
    })
  })
})
