import { createContext, useContext, createSignal } from "solid-js"
import type { JSX } from "solid-js"

export type BridgeState = {
  role: "master" | "friend" | null
  bridgeID: string | null
  inputLocked: boolean
  nodeCount: number
}

const defaults: BridgeState = { role: null, bridgeID: null, inputLocked: false, nodeCount: 0 }

const BridgeContext = createContext<{
  state: BridgeState
  setRole: (role: "master" | "friend" | null) => void
  setBridgeID: (id: string | null) => void
  setInputLocked: (locked: boolean) => void
  setNodeCount: (n: number) => void
}>({
  state: defaults,
  setRole: () => {},
  setBridgeID: () => {},
  setInputLocked: () => {},
  setNodeCount: () => {},
})

export function BridgeProvider(props: { children: JSX.Element }) {
  const [role, setRole] = createSignal<"master" | "friend" | null>(null)
  const [bridgeID, setBridgeID] = createSignal<string | null>(null)
  const [inputLocked, setInputLocked] = createSignal(false)
  const [nodeCount, setNodeCount] = createSignal(0)

  return (
    <BridgeContext.Provider
      value={{
        get state() {
          return {
            role: role(),
            bridgeID: bridgeID(),
            inputLocked: inputLocked(),
            nodeCount: nodeCount(),
          }
        },
        setRole,
        setBridgeID,
        setInputLocked,
        setNodeCount,
      }}
    >
      {props.children}
    </BridgeContext.Provider>
  )
}

export function useBridge() {
  return useContext(BridgeContext)
}
