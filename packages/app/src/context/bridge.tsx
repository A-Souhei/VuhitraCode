import { createSimpleContext } from "@opencode-ai/ui/context"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "./global-sdk"

const POLL_MS = 5_000

type Role = "master" | "friend"

type State = {
  role: Role | null
  id: string | null
  sessionID: string | null
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
    async function poll(signal: AbortSignal) {
      if (inflight) return
      inflight = true
      try {
        const dirSegment = window.location.pathname.split("/")[1] ?? ""
        const directory = dirSegment ? decodeURIComponent(dirSegment) : ""
        const headers: Record<string, string> = {}
        if (directory) headers["x-opencode-directory"] = directory
        const res = await fetch(`${sdk.url}/bridge/info`, { signal, headers })
        if (!res.ok) {
          setState({ role: null, id: null, sessionID: null })
          return
        }
        const info = await res.json()
        if (!info) {
          setState({ role: null, id: null, sessionID: null })
          return
        }
        // info is Bridge.Info: { bridgeID, masterID, masterSlug, nodes, limit }
        // nodes is NodeInfo[]: { nodeID, role, sessionID, slug, title, directory, nodeURL, heartbeat, status }
        // The local server reports info for all bridge nodes. We use the master node's presence
        // to expose bridgeID and master sessionID. The role stored here reflects bridge membership.
        // NOTE: role is 'master' if any active node is master; this does not distinguish whether
        // the local node is master vs friend. The server would need to expose the local node's role
        // to make this distinction reliable. This is a known limitation.
        const nodes: Array<{ nodeID: string; role: Role; sessionID: string; status: string }> = info.nodes ?? []
        const active = nodes.filter((n) => n.status !== "inactive")
        const master = active.find((n) => n.role === "master")
        setState({
          role: master ? "master" : active.length ? "friend" : null,
          id: info.bridgeID ?? null,
          sessionID: master?.sessionID ?? null,
        })
      } catch (e) {
        // Silently ignore AbortError from cleanup on unmount
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setState({ role: null, id: null, sessionID: null })
        }
      } finally {
        inflight = false
      }
    }

    onMount(() => {
      const abort = new AbortController()
      void poll(abort.signal)
      const timer = setInterval(() => void poll(abort.signal), POLL_MS)
      onCleanup(() => {
        clearInterval(timer)
        abort.abort()
      })
    })

    return state
  },
})
