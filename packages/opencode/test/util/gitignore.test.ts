import { describe, expect, test } from "bun:test"
import { extractPathsFromCode, extractBarePaths, isGitignored } from "../../src/util/gitignore"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import * as fs from "fs/promises"
import path from "path"

describe("extractPathsFromCode", () => {
  test("extracts paths from single-quoted strings", () => {
    const code = `open('data/file.txt').read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("data/file.txt")
  })

  test("extracts paths from double-quoted strings", () => {
    const code = `open("data/file.txt").read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("data/file.txt")
  })

  test("extracts paths from template literals", () => {
    const code = "open(`data/file.txt`).read()"
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("data/file.txt")
  })

  test("extracts multiple paths from code", () => {
    const code = `open('input.txt').read(); write('output.txt', data)`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("input.txt")
    expect(paths).toContain("output.txt")
  })

  test("extracts paths with Windows-style backslashes", () => {
    const code = `open('C:\\\\Users\\\\data\\\\file.txt').read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("C:\\Users\\data\\file.txt")
  })

  test("extracts paths with subdirectories", () => {
    const code = `open('data-agent-test/users.csv').read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("data-agent-test/users.csv")
  })

  test("does not extract URLs", () => {
    const code = `fetch('https://example.com/api')`
    const paths = extractPathsFromCode(code)
    expect(paths).not.toContain("https://example.com/api")
  })

  test("does not extract protocol-relative URLs", () => {
    const code = `fetch('//example.com/api')`
    const paths = extractPathsFromCode(code)
    expect(paths).not.toContain("//example.com/api")
  })

  test("handles mixed quote styles", () => {
    const code = `open("path/to/file1.txt"); open('path/to/file2.txt')`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("path/to/file1.txt")
    expect(paths).toContain("path/to/file2.txt")
  })

  test("handles node fs readFileSync pattern", () => {
    const code = `require('fs').readFileSync('secret.env', 'utf8')`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("secret.env")
  })

  test("handles Python open pattern", () => {
    const code = `print(open('data-agent-test/users.csv').read())`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("data-agent-test/users.csv")
  })

  test("returns empty array for code without paths", () => {
    const code = `print("hello world")`
    const paths = extractPathsFromCode(code)
    expect(paths).toHaveLength(0)
  })

  test("handles empty strings", () => {
    const paths = extractPathsFromCode("")
    expect(paths).toHaveLength(0)
  })

  test("extracts paths from Python triple-quoted strings with single quotes", () => {
    const code = `open('''data/file.txt''').read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("data/file.txt")
  })

  test("extracts paths from Python triple-quoted strings with double quotes", () => {
    const code = `open("""data/file.txt""").read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("data/file.txt")
  })

  test("extracts paths from multiline triple-quoted strings", () => {
    const code = `open("""
data/file.txt
""").read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("\ndata/file.txt\n")
  })

  test("handles escaped single quotes in strings", () => {
    const code = `open('it\\'s/file.txt').read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("it's/file.txt")
  })

  test("handles escaped double quotes in strings", () => {
    const code = `open("he said \\"path/file.txt\\"").read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain('he said "path/file.txt"')
  })

  test("handles escaped backslashes in strings", () => {
    const code = `open('C:\\\\Users\\\\file.txt').read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("C:\\Users\\file.txt")
  })

  test("extracts paths from multiline template literals", () => {
    const code = `open(\`data/
file.txt\`).read()`
    const paths = extractPathsFromCode(code)
    expect(paths).toContain("data/\nfile.txt")
  })
})

describe("isGitignored", () => {
  test("Gitignored file returns true", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create a .gitignore that ignores node_modules
    await Bun.write(path.join(tmp.path, ".gitignore"), "node_modules/\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filepath = path.join(tmp.path, "node_modules", "package", "index.js")
        await fs.mkdir(path.dirname(filepath), { recursive: true })
        await Bun.write(filepath, "console.log('ignored')")

        const result = await isGitignored(filepath)
        expect(result).toBe(true)
      },
    })
  })

  test("Non-gitignored file returns false", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create an empty .gitignore
    await Bun.write(path.join(tmp.path, ".gitignore"), "")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filepath = path.join(tmp.path, "src", "index.js")
        await fs.mkdir(path.dirname(filepath), { recursive: true })
        await Bun.write(filepath, "console.log('not ignored')")

        const result = await isGitignored(filepath)
        expect(result).toBe(false)
      },
    })
  })

  test("Path outside worktree returns false", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Path outside the worktree
        const filepath = path.join(tmp.path, "..", "external", "file.txt")

        const result = await isGitignored(filepath)
        expect(result).toBe(false)
      },
    })
  })

  test("Non-existent path handling - matches gitignore pattern", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create a .gitignore that ignores logs/
    await Bun.write(path.join(tmp.path, ".gitignore"), "logs/\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Path that doesn't exist but matches the gitignore pattern
        const filepath = path.join(tmp.path, "logs", "app.log")

        const result = await isGitignored(filepath)
        expect(result).toBe(true)
      },
    })
  })

  test("Symlink handling - symlink to gitignored file", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create a .gitignore that ignores node_modules
    await Bun.write(path.join(tmp.path, ".gitignore"), "node_modules/\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create actual file in gitignored location
        const realPath = path.join(tmp.path, "node_modules", "pkg", "index.js")
        await fs.mkdir(path.dirname(realPath), { recursive: true })
        await Bun.write(realPath, "console.log('ignored')")

        // Create symlink in non-ignored location pointing to ignored location
        const symlinkPath = path.join(tmp.path, "linked-pkg.js")
        await Bun.write(symlinkPath, "console.log('linked')")

        // Note: git check-ignore checks the path as given, not the resolved path
        // The symlink itself is not ignored, but the target would be
        const result = await isGitignored(symlinkPath)
        expect(result).toBe(false)
      },
    })
  })
})

describe("extractBarePaths", () => {
  test("extracts simple bare path", () => {
    const result = extractBarePaths("cat file.txt")
    expect(result).toContain("file.txt")
  })

  test("extracts path with separators", () => {
    const result = extractBarePaths("cat dir/file.txt")
    expect(result).toContain("dir/file.txt")
  })

  test("extracts relative paths", () => {
    const result = extractBarePaths("cat ./secret.env")
    expect(result).toContain("./secret.env")
  })

  test("extracts parent directory paths", () => {
    const result = extractBarePaths("cat ../secret.env")
    expect(result).toContain("../secret.env")
  })

  test("extracts Windows paths", () => {
    const result = extractBarePaths("type C:\\Users\\secret.env")
    expect(result).toContain("C:\\Users\\secret.env")
  })

  test("extracts multiple paths", () => {
    const result = extractBarePaths("diff file1.txt file2.txt")
    expect(result).toContain("file1.txt")
    expect(result).toContain("file2.txt")
  })

  test("excludes shell keywords", () => {
    const result = extractBarePaths("if cat file.txt")
    expect(result).toContain("file.txt")
    expect(result).not.toContain("if")
  })

  test("excludes commands and arguments", () => {
    const result = extractBarePaths("cat file.txt | grep pattern")
    expect(result).toContain("file.txt")
    expect(result).not.toContain("grep")
    expect(result).not.toContain("pattern")
  })

  test("excludes flags", () => {
    const result = extractBarePaths("cat -n file.txt")
    expect(result).toContain("file.txt")
    expect(result).not.toContain("-n")
  })

  test("excludes variables", () => {
    const result = extractBarePaths("cat $HOME/file.txt")
    expect(result).not.toContain("$HOME/file.txt")
    expect(result).not.toContain("HOME/file.txt")
  })

  test("extracts path with extension", () => {
    const result = extractBarePaths("python script.py")
    expect(result).toContain("script.py")
  })

  test("handles quoted paths", () => {
    const result = extractBarePaths('cat "my file.txt"')
    expect(result).toContain('"my file.txt"')
  })
})
