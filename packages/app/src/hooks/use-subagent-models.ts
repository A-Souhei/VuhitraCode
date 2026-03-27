import { createEffect, createMemo, createSignal } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { authHeaders } from "@/utils/auth"
import { showToast } from "@opencode-ai/ui/toast"
import { useParams } from "@solidjs/router"

type SubagentModel = {
  providerID: string
  modelID: string
}

type SubagentModels = Record<string, SubagentModel>

export function useSubagentModels() {
  const sync = useSync()
  const sdk = useSDK()
  const server = useServer()
  const params = useParams()

  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [subagentModels, setSubagentModels] = createSignal<SubagentModels>({})

  // Get session profile if we're in a session context
  const sessionProfile = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return undefined
    const session = sync.session.get(sessionID)
    return session?.profile
  })

  // Track profile changes for reactive refetching
  const profileKey = createMemo(() => `${sync.data.active_profile}-${sessionProfile()}`)

  // Fetch on mount and whenever profile changes
  createEffect(() => {
    const _key = profileKey() // Track dependency
    fetchSubagentModels()
  })

  // List all subagents from sync.data.agent
  const subagents = createMemo(() => {
    return sync.data.agent.filter((agent) => agent.mode === "subagent")
  })

  // Get model lock status
  const modelLocks = createMemo(() => {
    const locks: Record<string, boolean> = {}
    for (const agent of subagents()) {
      if (agent.model_lock) {
        locks[agent.name] = true
      }
    }
    return locks
  })

  // Fetch current profile's subagent_models
  async function fetchSubagentModels() {
    const directory = sdk.directory
    if (!directory) return

    setLoading(true)
    setError(undefined)

    try {
      // Use sessionProfile if defined, otherwise get the active profile by directory
      const name = sessionProfile()
      const url = name
        ? `${sdk.url}/profile/get?name=${encodeURIComponent(name)}&directory=${encodeURIComponent(directory)}`
        : `${sdk.url}/profile/get?directory=${encodeURIComponent(directory)}`

      const res = await fetch(url, {
        headers: {
          ...authHeaders(server.current?.http),
        },
      })

      if (!res.ok) {
        throw new Error(`Failed to fetch profile: ${res.status}`)
      }

      const data = await res.json()
      const models = (data.subagent_models ?? {}) as Record<string, { providerID: string; modelID: string }>
      setSubagentModels(models)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  // Update a subagent model
  async function updateSubagentModel(name: string, model: SubagentModel) {
    const directory = sdk.directory
    if (!directory) {
      showToast({ variant: "error", title: "No directory context" })
      return false
    }

    setLoading(true)
    setError(undefined)

    try {
      const body: {
        name: string
        model: { providerID: string; modelID: string }
        sessionID?: string
        directory?: string
      } = {
        name,
        model,
      }

      // Include sessionID if available for session-specific profile
      if (params.id) {
        body.sessionID = params.id
      } else {
        body.directory = directory
      }

      const res = await fetch(`${sdk.url}/profile/set-subagent-model`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(server.current?.http),
          "x-opencode-directory": directory,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}))
        throw new Error((errorBody as { error?: string }).error ?? `HTTP ${res.status}`)
      }

      // Update local state optimistically
      setSubagentModels((prev) => ({
        ...prev,
        [name]: model,
      }))

      showToast({ variant: "success", title: `Updated ${name} model` })
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      showToast({ variant: "error", title: "Failed to update model", description: message })
      return false
    } finally {
      setLoading(false)
    }
  }

  return {
    subagents,
    subagentModels,
    modelLocks,
    loading,
    error,
    fetchSubagentModels,
    updateSubagentModel,
  }
}
