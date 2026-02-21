import { Instance } from "../project/instance"
import path from "path"
import fs from "fs"

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
  let envLoaded = false

  const state = Instance.state(() => {
    // Create a shallow copy to isolate environment per instance
    // Prevents parallel tests from interfering with each other's env vars
    const base = { ...process.env } as Record<string, string | undefined>

    // Load .env file from project directory (only in project context, not during testing)
    const directory = Instance.directory
    if (directory && !process.env.OPENCODE_TEST_HOME && !envLoaded) {
      envLoaded = true
      const fileEnv = loadEnvFile(directory)
      // Merge file env into base, but process.env takes precedence
      return { ...fileEnv, ...base }
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
