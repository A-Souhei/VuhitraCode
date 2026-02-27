import { PassOver } from "../tool/pass-over"

export interface PassOverState {
  pass_over_chain: Array<{
    agent_id: string
    timestamp: number
    reason: string
  }>
  origin_agent: string
  current_agent: string
  can_return: boolean
  next_return_target: string | null
}

export function detectCycle(chain: PassOverState["pass_over_chain"]): boolean {
  if (chain.length < 2) return false

  const last = chain[chain.length - 1]
  const secondLast = chain[chain.length - 2]

  return last.agent_id === secondLast.agent_id
}

export function isChainDepthExceeded(chain: PassOverState["pass_over_chain"], maxDepth: number): boolean {
  return chain.length > maxDepth
}

export class ReturnController {
  private chain: PassOverState["pass_over_chain"]
  private origin: string
  private current: string
  private maxDepth: number

  constructor(originAgent: string, maxChainDepth: number = 3) {
    this.origin = originAgent
    this.current = originAgent
    this.maxDepth = maxChainDepth
    this.chain = [
      {
        agent_id: originAgent,
        timestamp: Date.now(),
        reason: "origin",
      },
    ]
  }

  addToChain(agentId: string, reason: string): void {
    // Reject immediate cycle: current agent trying to pass to itself
    if (agentId === this.current) {
      throw new Error(`Cannot pass to same agent '${agentId}' in succession. Immediate cycle detected.`)
    }

    // Check if adding this agent would exceed max depth
    if (this.chain.length >= this.maxDepth) {
      throw new Error(
        `Pass over chain depth (${this.maxDepth}) exceeded. Cannot add agent '${agentId}' to chain of length ${this.chain.length}.`,
      )
    }

    // Check for cycle (same agent appears twice in last 2 positions)
    if (this.chain.length >= 2) {
      const last = this.chain[this.chain.length - 1]
      if (last.agent_id === agentId) {
        throw new Error(
          `Cycle detected: agent '${agentId}' appears consecutively in chain. Cannot pass to same agent twice in a row.`,
        )
      }
    }

    this.chain.push({
      agent_id: agentId,
      timestamp: Date.now(),
      reason,
    })

    this.current = agentId
  }

  canReturn(): boolean {
    // Can return if we haven't exceeded max depth and there's a valid previous agent
    if (this.current === this.origin) {
      return false
    }

    if (this.chain.length < 2) {
      return false
    }

    // Can return if returning won't exceed chain depth
    return this.chain.length < this.maxDepth
  }

  getReturnTarget(): string | null {
    if (!this.canReturn()) {
      return null
    }

    // Explicit bounds check: need at least 2 elements to have a previous agent
    // Element at index 0 is origin, element at index length-1 is current
    // We return the agent at index (length - 2), which is the previous agent in chain
    if (this.chain.length < 2) {
      return null
    }

    const previousAgent = this.chain[this.chain.length - 2]
    return previousAgent?.agent_id ?? null
  }

  detectCycle(): boolean {
    return detectCycle(this.chain)
  }

  getChainDepth(): number {
    return this.chain.length
  }

  getState(): PassOverState {
    const target = this.getReturnTarget()

    return {
      pass_over_chain: this.chain,
      origin_agent: this.origin,
      current_agent: this.current,
      can_return: this.canReturn(),
      next_return_target: target ?? null,
    }
  }

  asPassOverMetadata(): PassOver.PassOverMetadata {
    return {
      chain_depth: this.chain.length - 1, // Exclude origin in depth count
      originating_agent_id: this.origin,
      timestamp: Date.now(),
    }
  }

  static fromState(state: PassOverState, maxChainDepth: number = 3): ReturnController {
    const controller = new ReturnController(state.origin_agent, maxChainDepth)
    controller.chain = state.pass_over_chain
    controller.current = state.current_agent
    return controller
  }
}
