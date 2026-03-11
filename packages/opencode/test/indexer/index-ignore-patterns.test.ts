import { describe, test, expect } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import { mkdir, writeFile } from "fs/promises"
import ignore from "ignore"

/**
 * Test suite for DEFAULT_INDEX_IGNORE patterns defined in init.ts
 * Verifies that Python venv, npm cache, and build artifact patterns work correctly
 */
describe("Index-ignore patterns — DEFAULT_INDEX_IGNORE coverage", () => {
  // Mirror of DEFAULT_INDEX_IGNORE from init.ts
  const defaultIndexIgnore = `# VuHitra index-ignore
# Files and directories excluded from semantic indexing
# Uses .gitignore syntax

# Dependencies & lock files
node_modules/
dist/
build/
.git/
out/
*.lock
*.lockb

# Node/npm
.next/
.nuxt/
.output/
*.tsbuildinfo

# Python virtual environments
venv/
.venv/
env/
*.egg-info/
.eggs/
.tox/
.nox/

# Python caches & tests
.coverage
htmlcov/

# Misc
coverage/
*.log
*.min.js
*.min.css
.env
.env.*
# self-exclusion: keep vuhitra's own config out of the index
.vuhitra/
`

  function createIgnoreChecker() {
    return ignore().add(defaultIndexIgnore)
  }

  describe("Python virtual environments", () => {
    test("matches venv/ directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("venv/")).toBe(true)
      expect(checker.ignores("venv/bin/python")).toBe(true)
      expect(checker.ignores("venv/lib/python3.11/site-packages")).toBe(true)
    })

    test("matches .venv/ directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".venv/")).toBe(true)
      expect(checker.ignores(".venv/bin/python")).toBe(true)
    })

    test("matches env/ directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("env/")).toBe(true)
      expect(checker.ignores("env/lib")).toBe(true)
    })

    test("does not match venv in variable names", () => {
      const checker = createIgnoreChecker()
      // These should NOT be ignored (they are files/dirs, not the venv directory itself)
      expect(checker.ignores("my_venv_script.py")).toBe(false)
      expect(checker.ignores("src/venv_utils.py")).toBe(false)
    })
  })

  describe("Python package metadata & build artifacts", () => {
    test("matches *.egg-info/ pattern", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("MyPackage.egg-info/")).toBe(true)
      expect(checker.ignores("MyPackage.egg-info/PKG-INFO")).toBe(true)
    })

    test("matches .eggs/ directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".eggs/")).toBe(true)
      expect(checker.ignores(".eggs/package-1.0.0.egg")).toBe(true)
    })

    test("matches .tox/ directory (tox testing)", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".tox/")).toBe(true)
      expect(checker.ignores(".tox/py39/lib")).toBe(true)
    })

    test("matches .nox/ directory (nox testing)", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".nox/")).toBe(true)
      expect(checker.ignores(".nox/test-3.11/bin")).toBe(true)
    })
  })

  describe("Python test & coverage artifacts", () => {
    test("matches .coverage file", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".coverage")).toBe(true)
    })

    test("matches htmlcov/ directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("htmlcov/")).toBe(true)
      expect(checker.ignores("htmlcov/index.html")).toBe(true)
      expect(checker.ignores("htmlcov/status.json")).toBe(true)
    })
  })

  describe("TypeScript build cache", () => {
    test("matches *.tsbuildinfo pattern", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("tsconfig.tsbuildinfo")).toBe(true)
      expect(checker.ignores("dist/tsconfig.tsbuildinfo")).toBe(true)
      expect(checker.ignores("src/subdir/tsconfig.tsbuildinfo")).toBe(true)
    })
  })

  describe("Existing patterns still work", () => {
    test("matches node_modules", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("node_modules/")).toBe(true)
      expect(checker.ignores("node_modules/express/index.js")).toBe(true)
    })

    test("matches lock files", () => {
      const checker = createIgnoreChecker()
      // *.lock matches files ending with .lock
      expect(checker.ignores("yarn.lock")).toBe(true)
      expect(checker.ignores("output.lock")).toBe(true)
      // *.lockb matches files ending with .lockb
      expect(checker.ignores("bun.lockb")).toBe(true)
      // Note: package-lock.json doesn't match *.lock pattern
    })

    test("matches .env files", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".env")).toBe(true)
      expect(checker.ignores(".env.local")).toBe(true)
      expect(checker.ignores(".env.test")).toBe(true)
    })

    test("matches .vuhitra directory", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores(".vuhitra/")).toBe(true)
      expect(checker.ignores(".vuhitra/settings.json")).toBe(true)
    })

    test("matches build directories", () => {
      const checker = createIgnoreChecker()
      expect(checker.ignores("dist/")).toBe(true)
      expect(checker.ignores("build/")).toBe(true)
      expect(checker.ignores("build/index.js")).toBe(true)
    })
  })

  describe("File scanning integration", () => {
    test("integration: realistic project structure", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a typical Python/JS project structure
          const dirs = [
            "src",
            "venv/bin",
            "venv/lib/python3.11/site-packages",
            ".venv/lib",
            "node_modules/express",
            "dist",
            ".next",
            "htmlcov",
            ".tox/py39",
            "MyPackage.egg-info",
          ]

          for (const d of dirs) {
            await mkdir(path.join(dir, d), { recursive: true })
          }

          // Create test files
          const files = [
            "src/main.py",
            "src/utils.js",
            "venv/pyvenv.cfg",
            "venv/bin/python",
            ".venv/activate",
            "node_modules/index.js",
            "dist/bundle.js",
            ".next/build-manifest.json",
            "htmlcov/index.html",
            ".coverage",
            "tsconfig.tsbuildinfo",
            "package.json",
            ".gitignore",
          ]

          for (const f of files) {
            await writeFile(path.join(dir, f), "test content")
          }
        },
      })

      const checker = createIgnoreChecker()

      // These SHOULD be ignored
      const shouldIgnore = [
        "venv/pyvenv.cfg",
        "venv/bin/python",
        ".venv/activate",
        "node_modules/index.js",
        "dist/bundle.js",
        ".next/build-manifest.json",
        "htmlcov/index.html",
        ".coverage",
        "tsconfig.tsbuildinfo",
      ]

      // These should NOT be ignored
      const shouldNotIgnore = ["src/main.py", "src/utils.js", "package.json", ".gitignore"]

      for (const file of shouldIgnore) {
        expect(checker.ignores(file)).toBe(true)
      }

      for (const file of shouldNotIgnore) {
        expect(checker.ignores(file)).toBe(false)
      }
    })
  })
})
