import { createSignal, Match, Show, Switch, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { Switch as ToggleSwitch } from "@opencode-ai/ui/switch"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { authHeaders } from "@/utils/auth"
import { useSync } from "@/context/sync"
import { useBridge } from "@/context/bridge"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useParams } from "@solidjs/router"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DialogBecomeFriend } from "./dialog-become-friend"
import { SubagentModelsPanel } from "./subagent-models-panel"
import { AgentModelsPanel } from "./agent-models-panel"
import { EnvInfoPanel } from "./env-info-panel"

type FeaturesResponse = {
  indexing: { enabled: boolean }
  memory: { enabled: boolean; ttl?: number }
  biblion: { enabled: boolean }
  model_lock: { enabled: boolean }
  review_max_rounds: number
  explore_max_instances: number
  compaction_threshold: number
  file_not_found?: boolean
}

function fmt(n: number) {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}

function DialogConfirmDelete(props: {
  title: string
  description: string
  label: string
  onConfirm: () => Promise<void>
}) {
  const dialog = useDialog()
  const [pending, setPending] = createSignal(false)

  async function handle() {
    if (pending()) return
    setPending(true)
    dialog.close()
    await props.onConfirm()
  }

  return (
    <Dialog title={props.title} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <span class="text-14-regular text-text-strong">{props.description}</span>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button variant="primary" size="large" onClick={handle} disabled={pending()}>
            {props.label}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export default function SessionInfoPanel() {
  const sdk = useSDK()
  const server = useServer()
  const sync = useSync()
  const params = useParams()

  const memory = () => sync.data.memory_status
  const biblion = () => sync.data.biblion_status
  const indexer = () => sync.data.indexer_status

  const memoryEnabled = () => sync.data.settings?.memory?.enabled ?? false
  const indexerEnabled = () => sync.data.settings?.indexing?.enabled ?? false
  const biblionEnabled = () => sync.data.settings?.biblion?.enabled ?? false

  const [deleting, setDeleting] = createStore({ mem: false, bib: false })

  const bridge = useBridge()
  const [bridgeLoading, setBridgeLoading] = createStore({ master: false, leave: false })
  const dialog = useDialog()

  const isMaster = () => bridge.state.role === "master"

  async function becomeMaster() {
    const id = params.id
    if (!id) return
    const dir = sdk.directory
    if (!dir) return
    const title = dir.split("/").filter(Boolean).at(-1) ?? dir
    setBridgeLoading("master", true)
    try {
      const res = await fetch(`${sdk.url}/bridge/set-master`, {
        method: "POST",
        headers: {
          ...authHeaders(server.current?.http),
          "Content-Type": "application/json",
          "x-opencode-directory": dir,
        },
        body: JSON.stringify({
          sessionID: id,
          slug: title,
          title,
          directory: dir,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const data = await res.json().catch(() => ({}))
      showToast({ variant: "success", title: "Bridge master mode enabled" })
      bridge.set({ role: "master", id: (data as { bridgeID?: string }).bridgeID ?? null, sessionID: id })
    } catch (e) {
      showToast({
        variant: "error",
        title: "Failed to enable bridge master",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBridgeLoading("master", false)
    }
  }

  async function leaveBridge() {
    const dir = sdk.directory
    if (!dir) return
    setBridgeLoading("leave", true)
    try {
      const res = await fetch(`${sdk.url}/bridge/leave`, {
        method: "POST",
        headers: {
          ...authHeaders(server.current?.http),
          "Content-Type": "application/json",
          "x-opencode-directory": dir,
        },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await res.text())
      showToast({ variant: "success", title: "Left bridge" })
      bridge.set({ role: null, id: null, sessionID: null })
    } catch (e) {
      showToast({
        variant: "error",
        title: "Failed to leave bridge",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBridgeLoading("leave", false)
    }
  }

  function openBecomeFriend() {
    const id = params.id
    const dir = sdk.directory
    if (!id || !dir) return
    dialog.show(() => (
      <DialogBecomeFriend
        sessionID={id}
        directory={dir}
        onSuccess={() => {
          bridge.set("role", "friend")
        }}
      />
    ))
  }

  function deleteMem() {
    dialog.show(() => (
      <DialogConfirmDelete
        title="Clear memory"
        description="Are you sure you want to clear all memory entries? This cannot be undone."
        label="Clear"
        onConfirm={async () => {
          setDeleting("mem", true)
          try {
            await sdk.client.memory.delete({ directory: sdk.directory })
          } catch (e) {
            showToast({
              variant: "error",
              title: "Failed to clear memory",
              description: e instanceof Error ? e.message : String(e),
            })
          } finally {
            setDeleting("mem", false)
          }
        }}
      />
    ))
  }

  function clearBib() {
    dialog.show(() => (
      <DialogConfirmDelete
        title="Clear biblion"
        description="Are you sure you want to clear all biblion entries? This cannot be undone."
        label="Clear"
        onConfirm={async () => {
          setDeleting("bib", true)
          try {
            await sdk.client.biblion.clear({ directory: sdk.directory })
          } catch (e) {
            showToast({
              variant: "error",
              title: "Failed to clear biblion",
              description: e instanceof Error ? e.message : String(e),
            })
          } finally {
            setDeleting("bib", false)
          }
        }}
      />
    ))
  }

  return (
    <div class="h-full flex flex-col overflow-hidden">
      <div class="flex-1 min-h-0 overflow-y-auto">
        {/* Memory */}
        <div class="px-4 py-3 border-b border-border-weak-base">
          <div class="flex items-center gap-2 min-w-0">
            <Icon name="brain" size="small" class="text-icon-base shrink-0" />
            <Tooltip
              placement="top"
              value="Persistent knowledge base that stores context and findings from previous sessions. Helps agents understand project history and avoid re-exploring same code."
            >
              <span class="text-12-medium text-text-strong">Memory</span>
            </Tooltip>
            <div class="flex-1" />
            <Show when={!memoryEnabled()}>
              <span class="text-12-regular text-text-weaker shrink-0 italic">Disabled (in settings)</span>
            </Show>
            <Show when={memoryEnabled() && memory()?.type === "ready" ? memory() : undefined}>
              {(mem) => (
                <>
                  <span class="text-12-regular text-text-weak shrink-0">
                    {fmt((mem() as { entry_count: number; token_count: number }).entry_count)} entries
                    {" · "}
                    {fmt((mem() as { entry_count: number; token_count: number }).token_count)} tokens
                  </span>
                  <IconButton
                    icon="trash"
                    size="small"
                    variant="ghost"
                    aria-label="Clear memory"
                    disabled={deleting.mem}
                    onClick={deleteMem}
                  />
                </>
              )}
            </Show>
            <Show when={memoryEnabled() && memory()?.type === "disabled"}>
              <span class="text-12-regular text-text-weak shrink-0">Disabled</span>
            </Show>
            <Show when={memoryEnabled() && !memory()}>
              <span class="text-12-regular text-text-weaker">—</span>
            </Show>
          </div>
        </div>

        {/* Indexer */}
        <div class="px-4 py-3 border-b border-border-weak-base">
          <div class="flex items-center gap-2 min-w-0">
            <Icon name="magnifying-glass" size="small" class="text-icon-base shrink-0" />
            <Tooltip
              placement="top"
              value="Full-text and semantic search index of codebase. Enables fast code discovery and helps agents understand code structure and relationships."
            >
              <span class="text-12-medium text-text-strong">Indexer</span>
            </Tooltip>
            <div class="flex-1" />
            <Show when={!indexerEnabled()}>
              <span class="text-12-regular text-text-weaker shrink-0 italic">Disabled (in settings)</span>
            </Show>
            <Show when={indexerEnabled()} fallback={<span class="text-12-regular text-text-weaker">—</span>}>
              <Switch>
                <Match when={indexer()?.type === "complete"}>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <div class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    <span class="text-12-regular text-text-weak">Complete</span>
                  </div>
                </Match>
                <Match when={indexer()?.type === "indexing" ? indexer() : undefined}>
                  {(idx) => (
                    <span class="text-12-regular text-text-weak shrink-0">
                      Indexing… {(idx() as { progress: number; total: number }).progress}
                      {" / "}
                      {(idx() as { progress: number; total: number }).total}
                    </span>
                  )}
                </Match>
                <Match when={indexer()?.type === "disabled"}>
                  <span class="text-12-regular text-text-weak shrink-0">Disabled</span>
                </Match>
              </Switch>
            </Show>
          </div>
        </div>

        {/* Biblion */}
        <div class="px-4 py-3 border-b border-border-weak-base">
          <div class="flex items-center gap-2 min-w-0">
            <Icon name="bullet-list" size="small" class="text-icon-base shrink-0" />
            <Tooltip
              placement="top"
              value="Vector database of codebase knowledge. Stores architecture, patterns, dependencies, and workflows discovered by agents for future reference."
            >
              <span class="text-12-medium text-text-strong">Biblion</span>
            </Tooltip>
            <div class="flex-1" />
            <Show when={!biblionEnabled()}>
              <span class="text-12-regular text-text-weaker shrink-0 italic">Disabled (in settings)</span>
            </Show>
            <Show when={biblionEnabled() && biblion()?.type === "ready" ? biblion() : undefined}>
              {(bib) => (
                <>
                  <span class="text-12-regular text-text-weak shrink-0">
                    {fmt((bib() as { entry_count: number; token_count: number }).entry_count)} entries
                    {" · "}
                    {fmt((bib() as { entry_count: number; token_count: number }).token_count)} tokens
                  </span>
                  <IconButton
                    icon="trash"
                    size="small"
                    variant="ghost"
                    aria-label="Clear biblion"
                    disabled={deleting.bib}
                    onClick={clearBib}
                  />
                </>
              )}
            </Show>
            <Show when={biblionEnabled() && biblion()?.type === "disabled"}>
              <span class="text-12-regular text-text-weak shrink-0">Disabled</span>
            </Show>
            <Show when={biblionEnabled() && !biblion()}>
              <span class="text-12-regular text-text-weaker">—</span>
            </Show>
          </div>
        </div>

        {/* Bridge */}
        <div class="px-4 py-3 border-b border-border-weak-base">
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <Icon name="link" size="small" class="text-icon-base shrink-0" />
              <Tooltip
                placement="top"
                value="Multi-terminal collaboration mode. Master node orchestrates work, Friends provide parallel compute across different codebases or machines."
              >
                <span class="text-12-medium text-text-strong flex-1 min-w-0">Bridge</span>
              </Tooltip>
              <Show
                when={bridge.state.role}
                fallback={<span class="text-12-regular text-text-weaker shrink-0">—</span>}
              >
                <span class="text-12-regular text-text-weak shrink-0 capitalize">{bridge.state.role}</span>
              </Show>
            </div>
            <Show when={isMaster() && bridge.state.sessionID}>
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-11-regular text-text-weaker font-mono truncate flex-1 min-w-0 select-all">
                  {bridge.state.sessionID}
                </span>
                <IconButton
                  icon="copy"
                  size="small"
                  variant="ghost"
                  aria-label="Copy session ID"
                  onClick={() => {
                    const sid = bridge.state.sessionID
                    if (!sid) return
                    navigator.clipboard
                      .writeText(sid)
                      .then(() => showToast({ variant: "success", title: "Session ID copied" }))
                      .catch(() => showToast({ variant: "error", title: "Failed to copy session ID" }))
                  }}
                />
              </div>
            </Show>
            <div class="flex gap-2">
              <Show when={!bridge.state.role}>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={bridgeLoading.master || !params.id}
                  onClick={becomeMaster}
                >
                  Become Master
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={!params.id || !sync.data.path.directory}
                  onClick={openBecomeFriend}
                >
                  Become Friend
                </Button>
              </Show>
              <Show when={bridge.state.role}>
                <Button size="small" variant="ghost" disabled={bridgeLoading.leave} onClick={leaveBridge}>
                  Leave
                </Button>
              </Show>
            </div>
          </div>
        </div>

        {/* Settings */}
        <SettingsPanel />

        {/* Actions */}
        <ActionsPanel />

        {/* Agent Models */}
        <AgentModelsPanel />

        {/* Subagent Models */}
        <SubagentModelsPanel />

        {/* Project Info */}
        <EnvInfoPanel />
      </div>
    </div>
  )
}

function ActionsPanel() {
  const sdk = useSDK()
  const server = useServer()

  const [initLoading, setInitLoading] = createSignal(false)
  const [isInitialized, setIsInitialized] = createSignal<boolean | undefined>(undefined)

  onMount(async () => {
    const dir = sdk.directory
    if (!dir) return
    try {
      const res = await fetch(`${sdk.url}/settings/features?directory=${encodeURIComponent(dir)}`, {
        headers: authHeaders(server.current?.http),
      })
      if (res.ok) {
        const data = (await res.json()) as { file_not_found?: boolean }
        setIsInitialized(!data.file_not_found)
      }
    } catch {
      // silently ignore — button stays enabled
    }
  })

  async function initializeVuhitracode() {
    const dir = sdk.directory
    if (!dir) return

    setInitLoading(true)
    try {
      const res = await fetch(`${sdk.url}/init`, {
        method: "POST",
        headers: {
          ...authHeaders(server.current?.http),
          "Content-Type": "application/json",
          "x-opencode-directory": dir,
        },
        body: JSON.stringify({ directory: dir }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      setIsInitialized(true)
      showToast({ variant: "success", title: "Vuhitracode initialized successfully" })
    } catch (e) {
      showToast({
        variant: "error",
        title: "Failed to initialize vuhitracode",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setInitLoading(false)
    }
  }

  return (
    <div class="px-4 py-3 border-b border-border-weak-base">
      <div class="flex items-center gap-2 min-w-0 mb-2">
        <Icon name="glasses" size="small" class="text-icon-base shrink-0" />
        <span class="text-12-medium text-text-strong flex-1 min-w-0">Actions</span>
      </div>
      <div class="flex gap-2">
        <Tooltip
          placement="top"
          value={
            isInitialized()
              ? "Vuhitracode is already initialized in this directory"
              : "Initialize vuhitracode configuration files and structure in this directory"
          }
        >
          <Button
            size="small"
            variant="secondary"
            disabled={initLoading() || !sdk.directory || isInitialized() === true}
            onClick={initializeVuhitracode}
          >
            <Icon name="folder-add-left" size="small" />
            Initialize Vuhitracode
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

function SettingsPanel() {
  const sdk = useSDK()
  const server = useServer()
  const sync = useSync()

  const [state, setState] = createStore<{
    loading: boolean
    error: string | null
    features: FeaturesResponse | null
    pending: Record<string, boolean>
    fileNotFound: boolean
  }>({
    loading: true,
    error: null,
    features: null,
    pending: {},
    fileNotFound: false,
  })

  const fetchFeatures = async () => {
    const dir = sdk.directory
    if (!dir) return

    setState("loading", true)
    setState("error", null)

    try {
      const res = await fetch(`${sdk.url}/settings/features?directory=${encodeURIComponent(dir)}`, {
        headers: authHeaders(server.current?.http),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = (await res.json()) as FeaturesResponse
      setState("features", data)
      setState("fileNotFound", !!data.file_not_found)
    } catch (e) {
      setState("error", e instanceof Error ? e.message : String(e))
    } finally {
      setState("loading", false)
    }
  }

  const updateFeature = async (key: string, value: boolean | number) => {
    const dir = sdk.directory
    if (!dir || !state.features) return

    setState("pending", key, true)

    try {
      const res = await fetch(`${sdk.url}/settings/features?directory=${encodeURIComponent(dir)}`, {
        method: "POST",
        headers: {
          ...authHeaders(server.current?.http),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key, value, directory: dir }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const data = (await res.json()) as FeaturesResponse
      setState("features", data)
      setState("fileNotFound", false)

      // Update sync.data.settings so status displays react immediately
      if (typeof value === "boolean") {
        const category = key.replace(".enabled", "") as "memory" | "indexing" | "biblion" | "model_lock"
        const currentSettings = sync.data.settings ?? {}
        sync.set("settings", {
          ...currentSettings,
          [category]: { enabled: value },
        })
      }

      showToast({ variant: "success", title: "Setting updated" })
    } catch (e) {
      showToast({
        variant: "error",
        title: "Failed to update setting",
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setState("pending", key, false)
    }
  }

  onMount(fetchFeatures)

  const onToggleChange = (key: string, checked: boolean) => {
    updateFeature(key, checked)
  }

  const onNumberChange = (key: string, value: string) => {
    const num = parseFloat(value)
    if (isNaN(num)) return
    updateFeature(key, num)
  }

  const stepValue = (key: string, delta: number, min: number, max: number) => {
    if (!state.features) return
    const current = getFeatureValue(key) as number
    const newValue = Math.max(min, Math.min(max, current + delta))
    updateFeature(key, newValue)
  }

  const getFeatureValue = (key: string): boolean | number => {
    if (!state.features) return false
    switch (key) {
      case "memory.enabled":
        return state.features.memory.enabled
      case "memory.ttl":
        return state.features.memory.ttl ?? 86400
      case "indexing.enabled":
        return state.features.indexing.enabled
      case "biblion.enabled":
        return state.features.biblion.enabled
      case "model_lock.enabled":
        return state.features.model_lock.enabled
      case "review_max_rounds":
        return state.features.review_max_rounds
      case "explore_max_instances":
        return state.features.explore_max_instances
      case "compaction_threshold":
        return state.features.compaction_threshold
      default:
        return false
    }
  }

  return (
    <div class="px-4 py-3 border-b border-border-weak-base">
      <div class="flex items-center gap-2 min-w-0">
        <Icon name="settings-gear" size="small" class="text-icon-base shrink-0" />
        <span class="text-12-medium text-text-strong flex-1 min-w-0">Settings</span>
        <Show when={state.loading}>
          <span class="text-11-regular text-text-weaker shrink-0">Loading...</span>
        </Show>
      </div>
      <Show when={state.error}>
        <span class="text-12-regular text-error mt-1">{state.error}</span>
      </Show>
      <Show when={state.fileNotFound}>
        <span class="text-11-regular text-text-weaker mt-1 block">
          Settings file not found. Using default values. Changes will create the file.
        </span>
      </Show>
      <Show when={!state.loading && state.features}>
        <div class="flex flex-col gap-2 mt-2">
          {/* Memory */}
          <div class="flex items-center gap-2 min-w-0">
            <Tooltip
              placement="top"
              value="Enable/disable persistent memory system for storing session context and findings."
            >
              <span class="text-12-regular text-text-base">Memory</span>
            </Tooltip>
            <div class="flex-1" />
            <ToggleSwitch
              checked={state.features?.memory?.enabled ?? false}
              disabled={state.pending["memory.enabled"]}
              onChange={(checked) => onToggleChange("memory.enabled", checked)}
            >
              <span class="sr-only">Memory</span>
            </ToggleSwitch>
          </div>

          {/* Memento TTL */}
          <div class="flex items-center gap-2 min-w-0">
            <Tooltip
              placement="top"
              value="Time-to-live in seconds for memory entries. Older entries are automatically removed after this duration."
            >
              <span class="text-12-regular text-text-base">Memento TTL</span>
            </Tooltip>
            <div class="flex-1" />
            <div class="flex items-center gap-1 shrink-0">
              <IconButton
                icon="dash"
                size="small"
                variant="ghost"
                aria-label="Decrease"
                disabled={state.pending["memory.ttl"] || (state.features?.memory?.ttl ?? 86400) <= 1}
                onClick={() => stepValue("memory.ttl", -3600, 1, 31536000)}
              />
              <InlineInput
                type="number"
                width="5rem"
                class="text-12-regular text-text-base text-center"
                value={state.features?.memory?.ttl ?? 86400}
                disabled={state.pending["memory.ttl"]}
                onChange={(e) => onNumberChange("memory.ttl", e.currentTarget.value)}
              />
              <IconButton
                icon="plus-small"
                size="small"
                variant="ghost"
                aria-label="Increase"
                disabled={state.pending["memory.ttl"] || (state.features?.memory?.ttl ?? 86400) >= 31536000}
                onClick={() => stepValue("memory.ttl", 3600, 1, 31536000)}
              />
            </div>
          </div>

          {/* Indexing */}
          <div class="flex items-center gap-2 min-w-0">
            <Tooltip placement="top" value="Enable/disable codebase indexing for fast search and discovery.">
              <span class="text-12-regular text-text-base">Indexing</span>
            </Tooltip>
            <div class="flex-1" />
            <ToggleSwitch
              checked={state.features?.indexing?.enabled ?? false}
              disabled={state.pending["indexing.enabled"]}
              onChange={(checked) => onToggleChange("indexing.enabled", checked)}
            >
              <span class="sr-only">Indexing</span>
            </ToggleSwitch>
          </div>

          {/* Biblion */}
          <div class="flex items-center gap-2 min-w-0">
            <Tooltip
              placement="top"
              value="Enable/disable knowledge base for storing codebase patterns and architecture."
            >
              <span class="text-12-regular text-text-base">Biblion</span>
            </Tooltip>
            <div class="flex-1" />
            <ToggleSwitch
              checked={state.features?.biblion?.enabled ?? false}
              disabled={state.pending["biblion.enabled"]}
              onChange={(checked) => onToggleChange("biblion.enabled", checked)}
            >
              <span class="sr-only">Biblion</span>
            </ToggleSwitch>
          </div>

          {/* Model Lock */}
          <div class="flex items-center gap-2 min-w-0">
            <Tooltip
              placement="top"
              value="When enabled, lock the AI model to prevent automatic switching between models."
            >
              <span class="text-12-regular text-text-base">Model Lock</span>
            </Tooltip>
            <div class="flex-1" />
            <ToggleSwitch
              checked={state.features?.model_lock?.enabled ?? false}
              disabled={state.pending["model_lock.enabled"]}
              onChange={(checked) => onToggleChange("model_lock.enabled", checked)}
            >
              <span class="sr-only">Model Lock</span>
            </ToggleSwitch>
          </div>

          {/* Review Max Rounds */}
          <div class="flex items-center gap-2 min-w-0">
            <Tooltip
              placement="top"
              value="Maximum number of code review and fix cycles. Each round re-reviews changes and applies fixes automatically."
            >
              <span class="text-12-regular text-text-base">Review Max Rounds</span>
            </Tooltip>
            <div class="flex-1" />
            <div class="flex items-center gap-1 shrink-0">
              <IconButton
                icon="dash"
                size="small"
                variant="ghost"
                aria-label="Decrease"
                disabled={state.pending["review_max_rounds"] || (state.features?.review_max_rounds ?? 7) <= 1}
                onClick={() => stepValue("review_max_rounds", -1, 1, 100)}
              />
              <InlineInput
                type="number"
                width="3rem"
                class="text-12-regular text-text-base text-center"
                value={state.features?.review_max_rounds ?? 7}
                disabled={state.pending["review_max_rounds"]}
                onChange={(e) => onNumberChange("review_max_rounds", e.currentTarget.value)}
              />
              <IconButton
                icon="plus-small"
                size="small"
                variant="ghost"
                aria-label="Increase"
                disabled={state.pending["review_max_rounds"] || (state.features?.review_max_rounds ?? 7) >= 100}
                onClick={() => stepValue("review_max_rounds", 1, 1, 100)}
              />
            </div>
          </div>

          {/* Explore Max Instances */}
          <div class="flex items-center gap-2 min-w-0">
            <Tooltip
              placement="top"
              value="Maximum number of parallel explorer agents. Higher values explore faster but use more resources."
            >
              <span class="text-12-regular text-text-base">Explore Max Instances</span>
            </Tooltip>
            <div class="flex-1" />
            <div class="flex items-center gap-1 shrink-0">
              <IconButton
                icon="dash"
                size="small"
                variant="ghost"
                aria-label="Decrease"
                disabled={state.pending["explore_max_instances"] || (state.features?.explore_max_instances ?? 3) <= 1}
                onClick={() => stepValue("explore_max_instances", -1, 1, 20)}
              />
              <InlineInput
                type="number"
                width="3rem"
                class="text-12-regular text-text-base text-center"
                value={state.features?.explore_max_instances ?? 3}
                disabled={state.pending["explore_max_instances"]}
                onChange={(e) => onNumberChange("explore_max_instances", e.currentTarget.value)}
              />
              <IconButton
                icon="plus-small"
                size="small"
                variant="ghost"
                aria-label="Increase"
                disabled={state.pending["explore_max_instances"] || (state.features?.explore_max_instances ?? 3) >= 20}
                onClick={() => stepValue("explore_max_instances", 1, 1, 20)}
              />
            </div>
          </div>

          {/* Compaction Threshold */}
          <div class="flex items-center gap-2 min-w-0">
            <Tooltip
              placement="top"
              value="Memory compaction threshold (0-1). Controls when old entries are removed to keep memory efficient."
            >
              <span class="text-12-regular text-text-base">Compaction Threshold</span>
            </Tooltip>
            <div class="flex-1" />
            <div class="flex items-center gap-1 shrink-0">
              <InlineInput
                type="number"
                step="0.1"
                min="0"
                max="1"
                width="3.5rem"
                class="text-12-regular text-text-base text-center"
                value={state.features?.compaction_threshold ?? 0.7}
                disabled={state.pending["compaction_threshold"]}
                onChange={(e) => onNumberChange("compaction_threshold", e.currentTarget.value)}
              />
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
