import { Instance } from "./instance"
import { Log } from "@/util/log"
import { BusEvent } from "@/bus/bus-event"
import path from "path"
import fs from "fs"
import z from "zod"

export namespace Profiles {
  const ModelRefSchema = z
    .object({
      providerID: z.string().optional(),
      modelID: z.string().optional(),
    })
    .refine((v) => (!v.providerID && !v.modelID) || (!!v.providerID && !!v.modelID), {
      message: "model requires both providerID and modelID, or neither",
    })
    .optional()

  const ProfileSchema = z.object({
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
    scout_model: ModelRefSchema,
    sentinel_model: ModelRefSchema,
  })

  export type Profile = z.infer<typeof ProfileSchema>

  export const NO_PROFILE = "no-profile"

  export function getNoProfile(): Profile {
    return { agent_models: {}, subagent_models: {} }
  }

  export const Event = {
    Switched: BusEvent.define("profile.switched", z.object({ name: z.string() })),
  }

  function profilesDir(dir?: string) {
    if (dir) return path.join(dir, ".vuhitra", "profiles")
    try {
      return path.join(Instance.directory, ".vuhitra", "profiles")
    } catch {
      return path.join(process.cwd(), ".vuhitra", "profiles")
    }
  }

  function profilePath(name: string, dir?: string) {
    const base = profilesDir(dir)
    const resolved = path.join(base, `${name}.json`)
    if (!resolved.startsWith(base + path.sep)) throw new Error(`Invalid profile name: ${name}`)
    return resolved
  }

  export async function readProfile(name: string, dir?: string): Promise<Profile> {
    // Handle "no-profile" special case
    if (name === NO_PROFILE) {
      return getNoProfile()
    }

    const filePath = profilePath(name, dir)
    try {
      const file = Bun.file(filePath)
      if (!(await file.exists())) {
        // Try to ensure default profile if requested
        if (name === "default") {
          try {
            await ensureDefault(dir)
            const file = Bun.file(filePath)
            const parsed = await file.json()
            const result = ProfileSchema.safeParse(parsed)
            return result.success ? result.data : getNoProfile()
          } catch {
            // Can't create default profile (permission denied,readonly fs, etc.)
            Log.Default.warn("profiles: cannot create default profile, returning no-profile fallback", {
              filePath,
            })
            return getNoProfile()
          }
        }
        return {}
      }
      const parsed = await file.json()
      const result = ProfileSchema.safeParse(parsed)
      if (!result.success) {
        Log.Default.warn("profiles: failed to parse profile, returning empty", {
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

  async function writeProfile(name: string, update: Partial<Profile>, dir?: string) {
    const filePath = profilePath(name, dir)
    const current = await readProfile(name, dir)
    const merged: Profile = {
      ...current,
      ...(update.agent_models !== undefined
        ? { agent_models: { ...current.agent_models, ...update.agent_models } }
        : {}),
      ...(update.subagent_models !== undefined
        ? { subagent_models: { ...current.subagent_models, ...update.subagent_models } }
        : {}),
      ...(update.scout_model !== undefined ? { scout_model: update.scout_model } : {}),
      ...(update.sentinel_model !== undefined ? { sentinel_model: update.sentinel_model } : {}),
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, JSON.stringify(merged, null, 2) + "\n", "utf-8")
  }

  export async function list(dir?: string): Promise<string[]> {
    const dir_ = profilesDir(dir)
    try {
      const entries = await fs.promises.readdir(dir_)
      const names = entries.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
      return names.includes("default") ? names : ["default", ...names]
    } catch {
      return ["default"]
    }
  }

  export async function create(name: string, dir?: string) {
    const filePath = profilePath(name, dir)
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    try {
      await fs.promises.writeFile(filePath, JSON.stringify({ agent_models: {}, subagent_models: {} }, null, 2) + "\n", {
        encoding: "utf-8",
        flag: "wx",
      })
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Profile "${name}" already exists`)
      throw err
    }
  }

  export async function ensureDefault(dir?: string) {
    const filePath = profilePath("default", dir)
    try {
      await fs.promises.writeFile(filePath, JSON.stringify({ agent_models: {}, subagent_models: {} }, null, 2) + "\n", {
        encoding: "utf-8",
        flag: "wx",
      })
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        // directory may not exist yet — create it and retry
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
        try {
          await fs.promises.writeFile(
            filePath,
            JSON.stringify({ agent_models: {}, subagent_models: {} }, null, 2) + "\n",
            { encoding: "utf-8", flag: "wx" },
          )
        } catch (err2: unknown) {
          if ((err2 as NodeJS.ErrnoException).code !== "EEXIST") throw err2
        }
      }
    }
  }

  export async function agentModel(profileName: string, agentName: string, dir?: string) {
    return (await readProfile(profileName, dir)).agent_models?.[agentName]
  }

  export async function setAgentModel(
    profileName: string,
    agentName: string,
    model: { providerID: string; modelID: string },
    dir?: string,
  ) {
    await writeProfile(profileName, { agent_models: { [agentName]: model } }, dir)
  }

  export async function subagentModel(profileName: string, name: string, dir?: string) {
    const profile = await readProfile(profileName, dir)
    const override = profile.subagent_models?.[name]
    if (override) return override
    if (name === "scout") return profile.scout_model
    if (name === "sentinel") return profile.sentinel_model
    return undefined
  }

  export async function setSubagentModel(
    profileName: string,
    name: string,
    model: { providerID: string; modelID: string },
    dir?: string,
  ) {
    await writeProfile(profileName, { subagent_models: { [name]: model } }, dir)
  }
}
