import { Tool } from "./tool"
import z from "zod"
import { Agent } from "../agent/agent"
import { PermissionNext } from "@/permission/next"
import { Identifier } from "../id/id"

const DESCRIPTION = `Pass work output to another agent for specialized handling (e.g., alice→audit for review, then back to sentinel).

Use this tool to delegate work to another agent when you need specialized review, verification, or handling that goes beyond your current agent's capabilities.`

const MAX_CHAIN_DEPTH = 3

export namespace PassOver {
  export const WorkOutput = z.object({
    files_modified: z.string().array().describe("List of file paths that were modified or created"),
    summary: z.string().describe("Brief summary of work completed"),
    messages: z.unknown().array().optional().describe("Previous tool results or messages"),
    tool_results: z.unknown().array().optional().describe("Structured tool execution results"),
  })

  export type WorkOutput = z.infer<typeof WorkOutput>

  export const PassOverMetadata = z.object({
    chain_depth: z.number().int().min(0).max(MAX_CHAIN_DEPTH),
    previous_pass_over_id: z.string().optional(),
    originating_agent_id: z.string(),
    timestamp: z.number(),
  })

  export type PassOverMetadata = z.infer<typeof PassOverMetadata>

  export const PassOverContext = z.object({
    context_id: z.string(),
    work_output: WorkOutput,
    metadata: PassOverMetadata,
    reason: z.string(),
  })

  export type PassOverContext = z.infer<typeof PassOverContext>

  export const Parameters = z.object({
    subagent: z.string().describe("Target agent name (must exist in available agents)"),
    reason: z.string().describe("Why passing over (e.g., 'code_review', 'verify_implementation', 'fix_issues')"),
    work_output: WorkOutput,
    auto_confirm: z.boolean().optional().describe("Override user preference for this pass over"),
    timeout_ms: z.number().optional().describe("Override default timeout in milliseconds"),
  })

  export type Parameters = z.infer<typeof Parameters>

  export const Response = z.object({
    status: z.enum(["confirmed", "pending"]),
    target_agent: z.string(),
    reason: z.string(),
    context_id: z.string(),
  })

  export type Response = z.infer<typeof Response>
}

interface ToolMetadata {
  status: "confirmed" | "pending"
  target_agent: string
  reason: string
  context_id: string
  pass_over_context?: PassOver.PassOverContext
}

export const PassOverTool = Tool.define("pass_over", async () => {
  return {
    description: DESCRIPTION,
    parameters: PassOver.Parameters,
    async execute(params: z.infer<typeof PassOver.Parameters>, ctx) {
      const agents = await Agent.list()
      const target = agents.find((a) => a.name === params.subagent)

      if (!target) {
        throw new Error(`Agent '${params.subagent}' does not exist`)
      }

      const caller = agents.find((a) => a.name === ctx.agent)
      if (!caller) {
        throw new Error("Calling agent not found in agent list")
      }

      // Validate that caller has permission to delegate to target
      const allowed = PermissionNext.evaluate("pass_over", target.name, caller.permission)

      if (allowed.action === "deny") {
        throw new Error(`Not authorized to pass to agent '${params.subagent}'`)
      }

      // Validate work_output structure
      if (
        !params.work_output ||
        !Array.isArray(params.work_output.files_modified) ||
        typeof params.work_output.summary !== "string"
      ) {
        throw new Error("Missing required fields in work_output")
      }

      // Calculate chain depth from context
      const depth = ctx.extra?.pass_over_depth ?? 0

      if (depth >= MAX_CHAIN_DEPTH) {
        throw new Error(`Pass over chain depth (${MAX_CHAIN_DEPTH}) exceeded. Cannot pass to '${params.subagent}'`)
      }

      // Check for cycles (same agent twice in a row)
      const prev = ctx.extra?.previous_pass_over_agent
      if (prev === params.subagent) {
        throw new Error(`Cannot pass back to same agent '${params.subagent}' twice in succession. Chain would cycle.`)
      }

      const contextId = Identifier.ascending("tool")
      const meta: PassOver.PassOverMetadata = {
        chain_depth: depth + 1,
        previous_pass_over_id: ctx.extra?.pass_over_id,
        originating_agent_id: caller.name,
        timestamp: Date.now(),
      }

      const passContext: PassOver.PassOverContext = {
        context_id: contextId,
        work_output: params.work_output,
        metadata: meta,
        reason: params.reason,
      }

      // Emit request tag for manual confirmation unless auto_confirm is true
      const shouldAutoConfirm = params.auto_confirm ?? false

      if (!shouldAutoConfirm) {
        const toolMeta: ToolMetadata = {
          status: "pending",
          target_agent: params.subagent,
          reason: params.reason,
          context_id: contextId,
        }

        ctx.metadata({
          title: `Pass over to ${params.subagent}`,
          metadata: toolMeta,
        })

        return {
          title: "Pass over request",
          metadata: toolMeta,
          output: `[pass_over_request: ${params.subagent}]\n\nReason: ${params.reason}\nContext ID: ${contextId}\n\nWaiting for user confirmation to pass work to agent '${params.subagent}'...`,
        }
      }

      // Auto-confirm: directly execute the pass over
      const toolMeta: ToolMetadata = {
        status: "confirmed",
        target_agent: params.subagent,
        reason: params.reason,
        context_id: contextId,
        pass_over_context: passContext,
      }

      return {
        title: "Pass over confirmed",
        metadata: toolMeta,
        output: `Passing work to agent '${params.subagent}' for ${params.reason}...\n\nContext ID: ${contextId}`,
      }
    },
  }
})
