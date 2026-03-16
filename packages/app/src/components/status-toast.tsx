import { createEffect, For, on, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { useSync } from "@/context/sync"
import { useGlobalSDK } from "@/context/global-sdk"
import "./status-toast.css"

type Notification = {
  id: number
  title: string
  description?: string
}

export function StatusToastRegion() {
  const sync = useSync()
  const globalSDK = useGlobalSDK()
  const [notifications, setNotifications] = createStore<Notification[]>([])
  let nextId = 0
  const timeouts = new Map<number, ReturnType<typeof setTimeout>>()

  const removeNotification = (id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    const timeout = timeouts.get(id)
    if (timeout) {
      clearTimeout(timeout)
      timeouts.delete(id)
    }
  }

  const addNotification = (title: string, description?: string, duration = 4000) => {
    const id = ++nextId
    setNotifications((prev) => [...prev, { id, title, description }])
    const timeout = setTimeout(() => removeNotification(id), duration)
    timeouts.set(id, timeout)
  }

  const unsub = globalSDK.event.listen((e) => {
    if (e.name !== sync.data.path.directory) return
    if (e.details.type !== "tui.toast.show") return
    const { title, message, duration } = e.details.properties as {
      title?: string
      message: string
      variant: string
      duration?: number
    }
    addNotification(title || message, title ? message : undefined, duration)
  })

  createEffect(
    on(
      () => sync.data.indexer_status,
      (status, prev) => {
        if (!status) return
        if (status.type === prev?.type) return
        if (status.type === "indexing" && prev?.type !== "indexing") {
          addNotification("◈ Indexer — indexing…")
        } else if (status.type === "complete" && prev?.type !== "complete") {
          addNotification("◈ Indexer — complete")
        } else if (status.type === "disabled" && status.reason && status.reason !== "not_configured") {
          addNotification("◈ Indexer — disabled", status.message ?? status.reason)
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => sync.data.memory_status,
      (status, prev) => {
        if (!status) return
        if (status.type === prev?.type) return
        if (status.type === "ready" && prev?.type !== "ready") {
          addNotification(`◈ Memory — ${status.entry_count} entries`)
        } else if (status.type === "disabled" && status.reason && status.reason !== "not_configured") {
          addNotification("◈ Memory — disabled", status.message ?? status.reason)
        }
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => sync.data.biblion_status,
      (status, prev) => {
        if (!status) return
        if (status.type === prev?.type) return
        if (status.type === "ready" && prev?.type !== "ready") {
          addNotification(`◈ Biblion — ${status.entry_count} entries`)
        } else if (status.type === "disabled" && status.reason && status.reason !== "not_configured") {
          addNotification("◈ Biblion — disabled", status.message ?? status.reason)
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    unsub()
    timeouts.forEach((timeout) => clearTimeout(timeout))
    timeouts.clear()
  })

  return (
    <Portal>
      <div class="status-toast-region" aria-live="polite">
        <For each={notifications}>
          {(notification) => (
            <div class="status-toast">
              <div class="status-toast-content">
                <span class="status-toast-title">{notification.title}</span>
                {notification.description && <span class="status-toast-description">{notification.description}</span>}
              </div>
              <button
                type="button"
                class="status-toast-close"
                onClick={() => removeNotification(notification.id)}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </Portal>
  )
}
