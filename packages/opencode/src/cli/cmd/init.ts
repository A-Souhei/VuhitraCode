import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { mkdir } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { Filesystem } from "../../util/filesystem"

// Keep DEFAULT_INDEX_IGNORE exported so other code that imports it still works
export const DEFAULT_INDEX_IGNORE = `# VuHitra index-ignore
# Files and directories excluded from semantic indexing
# Uses .gitignore syntax

node_modules/
dist/
build/
.git/
coverage/
.next/
.nuxt/
.output/
out/
*.log
*.lock
*.lockb
*.min.js
*.min.css
.env
.env.*
# self-exclusion: keep vuhitra's own config out of the index
.vuhitra/
`

// Runtime artifacts that should never be copied to other projects
const SKIP = new Set(["indexer-cache.json", "indexer-status.json"])

async function resolveProjectRoot(): Promise<string> {
  const invocationDir = process.env.PWD ?? process.cwd()
  const match = await Filesystem.up({ targets: [".git"], start: invocationDir }).next()
  if (match.value) return path.dirname(match.value)
  return invocationDir
}

export const InitCommand = cmd({
  command: "init",
  describe: "initialize .vuhitra project config",
  builder: (yargs) =>
    yargs.option("index", {
      describe: "enable semantic indexing",
      type: "boolean",
      default: true,
    }),
  async handler(_args) {
    UI.empty()
    prompts.intro("Initialize project config")

    try {
      // Source: the app's own .vuhitra/ directory (5 levels up from this file)
      const src = path.join(fileURLToPath(new URL("../../../../../.vuhitra", import.meta.url)))

      if (!(await Filesystem.exists(src))) {
        prompts.log.warn("No .vuhitra/ template found in opencode installation, skipping")
        prompts.outro("Done")
        return
      }

      const root = await resolveProjectRoot()
      const dest = path.join(root, ".vuhitra")
      await mkdir(dest, { recursive: true })

      // Walk all files in src recursively
      const glob = new Bun.Glob("**/*")
      for await (const rel of glob.scan({ cwd: src, onlyFiles: true, dot: true })) {
        const name = path.basename(rel)
        if (SKIP.has(name)) continue

        const srcFile = path.join(src, rel)
        const destFile = path.join(dest, rel)

        // Ensure parent dir exists
        await mkdir(path.dirname(destFile), { recursive: true })

        // Copy (overwrite)
        await Bun.write(destFile, Bun.file(srcFile))
        prompts.log.success(`.vuhitra/${rel}`)
      }

      // Add .vuhitra/ to .gitignore if needed
      const gitignorePath = path.join(root, ".gitignore")
      const entry = ".vuhitra/"
      if (await Filesystem.exists(gitignorePath)) {
        const current = await Filesystem.readText(gitignorePath)
        const lines = current.split("\n").map((l) => l.trim())
        if (lines.some((l) => l === entry || l === ".vuhitra")) {
          prompts.log.info(".gitignore already contains .vuhitra/, skipped")
        } else {
          const appended = current.endsWith("\n") ? current + entry + "\n" : current + "\n" + entry + "\n"
          await Filesystem.write(gitignorePath, appended)
          prompts.log.success(".gitignore  (added .vuhitra/)")
        }
      } else {
        await Filesystem.write(gitignorePath, entry + "\n")
        prompts.log.success(".gitignore  (created with .vuhitra/)")
      }

      prompts.outro("Done")
    } catch (e) {
      prompts.log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
})
