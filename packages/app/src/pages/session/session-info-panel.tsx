import { Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useBridge } from "@/context/bridge"
import { useGlobalSDK } from "@/context/global-sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import { useParams } from "@solidjs/router"
import { DialogBecomeFriend } from "./dialog-become-friend"

function fmt(n: number) {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}

export default function SessionInfoPanel() {
  const sdk = useSDK()
  const sync = useSync()
  const params = useParams()

  const memory = () => sync.data.memory_status
  const biblion = () => sync.data.biblion_status
  const indexer = () => sync.data.indexer_status
  const todos = () => (params.id ? (sync.data.todo[params.id] ?? []) : [])

  const [deleting, setDeleting] = createStore({ mem: false, bib: false })

  const bridge = useBridge()
  const globalSDK = useGlobalSDK()
  const [bridgeLoading, setBridgeLoading] = createStore({ master: false, leave: false })
  const isMaster = () => bridge.role === "master"
  const isFriend = () => bridge.role === "friend"
  const dialog = useDialog()

  async function becomeMaster() {
    const id = params.id
    if (!id) return
    const dir = sync.data.path.directory
    if (!dir) return
    const title = dir.split("/").filter(Boolean).at(-1) ?? dir
    setBridgeLoading("master", true)
    try {
      const res = await fetch(`${globalSDK.url}/bridge/set-master`, {
        method: "POST",
        headers: {
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
      showToast({ variant: "success", title: "Bridge master mode enabled" })
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
    const dir = sync.data.path.directory
    if (!dir) return
    setBridgeLoading("leave", true)
    try {
      const res = await fetch(`${globalSDK.url}/bridge/leave`, {
        method: "POST",
        headers: { "x-opencode-directory": dir },
      })
      if (!res.ok) throw new Error(await res.text())
      showToast({ variant: "success", title: "Left bridge" })
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
    const dir = sync.data.path.directory
    if (!id || !dir) return
    dialog.show(() => <DialogBecomeFriend sessionID={id} directory={dir} />)
  }

  async function deleteMem() {
    setDeleting("mem", true)
    await sdk.client.memory.delete().catch(() => {})
    setDeleting("mem", false)
  }

  async function clearBib() {
    setDeleting("bib", true)
    await sdk.client.biblion.clear().catch(() => {})
    setDeleting("bib", false)
  }

  return (
    <div class="h-full flex flex-col overflow-hidden">
      <div class="flex-1 min-h-0 overflow-y-auto">
        {/* Memory */}
        <div class="px-4 py-3 border-b border-border-weak-base">
          <div class="flex items-center gap-2 min-w-0">
            <Icon name="brain" size="small" class="text-icon-base shrink-0" />
            <span class="text-12-medium text-text-strong flex-1 min-w-0">Memory</span>
            <Show when={memory()?.type === "ready" ? memory() : undefined}>
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
            <Show when={memory()?.type === "disabled"}>
              <span class="text-12-regular text-text-weak shrink-0">Disabled</span>
            </Show>
            <Show when={!memory()}>
              <span class="text-12-regular text-text-weaker">—</span>
            </Show>
          </div>
        </div>

        {/* Indexer */}
        <div class="px-4 py-3 border-b border-border-weak-base">
          <div class="flex items-center gap-2 min-w-0">
            <Icon name="magnifying-glass" size="small" class="text-icon-base shrink-0" />
            <span class="text-12-medium text-text-strong flex-1 min-w-0">Indexer</span>
            <Show when={indexer()} fallback={<span class="text-12-regular text-text-weaker">—</span>}>
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
            <span class="text-12-medium text-text-strong flex-1 min-w-0">Biblion</span>
            <Show when={biblion()?.type === "ready" ? biblion() : undefined}>
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
            <Show when={biblion()?.type === "disabled"}>
              <span class="text-12-regular text-text-weak shrink-0">Disabled</span>
            </Show>
            <Show when={!biblion()}>
              <span class="text-12-regular text-text-weaker">—</span>
            </Show>
          </div>
        </div>

        {/* Bridge */}
        <div class="px-4 py-3 border-b border-border-weak-base">
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <Icon name="link" size="small" class="text-icon-base shrink-0" />
              <span class="text-12-medium text-text-strong flex-1 min-w-0">Bridge</span>
              <Show when={bridge.role}>
                <span class="text-12-regular text-text-weak shrink-0 capitalize">{bridge.role}</span>
              </Show>
              <Show when={!bridge.role}>
                <span class="text-12-regular text-text-weaker shrink-0">—</span>
              </Show>
            </div>
            <Show when={isMaster() && params.id}>
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-11-regular text-text-weaker font-mono truncate flex-1 min-w-0 select-all">
                  {params.id}
                </span>
                <IconButton
                  icon="copy"
                  size="small"
                  variant="ghost"
                  aria-label="Copy session ID"
                  onClick={() => {
                    navigator.clipboard.writeText(params.id!)
                    showToast({ variant: "success", title: "Session ID copied" })
                  }}
                />
              </div>
            </Show>
            <div class="flex gap-2">
              <Show when={!isMaster() && !isFriend() && !bridge.role}>
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
              <Show when={bridge.role || isMaster() || isFriend()}>
                <Button size="small" variant="ghost" disabled={bridgeLoading.leave} onClick={leaveBridge}>
                  Leave
                </Button>
              </Show>
            </div>
          </div>
        </div>

        {/* Tasks */}
        <Show when={todos().length > 0}>
          <div class="border-b border-border-weak-base">
            <div class="px-4 pt-3 pb-1 flex items-center gap-2">
              <Icon name="checklist" size="small" class="text-icon-base shrink-0" />
              <span class="text-12-medium text-text-strong">Tasks</span>
            </div>
            <SessionTodoDock todos={todos()} title="Tasks" collapseLabel="Collapse tasks" expandLabel="Expand tasks" />
          </div>
        </Show>
      </div>
    </div>
  )
}
