import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Indexer } from "../../indexer"
import { Env } from "../../env"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"

// Delete subcommand
const IndexDeleteCommand = cmd({
  command: "delete",
  describe: "delete all index data for the current project",
  builder: (yargs: Argv) =>
    yargs.option("force", {
      alias: "f",
      type: "boolean",
      describe: "skip confirmation prompt",
      default: false,
    }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      if (!args.force) {
        UI.empty()
        const confirmed = await prompts.confirm({
          message: "Delete all index data for this project? This will be re-indexed on next use.",
        })
        if (prompts.isCancel(confirmed) || !confirmed) {
          console.log("Cancelled")
          return
        }
      }

      try {
        UI.empty()
        const spinner = prompts.spinner()
        spinner.start("Deleting index data")

        await Indexer.deleteCollection()

        spinner.stop("✓ Index data deleted successfully")
        console.log("\nThe indexer will automatically regenerate the index on next use.")
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const url = Env.get("QDRANT_URL") || "http://localhost:6333"

        // Distinguish between connection issues and deletion failures
        if (msg.includes("Failed to delete collection")) {
          // Real deletion failure (404 is handled idempotently, so this is a real error)
          const status = msg.match(/(\d+)/)?.[1]
          const hint =
            status === "503"
              ? "Qdrant appears to be unavailable"
              : status === "401" || status === "403"
                ? "Authentication failed; check QDRANT_API_KEY"
                : "Qdrant returned an error"
          prompts.log.error(`Failed to delete index: ${msg}\n${hint}\nQdrant URL: ${url}`)
        } else if (msg.includes("Invalid QDRANT_URL") || msg.includes("fetch") || msg.includes("Connect")) {
          // Configuration or network issues
          prompts.log.error(`Failed to connect to Qdrant: ${msg}\nCheck QDRANT_URL: ${url}`)
        } else {
          // Other unexpected errors
          prompts.log.error(`Failed to delete index: ${msg}`)
        }
        process.exit(1)
      }
    })
  },
})

// Main index command group
export const IndexCommand = cmd({
  command: "index",
  describe: "manage project index and embeddings",
  builder: (yargs: Argv) => yargs.command(IndexDeleteCommand).demandCommand(),
  async handler() {
    // No-op, subcommands handle the logic
  },
})
