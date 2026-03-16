import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { mkdir } from "fs/promises"
import { existsSync, statSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { Filesystem } from "../../util/filesystem"

// Runtime artifacts that should never be copied to other projects
const SKIP = new Set(["indexer-cache.json", "indexer-status.json", "index-ignore"])

function findTemplateSrc(): string | null {
  const nextToBinary = path.join(path.dirname(process.execPath), ".vuhitra")
  if (existsSync(nextToBinary)) return nextToBinary

  if (!import.meta.url.startsWith("/$bunfs/")) {
    const fromSource = fileURLToPath(new URL("../../../../../.vuhitra", import.meta.url))
    if (existsSync(fromSource)) return fromSource
  }

  return null
}

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

const RULES_MD = `# Project Rules

Add project-specific instructions for the AI here.
These rules are included in every session for this project.
`

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
      const root = await resolveProjectRoot()
      const dest = path.join(root, ".vuhitra")
      await mkdir(dest, { recursive: true })

      // Find source template
      const src = findTemplateSrc()
      if (src) {
        prompts.log.info("copying .vuhitra/ template (existing files will be overwritten)")
        const glob = new Bun.Glob("**/*")
        for await (const rel of glob.scan({ cwd: src, onlyFiles: true, dot: true })) {
          if (SKIP.has(path.basename(rel))) continue
          const srcFile = path.join(src, rel)
          // Guard: skip directories (Bun glob may yield them despite onlyFiles:true)
          if (statSync(srcFile).isDirectory()) continue
          const destFile = path.join(dest, rel)
          // Path traversal guard
          if (!path.resolve(destFile).startsWith(path.resolve(dest) + path.sep)) {
            throw new Error(`Path traversal detected: ${rel}`)
          }
          await mkdir(path.dirname(destFile), { recursive: true })
          await Bun.write(destFile, Bun.file(srcFile))
          prompts.log.success(`.vuhitra/${rel}`)
        }
      } else {
        prompts.log.warn(
          "No .vuhitra/ template found. Run opencode init from your opencode installation directory first, or place your .vuhitra/ next to the opencode binary.",
        )

        // Write defaults
        await Bun.write(path.join(dest, "settings.json"), "{}\n")
        prompts.log.success(".vuhitra/settings.json")

        await Bun.write(path.join(dest, "rules.md"), RULES_MD)
        prompts.log.success(".vuhitra/rules.md")

        await Bun.write(path.join(dest, "index-ignore"), DEFAULT_INDEX_IGNORE)
        prompts.log.success(".vuhitra/index-ignore")
      }

      // Handle --no-index: disable indexing in settings.json
      if (!_args.index) {
        const settingsPath = path.join(dest, "settings.json")
        const raw = await Filesystem.readText(settingsPath)
        const obj: unknown = JSON.parse(raw)
        if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
          prompts.log.warn("settings.json does not contain a JSON object, skipping --no-index patch")
        } else {
          const settings = obj as Record<string, unknown>
          settings.indexing ??= {}
          ;(settings.indexing as Record<string, unknown>).enabled = false
          await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n")
          prompts.log.info("indexing disabled in settings.json (--no-index)")
        }
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
