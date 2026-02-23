import { Instance } from "./instance"
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
  })
  type Settings = z.infer<typeof SettingsSchema>

  const state = Instance.state((): Settings => {
    return readFromDisk()
  })

  function readFromDisk(): Settings {
    const filePath = path.join(Instance.directory, ".vuhitra", "settings.json")
    try {
      if (!fs.existsSync(filePath)) return {}
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      const result = SettingsSchema.safeParse(parsed)
      return result.success ? result.data : {}
    } catch {
      return {}
    }
  }

  async function writeToDisk(update: Partial<Settings>) {
    const filePath = path.join(Instance.directory, ".vuhitra", "settings.json")
    const current = readFromDisk()
    const merged = { ...current, ...update }
    await fs.promises.writeFile(filePath, JSON.stringify(merged, null, 2) + "\n", "utf-8")
    // Mutate the cached state in-place so reads within the same process see the new values immediately.
    Object.assign(state(), merged)
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
}
