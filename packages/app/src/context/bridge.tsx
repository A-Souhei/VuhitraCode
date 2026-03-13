import { createSimpleContext } from "@opencode-ai/ui/context"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "./global-sdk"
import { base64Decode } from "@opencode-ai/util/encode"

const POLL_MS = 5_000

type Role = "master" | "friend"

type State = {
  role: Role | null
  id: string | null
  sessionID: string | null
}

function dirFromPath() {
  const seg = window.location.pathname.split("/")[1] ?? ""
  if (!seg) return ""
  try {
    return base64Decode(decodeURIComponent(seg))
  } catch {
    return ""
  }
}

// Patch history once at module load — dispatch a custom event so all listeners
// can react without needing to be wired into a monkey-patch chain.
const _origPush = history.pushState.bind(history)
history.pushState = (...args: Parameters<typeof history.pushState>) => {
  _origPush(...args)
  window.dispatchEvent(new CustomEvent("opencode-navigate"))
}
const _origReplace = history.replaceState.bind(history)
history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
  _origReplace(...args)
  window.dispatchEvent(new CustomEvent("opencode-navigate"))
}

export const { use: useBridge, provider: BridgeProvider } = createSimpleContext({
  name: "Bridge",
  init: () => {
    const sdk = useGlobalSDK()
    const [state, setState] = createStore<State>({
      role: null,
      id: null,
      sessionID: null,
    })

    let inflight = false
    let mounted = true
    let lastDir = ""
    let pollAbort: AbortController | null = null

    async function poll() {
      if (inflight || !mounted) return
      inflight = true
      const myAbort = new AbortController()
      pollAbort = myAbort
      try {
        const directory = dirFromPath()
        const headers: Record<string, string> = {}
        if (directory) headers["x-opencode-directory"] = directory
        const res = await fetch(`${sdk.url}/bridge/info`, { signal: myAbort.signal, headers })
        if (!mounted) return
        if (!res.ok) return // keep last-known state on error
        const info = await res.json()
        if (!mounted || !info) return
        const nodes: Array<{ nodeID: string; role: Role; sessionID: string; status: string }> = info.nodes ?? []
        const active = nodes.filter((n) => n.status !== "inactive")
        const master = active.find((n) => n.role === "master")
        setState({
          role: (info.selfRole as Role | null) ?? null,
          id: info.bridgeID ?? null,
          sessionID: master?.sessionID ?? null,
        })
      } catch {
        // abort or network error — keep last-known state
      } finally {
        if (pollAbort === myAbort) {
          inflight = false
          pollAbort = null
        }
      }
    }

    onMount(() => {
      lastDir = dirFromPath()
      void poll()

      function onNavigate() {
        const dir = dirFromPath()
        if (dir === lastDir) return
        lastDir = dir
        pollAbort?.abort()
        inflight = false
        setState({ role: null, id: null, sessionID: null })
        void poll()
      }

      window.addEventListener("popstate", onNavigate)
      window.addEventListener("opencode-navigate", onNavigate)

      const timer = setInterval(() => void poll(), POLL_MS)

      onCleanup(() => {
        mounted = false
        clearInterval(timer)
        pollAbort?.abort()
        window.removeEventListener("popstate", onNavigate)
        window.removeEventListener("opencode-navigate", onNavigate)
      })
    })

    return { state, set: setState }
  },
})
