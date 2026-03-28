import { createEffect, createMemo, createSignal } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useLocal } from "@/context/local"
import { authHeaders } from "@/utils/auth"
import { showToast } from "@opencode-ai/ui/toast"
import { useParams } from "@solidjs/router"

type AgentModel = {
  providerID: string
  modelID: string
}

type AgentModels = Record<string, AgentModel>

export function useAgentModels() {
  const sync = useSync()
  const sdk = useSDK()
  const server = useServer()
  const local = useLocal()
  const params = useParams()

  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [agentModels, setAgentModels] = createSignal<AgentModels>({})

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
    profileKey()
    fetchAgentModels()
  })

  // List all agents using the same source as the prompt input agent selector
  const agents = createMemo(() => {
    return local.agent
      .list()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => ({
        name: agent.name,
        model: agentModels()[agent.name],
      }))
  })

  // Fetch agent models
  async function fetchAgentModels() {
    const directory = sdk.directory
    if (!directory) return

    setLoading(true)
    setError(undefined)

    try {
      const url = `${sdk.url}/agent-model?directory=${encodeURIComponent(directory)}`

      const res = await fetch(url, {
        headers: {
          ...authHeaders(server.current?.http),
        },
      })

      if (!res.ok) {
        throw new Error(`Failed to fetch agent models: ${res.status}`)
      }

      const data = await res.json()
      const models = (data.agent_models ?? {}) as AgentModels
      setAgentModels(models)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  // Update an agent model
  async function updateAgentModel(name: string, model: AgentModel) {
    const directory = sdk.directory
    if (!directory) {
      showToast({ variant: "error", title: "No directory context" })
      return false
    }

    setLoading(true)
    setError(undefined)

    try {
      const body: {
        agent: string
        modelID: string
        providerID: string
        directory: string
      } = {
        agent: name,
        modelID: model.modelID,
        providerID: model.providerID,
        directory,
      }

      const res = await fetch(`${sdk.url}/agent-model`, {
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

      const data = await res.json().catch(() => ({}))
      setAgentModels((data as { agent_models?: AgentModels }).agent_models ?? {})

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
    agents,
    agentModels,
    loading,
    error,
    fetchAgentModels,
    updateAgentModel,
  }
}
