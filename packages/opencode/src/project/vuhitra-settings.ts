import { Instance } from "./instance"
import path from "path"
import fs from "fs"
import z from "zod"

export namespace VuHitraSettings {
  const SettingsSchema = z.object({
    indexing: z.object({ enabled: z.boolean().optional() }).optional(),
  })
  type Settings = z.infer<typeof SettingsSchema>

  const state = Instance.state((): Settings => {
    const filePath = path.join(Instance.directory, ".vuhitra", "settings.json")
    try {
      if (!fs.existsSync(filePath)) return {}
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"))
      const result = SettingsSchema.safeParse(parsed)
      return result.success ? result.data : {}
    } catch {
      return {}
    }
  })

  export function indexingEnabled(): boolean {
    return state().indexing?.enabled === true
  }
}
