import z from "zod"
import path from "path"

export const PassOverPreferences = z.object({
  auto_confirm: z.boolean().default(false),
  timeout_ms: z.number().default(30000),
  return_to_originator: z.boolean().default(true),
  max_chain_depth: z.number().default(3),
  enabled: z.boolean().default(true),
})

export type PassOverPreferences = z.infer<typeof PassOverPreferences>

export const PassOverConfig = z.object({
  global_settings: PassOverPreferences,
  agent_pair_settings: z.record(z.string(), z.record(z.string(), PassOverPreferences)),
})

export type PassOverConfig = z.infer<typeof PassOverConfig>

export const DEFAULT_CONFIG: PassOverConfig = {
  global_settings: {
    auto_confirm: false,
    timeout_ms: 30000,
    return_to_originator: true,
    max_chain_depth: 3,
    enabled: true,
  },
  agent_pair_settings: {},
}

export async function loadPassOverConfig(directory: string): Promise<PassOverConfig> {
  const filePath = path.join(directory, ".opencode", "pass-over.json")
  const file = Bun.file(filePath)
  const exists = await file.exists()

  if (!exists) {
    return DEFAULT_CONFIG
  }

  let content: unknown
  try {
    content = await file.json()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[PassOver] Failed to parse config file at ${filePath}: ${message}. Using default configuration.`)
    return DEFAULT_CONFIG
  }

  const parsed = PassOverConfig.safeParse(content)

  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
    console.warn(`[PassOver] Config validation failed at ${filePath}: ${errors}. Using default configuration.`)
    return DEFAULT_CONFIG
  }

  return parsed.data
}

export async function savePassOverConfig(directory: string, config: PassOverConfig): Promise<void> {
  const parsed = PassOverConfig.safeParse(config)

  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
    throw new Error(`[PassOver] Config validation failed: ${errors}. Cannot save invalid configuration.`)
  }

  const dir = path.join(directory, ".opencode")
  const filePath = path.join(dir, "pass-over.json")

  // Ensure directory exists before writing
  const fs = await import("fs/promises")
  await fs.mkdir(dir, { recursive: true })

  await Bun.write(filePath, JSON.stringify(parsed.data, null, 2))
}

export function getPreferences(config: PassOverConfig, fromAgent: string, toAgent: string): PassOverPreferences {
  const pairSettings = config.agent_pair_settings?.[fromAgent]?.[toAgent]
  const global = config.global_settings

  return {
    auto_confirm: pairSettings?.auto_confirm ?? global.auto_confirm,
    timeout_ms: pairSettings?.timeout_ms ?? global.timeout_ms,
    return_to_originator: pairSettings?.return_to_originator ?? global.return_to_originator,
    max_chain_depth: pairSettings?.max_chain_depth ?? global.max_chain_depth,
    enabled: pairSettings?.enabled ?? global.enabled,
  }
}
