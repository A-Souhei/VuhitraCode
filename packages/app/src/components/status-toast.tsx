import { createEffect, For, on, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { useSync } from "@/context/sync"
import "./status-toast.css"

type Notification = {
  id: number
  title: string
  description?: string
  createdAt: number
}

export function StatusToastRegion() {
  const sync = useSync()
  const [notifications, setNotifications] = createStore<Notification[]>([])
  let nextId = 0
  const timeouts = new Map<number, ReturnType<typeof setTimeout>>()

  const addNotification = (title: string, description?: string) => {
    const id = ++nextId
    setNotifications(notifications.length, { id, title, description, createdAt: Date.now() })
    const timeout = setTimeout(() => removeNotification(id), 4000)
    timeouts.set(id, timeout)
  }

  const removeNotification = (id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    const timeout = timeouts.get(id)
    if (timeout) {
      clearTimeout(timeout)
      timeouts.delete(id)
    }
  }

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
    ),
  )

  onCleanup(() => {
    timeouts.forEach((timeout) => clearTimeout(timeout))
    timeouts.clear()
  })

  return (
    <Portal>
      <div class="status-toast-region">
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
