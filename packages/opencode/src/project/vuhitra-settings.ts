import { Instance } from "./instance"
import { Profiles } from "./profiles"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import path from "path"
import fs from "fs"
import z from "zod"

export namespace VuHitraSettings {
  const SettingsSchema = z.object({
    indexing: z.object({ enabled: z.boolean().optional() }).optional(),
    memory: z.object({ enabled: z.boolean().optional() }).optional(),
    biblion: z.object({ enabled: z.boolean().optional() }).optional(),
    model_lock: z
      .object({
        enabled: z.boolean().optional(),
        model: z.string().optional(),
      })
      .optional(),
    active_profile: z.string().optional(),
    review_max_rounds: z.number().int().positive().optional(),
    explore_max_instances: z.number().int().positive().optional(),
    notifications_enabled: z.boolean().optional(),
    cache_similarity_weight: z.number().min(0).max(1).optional(),
    cache_usage_weight: z.number().min(0).max(1).optional(),
    cache_dedup_threshold: z.number().min(0).max(1).optional(),
    cache_min_similarity: z.number().min(0).max(1).optional(),
    cache_max_candidates: z.number().int().positive().optional(),
    cache_default_quality: z.number().min(0).max(1).optional(),
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
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, JSON.stringify(merged, null, 2) + "\n", "utf-8")
    try {
      if (!dir || path.resolve(dir) === path.resolve(Instance.directory)) {
        Object.assign(state(), merged)
      }
    } catch {
      // Instance context unavailable (e.g. TUI main thread); state update skipped.
    }
  }

  export function indexingEnabled(): boolean {
    return state().indexing?.enabled === true
  }

  export function memoryEnabled(): boolean {
    return state().memory?.enabled === true
  }

  export function biblionEnabled(): boolean {
    return state().biblion?.enabled === true
  }

  export function modelLock(): { enabled: boolean; model?: string } {
    const s = state()
    return {
      enabled: s.model_lock?.enabled === true,
      model: s.model_lock?.model,
    }
  }

  export async function activeProfile(dir?: string): Promise<string> {
    const cachedName = dir ? readFromDisk(dir).active_profile : state().active_profile
    const name = cachedName ?? "default"

    // Handle "no-profile" special case - return it directly
    if (name === Profiles.NO_PROFILE) {
      return Profiles.NO_PROFILE
    }

    // Check if the profile exists
    const profile = await Profiles.readProfile(name, dir)
    const exists = Object.keys(profile).length > 0

    if (!exists) {
      // Profile doesn't exist, try to create default
      try {
        await Profiles.ensureDefault(dir)
        await writeToDisk({ active_profile: "default" }, dir)
        return "default"
      } catch (err) {
        // Can't create default profile (permission denied, readonly fs, etc.)
        Log.Default.warn("vuhitra-settings: cannot create default profile, using no-profile fallback", {
          error: err instanceof Error ? err.message : String(err),
        })
        return Profiles.NO_PROFILE
      }
    }

    return name
  }

  export async function setActiveProfile(name: string, dir?: string) {
    if (name === Profiles.NO_PROFILE) {
      throw new Error(`Cannot switch to special profile '${Profiles.NO_PROFILE}'`)
    }
    if (!/^[A-Za-z0-9_\-.]+$/.test(name)) throw new Error(`Invalid profile name: ${name}`)

    // Validate that the profile exists
    if (name !== "default") {
      const profile = await Profiles.readProfile(name, dir)
      if (Object.keys(profile).length === 0) {
        throw new Error(`Profile not found: ${name}`)
      }
    }

    await writeToDisk({ active_profile: name }, dir)
    try {
      await Bus.publish(Profiles.Event.Switched, { name })
    } catch {}
  }

  export async function listProfiles(dir?: string): Promise<string[]> {
    return Profiles.list(dir)
  }

  export async function createProfile(name: string, dir?: string) {
    await Profiles.create(name, dir)
  }

  // Legacy aliases — kept for backward compatibility
  export async function scoutModel() {
    return Profiles.subagentModel(await activeProfile(), "scout")
  }

  export async function sentinelModel() {
    return Profiles.subagentModel(await activeProfile(), "sentinel")
  }

  export async function setScoutModel(model: { providerID: string; modelID: string }) {
    await Profiles.setSubagentModel(await activeProfile(), "scout", model)
  }

  export async function setSentinelModel(model: { providerID: string; modelID: string }) {
    await Profiles.setSubagentModel(await activeProfile(), "sentinel", model)
  }

  export async function agentModel(name: string, dir?: string) {
    return Profiles.agentModel(await activeProfile(dir), name, dir)
  }

  export async function setAgentModel(name: string, model: { providerID: string; modelID: string }, dir?: string) {
    await Profiles.setAgentModel(await activeProfile(dir), name, model, dir)
  }

  export async function subagentModel(name: string, dir?: string) {
    return Profiles.subagentModel(await activeProfile(dir), name, dir)
  }

  export async function setSubagentModel(name: string, model: { providerID: string; modelID: string }, dir?: string) {
    await Profiles.setSubagentModel(await activeProfile(dir), name, model, dir)
  }

  export function reviewMaxRounds() {
    return state().review_max_rounds ?? 7
  }

  export async function setReviewMaxRounds(n: number) {
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      throw new Error(`review_max_rounds must be a positive integer, got ${n}`)
    }
    await writeToDisk({ review_max_rounds: n })
  }

  export function exploreMaxInstances() {
    return state().explore_max_instances ?? 3
  }

  export async function setExploreMaxInstances(n: number) {
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      throw new Error(`explore_max_instances must be a positive integer, got ${n}`)
    }
    await writeToDisk({ explore_max_instances: n })
  }

  export function notificationsEnabled() {
    return state().notifications_enabled === true
  }

  export async function setNotificationsEnabled(enabled: boolean) {
    await writeToDisk({ notifications_enabled: enabled })
  }

  export function cacheSimilarityWeight(): number {
    return state().cache_similarity_weight ?? 0.7
  }

  export function cacheUsageWeight(): number {
    return state().cache_usage_weight ?? 0.2
  }

  export function cacheDedupThreshold(): number {
    return state().cache_dedup_threshold ?? 0.95
  }

  export function cacheMinSimilarity(): number {
    return state().cache_min_similarity ?? 0.7
  }

  export function cacheMaxCandidates(): number {
    return state().cache_max_candidates ?? 50
  }

  export function cacheDefaultQuality(): number {
    return state().cache_default_quality ?? 0.5
  }

  export async function setCacheSimilarityWeight(n: number) {
    if (typeof n !== "number" || n < 0 || n > 1) {
      throw new Error(`cache_similarity_weight must be a number between 0 and 1, got ${n}`)
    }
    await writeToDisk({ cache_similarity_weight: n })
  }

  export async function setCacheUsageWeight(n: number) {
    if (typeof n !== "number" || n < 0 || n > 1) {
      throw new Error(`cache_usage_weight must be a number between 0 and 1, got ${n}`)
    }
    await writeToDisk({ cache_usage_weight: n })
  }

  export async function setCacheDedupThreshold(n: number) {
    if (typeof n !== "number" || n < 0 || n > 1) {
      throw new Error(`cache_dedup_threshold must be a number between 0 and 1, got ${n}`)
    }
    await writeToDisk({ cache_dedup_threshold: n })
  }

  export async function setCacheMinSimilarity(n: number) {
    if (typeof n !== "number" || n < 0 || n > 1) {
      throw new Error(`cache_min_similarity must be a number between 0 and 1, got ${n}`)
    }
    await writeToDisk({ cache_min_similarity: n })
  }

  export async function setCacheMaxCandidates(n: number) {
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      throw new Error(`cache_max_candidates must be a positive integer, got ${n}`)
    }
    await writeToDisk({ cache_max_candidates: n })
  }

  export async function setCacheDefaultQuality(n: number) {
    if (typeof n !== "number" || n < 0 || n > 1) {
      throw new Error(`cache_default_quality must be a number between 0 and 1, got ${n}`)
    }
    await writeToDisk({ cache_default_quality: n })
  }
}
