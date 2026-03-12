import z from "zod"
import { Tool } from "./tool"
import { Bridge } from "../bridge"

export const PingBridgeSessionTool = Tool.define("ping_bridge_session", {
  description: `Check if a friend bridge node is still alive and reachable.
Call this tool periodically while waiting for a friend node to finish a long task.
If it returns alive: false, stop waiting and return failure immediately.

Parameters:
- nodeID: The bridge node ID of the friend to check (from the [bridge_node: <nodeID>] prefix)

Returns:
- { alive: true } if the node is found in the active node list with a fresh heartbeat (within 60s)
- { alive: false, reason: string } if the node is not found, heartbeat is stale, or bridge connection failed`,
  parameters: z.object({
    nodeID: z.string().min(1).describe("The bridge node ID to check"),
  }),
  async execute(params, ctx) {
    const id = Bridge.bridgeID()
    if (!id) {
      return {
        title: `Cannot ping node ${params.nodeID}`,
        output: JSON.stringify({ alive: false, reason: "Bridge not connected" }),
        metadata: { alive: false },
      }
    }

    let onAbort!: () => void
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Aborted"))
      ctx.abort.addEventListener("abort", onAbort, { once: true })
    })
    let nodes: Bridge.NodeInfo[]
    try {
      nodes = await Promise.race([Bridge.getNodes(id), aborted])
    } catch {
      const reason = ctx.abort.aborted ? "Aborted" : "Bridge connection error"
      return {
        title: `Cannot ping node ${params.nodeID}`,
        output: JSON.stringify({ alive: false, reason }),
        metadata: { alive: false },
      }
    } finally {
      ctx.abort.removeEventListener("abort", onAbort)
    }

    const node = nodes.find((n) => n.nodeID === params.nodeID)
    if (node) {
      return {
        title: `Node ${params.nodeID} is alive`,
        output: JSON.stringify({ alive: true }),
        metadata: { alive: true },
      }
    }

    return {
      title: `Node ${params.nodeID} not found`,
      output: JSON.stringify({
        alive: false,
        reason: `Node ${params.nodeID} not found in active nodes (heartbeat may be stale or node has disconnected)`,
      }),
      metadata: { alive: false },
    }
  },
})
