import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { pathToFileURL, fileURLToPath } from "url"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { VuHitraSettings } from "@/project/vuhitra-settings"
import { Profiles } from "@/project/profiles"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { Bridge } from "../bridge"

// Matches file paths with data extensions — used by data-explore auto-injection.
// Requires at least one directory separator so bare filenames are not matched.
const DATA_PATH_REGEX =
  /(?<![`@\w])((?:\/|~\/|\.\/|\.\.\/|[a-zA-Z0-9_.-]+\/)[a-zA-Z0-9_.\/-]+\.(?:csv|tsv|json|jsonl|ndjson|parquet|xlsx|xls|txt|feather|arrow))(?![\w/])/gi

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents

  const description = DESCRIPTION.replace(
    "{agents}",
    accessibleAgents
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      // Permission gate — must run for ALL paths, including bridge dispatch
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const bridgeMatch = params.prompt.match(/^\[bridge_node:\s*([^\]]+)\]\s*/)
      if (bridgeMatch && Bridge.isActive() && Bridge.isMaster()) {
        const nodeID = bridgeMatch[1].trim()
        const prompt = params.prompt.slice(bridgeMatch[0].length)
        const node = Bridge.info()?.nodes.find((n) => n.nodeID === nodeID || n.slug === nodeID)
        if (node?.nodeURL) {
          const parsedURL = new URL(node.nodeURL)
          if (!["http:", "https:"].includes(parsedURL.protocol))
            return {
              title: params.description,
              metadata: {} as { [key: string]: any },
              output: `Error: invalid nodeURL scheme for bridge node ${node.nodeID}`,
            }
          const bid = Bridge.bridgeID()
          if (!bid)
            return {
              title: params.description,
              metadata: {} as { [key: string]: any },
              output: `Error: bridge session ended before task could be dispatched`,
            }
          const taskID = crypto.randomUUID()
          const dir = node.directory.replace(/[\r\n]/g, "")
          const res = await fetch(`${node.nodeURL}/bridge/dispatch-task`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-bridge-id": bid, "x-opencode-directory": dir },
            body: JSON.stringify({ taskID, prompt, description: params.description }),
            signal: AbortSignal.any([ctx.abort, AbortSignal.timeout(10_000)]),
          }).catch(() => null)
          if (res?.ok) {
            const data = await res.json().catch(() => null)
            if (!data?.success || typeof data.sessionID !== "string") {
              return {
                title: params.description,
                metadata: {} as { [key: string]: any },
                output: `Error: bridge node ${node.nodeID} rejected task dispatch`,
              }
            }
            const result = await Bridge.pollTaskResult(taskID, node.nodeID, ctx.abort)
            const output = [
              `task_id: ${taskID} (bridge node: ${node.nodeID}, friend session: ${data.sessionID})`,
              "",
              "<task_result>",
              result ?? "Friend task timed out or was aborted before returning a result.",
              "</task_result>",
            ].join("\n")
            return {
              title: params.description,
              metadata: { nodeID: node.nodeID, taskID, sessionID: data.sessionID } as { [key: string]: any },
              output,
            }
          } else if (res) {
            return {
              title: params.description,
              metadata: {} as { [key: string]: any },
              output: `Error: bridge node ${node.nodeID} returned HTTP ${res.status} for task dispatch`,
            }
          }
        }
      }

      const config = await Config.get()

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(params.task_id).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: [
            {
              permission: "todowrite",
              pattern: "*",
              action: "deny",
            },
            {
              permission: "todoread",
              pattern: "*",
              action: "deny",
            },
            ...(hasTaskPermission
              ? []
              : [
                  {
                    permission: "task" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(config.experimental?.primary_tools?.map((t) => ({
              pattern: "*",
              action: "allow" as const,
              permission: t,
            })) ?? []),
          ],
        })
      })
      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const parentSession = await Session.get(ctx.sessionID).catch((err) => {
        Log.Default.warn("task: could not read parent session for profile resolution", {
          sessionID: ctx.sessionID,
          err,
        })
        return undefined
      })
      const sessionProfile = parentSession?.profile
      const vuHitraModel = sessionProfile
        ? await Profiles.subagentModel(sessionProfile, params.subagent_type, Instance.directory)
        : await VuHitraSettings.subagentModel(params.subagent_type, Instance.directory)

      // Validate the project-local model override against the user's configured providers
      // before applying it, so a malicious .vuhitra/settings.json cannot redirect to an
      // attacker-controlled provider.
      const resolvedVuHitraModel = await (async () => {
        if (!vuHitraModel?.modelID || !vuHitraModel?.providerID) return undefined
        const validated = await Provider.getModel(vuHitraModel.providerID, vuHitraModel.modelID).catch(() => undefined)
        if (!validated) {
          Log.Default.warn("task: subagent model override not found, falling back to default", {
            subagent: params.subagent_type,
            providerID: vuHitraModel.providerID,
            modelID: vuHitraModel.modelID,
          })
          return undefined
        }
        return { modelID: vuHitraModel.modelID, providerID: vuHitraModel.providerID }
      })()

      const model = resolvedVuHitraModel ??
        agent.model ?? {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        }

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
      })

      const messageID = Identifier.ascending("message")

      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      // data-explore / secret / analyse: embed file content directly in the prompt
      // so the model can analyze without tool calls. Small models (7B) don't
      // reliably issue tool calls — pre-injecting mirrors OpenWebUI's file upload approach.
      // secret agent gets faked content (read.ts applies shouldFake); data-explore gets real content.
      if (agent.name === "data-explore" || agent.name === "secret" || agent.name === "analyse") {
        const alreadyInjected = new Set(
          promptParts
            .filter((p): p is Extract<typeof p, { type: "file" }> => p.type === "file" && p.url.startsWith("file:"))
            .map((p) => fileURLToPath(p.url)),
        )
        const seen = new Set<string>()
        for (const match of params.prompt.matchAll(DATA_PATH_REGEX)) {
          const rawPath = match[1].trim()
          const filepath = rawPath.startsWith("/")
            ? rawPath
            : rawPath.startsWith("~/")
              ? path.join(os.homedir(), rawPath.slice(2))
              : path.resolve(Instance.worktree, rawPath)
          if (seen.has(filepath) || alreadyInjected.has(filepath)) continue
          seen.add(filepath)
          const stats = await fs.stat(filepath).catch(() => undefined)
          if (stats?.isFile()) {
            promptParts.push({
              type: "file",
              url: pathToFileURL(filepath).href,
              filename: rawPath,
              mime: "text/plain",
            })
          }
        }
      }

      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          ...(hasTaskPermission ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
        output,
      }
    },
  }
})
