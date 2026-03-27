import { createSignal, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
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

        {/* Subagent Models */}
        <SubagentModelsPanel />
      </div>
    </div>
  )
}
