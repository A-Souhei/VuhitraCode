import { Message } from "../session/message"
import { PassOver } from "../tool/pass-over"
import { Identifier } from "../id/id"
import z from "zod"

export const WorkOutput = z.object({
  work_id: z.string(),
  agent_name: z.string(),
  status: z.enum(["completed", "pending", "failed"]),
  files_modified: z.string().array(),
  messages: z.number(),
  tool_results: z.unknown().array().optional(),
  summary: z.string(),
  artifacts: z.record(z.string(), z.unknown()).optional(),
})

export type WorkOutput = z.infer<typeof WorkOutput>

export const PassOverMetadata = z.object({
  pass_over_id: z.string(),
  session_id: z.string(),
  originating_agent_id: z.string(),
  subagent_id: z.string(),
  reason: z.string(),
  created_at: z.number(),
  status: z.enum(["pending", "confirmed", "completed", "failed"]),
  chain_depth: z.number().int().min(0),
})

export type PassOverMetadata = z.infer<typeof PassOverMetadata>

export const PassOverContext = z.object({
  work_output: WorkOutput,
  metadata: PassOverMetadata,
})

export type PassOverContext = z.infer<typeof PassOverContext>

const MODIFIED_FILES_PATTERN = /\[Modified files:\s*([^\]]+)\]/
const TOOL_RESULTS_PATTERN = /\[Tool results:\s*([^\]]+)\]/

// Fallback patterns for common formats
const MODIFIED_FILES_PATTERNS = [
  /\[Modified files:\s*([^\]]+)\]/, // Primary format
  /Modified files?:\s*(.+?)(?:\n|$)/i, // Markdown/text format
  /changes?:\s*(.+?)(?:\n|$)/i, // Alternative format
]

// Path validation: alphanumeric, dots, slashes, hyphens, underscores
const PATH_PATTERN = /^[a-zA-Z0-9._\-\/]+$/

function isValidPath(path: string): boolean {
  if (!path || path.length === 0) return false
  return PATH_PATTERN.test(path)
}

function extractModifiedFiles(text: string): string[] {
  let match = null

  // Try each pattern
  for (const pattern of MODIFIED_FILES_PATTERNS) {
    match = text.match(pattern)
    if (match) break
  }

  if (!match) return []

  // Split by comma, semicolon, or newline and validate each path
  const rawFiles = match[1]
    .split(/[,;]|\n/)
    .map((f) => f.trim())
    .filter(Boolean)

  // Filter to only valid paths
  return rawFiles.filter(isValidPath)
}

function extractAgentName(text: string): string {
  // Multiple pattern matching strategies for different output formats
  const patterns = [
    /agent:\s*([a-zA-Z0-9_-]+)/i, // "Agent: alice"
    /by\s+agent\s+([a-zA-Z0-9_-]+)/i, // "by agent alice"
    /from\s+agent\s+([a-zA-Z0-9_-]+)/i, // "from agent alice"
    /agent\s+([a-zA-Z0-9_-]+)/i, // "agent alice"
    /\[agent:\s*([a-zA-Z0-9_-]+)\]/i, // "[agent: alice]"
    /originating.*?agent[:\s]+([a-zA-Z0-9_-]+)/i, // "originating agent: alice"
    /subagent[:\s]+([a-zA-Z0-9_-]+)/i, // "subagent: alice"
    /working\s+(?:as|with)\s+([a-zA-Z0-9_-]+)/i, // "working as alice"
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }

  return "unknown"
}

function extractSummary(messages: Array<{ role: string; content: string | undefined }>, window: number): string {
  const assistantMessages = messages
    .filter((m) => m.role === "assistant" && m.content)
    .slice(-window)
    .map((m) => m.content)
    .filter(Boolean)

  if (assistantMessages.length === 0) return "No summary available"

  const combined = assistantMessages.join("\n")
  const truncated = combined.length > 500 ? combined.slice(0, 497) + "..." : combined
  return truncated
}

export function extractWorkOutput(messages: Message.Info[]): WorkOutput {
  const window = Math.min(3, messages.length)
  const recent = messages.slice(-window)

  let filesModified: string[] = []
  let agentName = "unknown"
  let allContent = ""

  for (const msg of recent) {
    if (msg.role === "assistant") {
      const content = msg.parts
        .filter((p): p is Message.TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n")

      allContent += content + "\n"
      const extracted = extractModifiedFiles(content)
      if (extracted.length > 0) {
        filesModified = Array.from(new Set([...filesModified, ...extracted]))
      }

      if (agentName === "unknown") {
        agentName = extractAgentName(content)
      }
    }
  }

  const toolResults = recent
    .flatMap((msg) => msg.parts)
    .filter((p): p is Message.ToolInvocationPart => p.type === "tool-invocation")
    .map((p) => ({
      toolName: p.toolInvocation.toolName,
      state: p.toolInvocation.state,
      ...(p.toolInvocation.state === "result" && {
        result: (p.toolInvocation as Message.ToolResult).result,
      }),
    }))

  const summary = extractSummary(
    messages.map((m) => ({
      role: m.role,
      content: m.parts
        .filter((p): p is Message.TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n"),
    })),
    window,
  )

  return {
    work_id: Identifier.ascending("tool"),
    agent_name: agentName,
    status: "completed",
    files_modified: filesModified,
    messages: messages.length,
    tool_results: toolResults.length > 0 ? toolResults : undefined,
    summary,
  }
}

interface BuildPassOverContextParams {
  work_output: WorkOutput
  session_id: string
  originating_agent: string
  target_agent: string
  reason: string
  chain_depth?: number
}

export function buildPassOverContext(params: BuildPassOverContextParams): PassOverContext {
  const metadata: PassOverMetadata = {
    pass_over_id: Identifier.ascending("tool"),
    session_id: params.session_id,
    originating_agent_id: params.originating_agent,
    subagent_id: params.target_agent,
    reason: params.reason,
    created_at: Date.now(),
    status: "pending",
    chain_depth: params.chain_depth ?? 1,
  }

  return {
    work_output: params.work_output,
    metadata,
  }
}
