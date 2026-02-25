import { Instance } from "./instance"
import { Log } from "@/util/log"
import path from "path"
import fs from "fs"
import z from "zod"

export namespace VuHitraSettings {
  const ModelRefSchema = z
    .object({
      providerID: z.string().optional(),
      modelID: z.string().optional(),
    })
    .refine((v) => (!v.providerID && !v.modelID) || (!!v.providerID && !!v.modelID), {
      message: "scout_model/sentinel_model requires both providerID and modelID, or neither",
    })
    .optional()

  const SettingsSchema = z.object({
    indexing: z.object({ enabled: z.boolean().optional() }).optional(),
    model_lock: z
      .object({
        enabled: z.boolean().optional(),
        model: z.string().optional(),
      })
      .optional(),
    scout_model: ModelRefSchema,
    sentinel_model: ModelRefSchema,
    agent_models: z
      .record(
        z
          .string()
          .max(128)
          .regex(/^[A-Za-z0-9_\-./:]+$/),
        ModelRefSchema,
      )
      .optional(),
    subagent_models: z
      .record(
        z
          .string()
          .max(128)
          .regex(/^[A-Za-z0-9_\-./:]+$/),
        ModelRefSchema,
      )
      .optional(),
    review_max_rounds: z.number().int().positive().optional(),
  })
  type Settings = z.infer<typeof SettingsSchema>

  const state = Instance.state((): Settings => {
    return readFromDisk()
  })

  function readFromDisk(dir?: string): Settings {
    const filePath = path.join(dir ?? Instance.directory, ".vuhitra", "settings.json")
    try {
      if (!fs.existsSync(filePath)) return {}
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      const result = SettingsSchema.safeParse(parsed)
      if (!result.success) {
        Log.Default.warn("vuhitra-settings: failed to parse settings, returning empty", {
          filePath,
          errors: result.error.issues,
        })
        return {}
      }
      return result.data
    } catch {
      return {}
    }
  }

  async function writeToDisk(update: Partial<Settings>, dir?: string) {
    const filePath = path.join(dir ?? Instance.directory, ".vuhitra", "settings.json")
    const current = readFromDisk(dir)
    const merged = { ...current, ...update }
    await fs.promises.writeFile(filePath, JSON.stringify(merged, null, 2) + "\n", "utf-8")
    // Mutate the cached state in-place so reads within the same process see the new values immediately.
    // Only update the in-memory cache when operating on the canonical Instance directory.
    if (!dir || dir === Instance.directory) Object.assign(state(), merged)
  }

  export function indexingEnabled(): boolean {
    return state().indexing?.enabled === true
  }

  export function modelLock(): { enabled: boolean; model?: string } {
    const s = state()
    return {
      enabled: s.model_lock?.enabled === true,
      model: s.model_lock?.model,
    }
  }

  export function scoutModel(): { providerID?: string; modelID?: string } | undefined {
    return state().scout_model
  }

  export function sentinelModel(): { providerID?: string; modelID?: string } | undefined {
    return state().sentinel_model
  }

  export async function setScoutModel(model: { providerID: string; modelID: string }) {
    await writeToDisk({ scout_model: model })
  }

  export async function setSentinelModel(model: { providerID: string; modelID: string }) {
    await writeToDisk({ sentinel_model: model })
  }

  export function agentModel(name: string): { providerID?: string; modelID?: string } | undefined {
    return state().agent_models?.[name]
  }

  export async function setAgentModel(name: string, model: { providerID: string; modelID: string }, dir?: string) {
    const current = readFromDisk(dir).agent_models ?? {}
    await writeToDisk({ agent_models: { ...current, [name]: model } }, dir)
  }

  export function subagentModel(name: string): { providerID?: string; modelID?: string } | undefined {
    const override = state().subagent_models?.[name]
    if (override) return override
    if (name === "scout") return state().scout_model
    if (name === "sentinel") return state().sentinel_model
    return undefined
  }

  export async function setSubagentModel(name: string, model: { providerID: string; modelID: string }, dir?: string) {
    const current = readFromDisk(dir).subagent_models ?? {}
    await writeToDisk({ subagent_models: { ...current, [name]: model } }, dir)
  }

  export function reviewMaxRounds() {
    return state().review_max_rounds ?? 7
  }

  export async function setReviewMaxRounds(n: number) {
    await writeToDisk({ review_max_rounds: n })
  }
}
