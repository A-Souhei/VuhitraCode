import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { mkdir, writeFile } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Filesystem } from "../../util/filesystem"

const DEFAULT_INDEX_IGNORE = `# VuHitra index-ignore
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
`

async function resolveProjectRoot(cwd: string): Promise<string> {
  const match = await Filesystem.up({ targets: [".git"], start: cwd }).next()
  if (match.value) return path.dirname(match.value)
  return cwd
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
  async handler(args) {
    UI.empty()
    prompts.intro("Initialize project config")

    try {
      const root = await resolveProjectRoot(process.cwd())
      const vuHitraDir = path.join(root, ".vuhitra")
      const settingsPath = path.join(vuHitraDir, "settings.json")
      const indexIgnorePath = path.join(vuHitraDir, "index-ignore")

      if (!existsSync(vuHitraDir)) {
        await mkdir(vuHitraDir, { recursive: true })
      }

      const indexingEnabled = args.index

      if (!existsSync(settingsPath)) {
        const settings = {
          indexing: { enabled: indexingEnabled },
          model_lock: { enabled: false },
        }
        await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8")
        prompts.log.success(
          `.vuhitra/settings.json  (indexing: ${settings.indexing.enabled}, model_lock: ${settings.model_lock.enabled})`,
        )
      } else {
        prompts.log.info(".vuhitra/settings.json already exists, skipped")
      }

      if (!existsSync(indexIgnorePath)) {
        await writeFile(indexIgnorePath, DEFAULT_INDEX_IGNORE, "utf-8")
        prompts.log.success(".vuhitra/index-ignore")
      } else {
        prompts.log.info(".vuhitra/index-ignore already exists, skipped")
      }

      prompts.outro("Done")
    } catch (e) {
      prompts.log.error(e instanceof Error ? e.message : String(e))
      process.exit(1)
    }
  },
})
