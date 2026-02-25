import { Instance } from "../project/instance"
import path from "path"
import fs from "fs"

function loadEnvJson(directory: string) {
  const p = path.join(directory, ".vuhitra", "env.json")
  if (!fs.existsSync(p)) return {}
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf-8"))
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      console.warn(`[vuhitra] Warning: failed to parse ${p} — env.json overrides were not applied`)
      return {}
    }
    const result: Record<string, string> = {}
    // _comment keys (and any key without a known prefix) are naturally excluded — only OLLAMA_, QDRANT_, etc. prefixes pass the allowlist
    const allowed = ["OLLAMA_", "QDRANT_", "EMBEDDING_", "INDEXER_"]
    for (const [key, value] of Object.entries(json)) {
      if (allowed.some((prefix) => key.startsWith(prefix)) && typeof value === "string" && value !== "") {
        result[key] = value
      }
    }
    return result
  } catch {
    console.warn(`[vuhitra] Warning: failed to parse ${p} — env.json overrides were not applied`)
    return {}
  }
}

function loadEnvFile(directory: string) {
  try {
    const envPath = path.join(directory, ".env")
    if (!fs.existsSync(envPath)) return {}

    const text = fs.readFileSync(envPath, "utf-8")
    const env: Record<string, string> = {}

    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue

      const equalIndex = trimmed.indexOf("=")
      if (equalIndex === -1) continue

      const keyRaw = trimmed.slice(0, equalIndex).trim()
      let value = trimmed.slice(equalIndex + 1).trim()

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      // Handle export prefix
      const key = keyRaw.startsWith("export ") ? keyRaw.slice(6) : keyRaw

      if (key) env[key] = value
    }

    return env
  } catch {
    return {}
  }
}

export namespace Env {
  const state = Instance.state(() => {
    const base = { ...process.env } as Record<string, string | undefined>

    const directory = Instance.directory
    if (directory && !process.env.OPENCODE_TEST_HOME) {
      const fileEnv = loadEnvFile(directory)
      const jsonEnv = loadEnvJson(directory)
      // Precedence: process.env > jsonEnv > fileEnv
      return { ...fileEnv, ...jsonEnv, ...base }
    }

    return base
  })

  export function get(key: string) {
    const env = state()
    return env[key]
  }

  export function all() {
    return state()
  }

  export function set(key: string, value: string) {
    const env = state()
    env[key] = value
  }

  export function remove(key: string) {
    const env = state()
    delete env[key]
  }
}
