import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"
import { Auth } from "../auth"
import { ProviderTransform } from "../provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_SECRET from "./prompt/secret.txt"
import PROMPT_WORK from "./prompt/work.txt"
import PROMPT_SUPER from "./prompt/super.txt"
import PROMPT_SENTINEL from "./prompt/sentinel.txt"
import PROMPT_SCOUT from "./prompt/scout.txt"
import PROMPT_KEEPER from "./prompt/keeper.txt"
import PROMPT_TEST from "./prompt/test.txt"
import PROMPT_REVIEW from "./prompt/review.txt"
import PROMPT_CHORES from "./prompt/chores.txt"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@/global"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { Env } from "../env"

export namespace Agent {
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      variant: z.string().optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const skillDirs = await Skill.dirs()
    const whitelistedDirs = [Truncate.GLOB, ...skillDirs.map((dir) => path.join(dir, "*"))]
    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
      },
      question: "deny",
      plan_enter: "deny",
      plan_exit: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
      bash: {
        "*": "allow",
        "git *": "deny",
        "gh *": "deny",
        "svn *": "deny",
        "hg *": "deny",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, Info> = {
      build: {
        name: "build",
        description: "The default agent. Executes tools based on configured permissions.",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      plan: {
        name: "plan",
        description: "Plan mode. Disallows all edit tools.",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_exit: "allow",
            external_directory: {
              [path.join(Global.Path.data, "plans", "*")]: "allow",
            },
            edit: {
              "*": "deny",
              [path.join(".opencode", "plans", "*.md")]: "allow",
              [path.relative(Instance.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
            },
          }),
          user,
        ),
        mode: "primary",
        native: true,
      },
      work: {
        name: "work",
        description:
          "Implementation agent that plans before building: creates a full TODO list, tracks each item in real time, and verifies completion via @keeper.",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
            task: "allow",
          }),
          user,
        ),
        prompt: PROMPT_WORK,
        mode: "primary",
        native: true,
      },
      super: {
        name: "super",
        description:
          "Parallel implementation agent. Orchestrates up to 3 Sentinels for concurrent TODO execution, each with 1 Scout for context gathering. Uses Keeper for verification.",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            plan_enter: "allow",
            task: "allow",
          }),
          user,
        ),
        prompt: PROMPT_SUPER,
        mode: "primary",
        native: true,
      },
      sentinel: {
        name: "sentinel",
        description:
          "Worker agent for parallel TODO execution. Up to 3 can run simultaneously. Each Sentinel can spawn 1 Scout subagent for context gathering.",
        options: {},
        // user overrides are applied before the task restriction so a permissive
        // user config cannot allow sentinels to spawn arbitrary subagents beyond scouts.
        permission: PermissionNext.merge(
          defaults,
          user,
          PermissionNext.fromConfig({
            question: "allow",
            task: {
              scout: "allow",
              "*": "deny",
            },
          }),
        ),
        prompt: PROMPT_SENTINEL,
        mode: "subagent",
        native: true,
        hidden: true,
      },
      scout: {
        name: "scout",
        description:
          "Lightweight exploration agent. Each Sentinel can spawn 1 Scout for context gathering. Can browse internet (requires user approval with explicit URL). Read-only — no write or edit permissions.",
        options: {},
        // user overrides are applied before the read-only restriction so a permissive
        // user config cannot grant scouts write or edit access.
        permission: PermissionNext.merge(
          defaults,
          user,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            read: "allow",
            webfetch: "ask",
            websearch: "ask",
            codesearch: "ask",
            external_directory: {
              "*": "ask",
              ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
            },
          }),
        ),
        prompt: PROMPT_SCOUT,
        mode: "subagent",
        native: true,
        hidden: true,
      },
      keeper: {
        name: "keeper",
        description:
          "Verifies that all todo items are genuinely completed. Has read-only tools (read, glob, grep) to verify changes. Called automatically by the work agent.",
        options: {},
        // user overrides are applied before the read-only restriction so a permissive
        // user config cannot grant keepers write or edit access.
        permission: PermissionNext.merge(
          defaults,
          user,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            glob: "allow",
            grep: "allow",
            list: "allow",
            task: "deny",
          }),
        ),
        prompt: PROMPT_KEEPER,
        mode: "subagent",
        native: true,
        hidden: true,
      },
      test: {
        name: "test",
        description:
          "Creates, runs, and fixes tests for completed work. Can be selected manually or launched automatically after the work agent finishes.",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
          }),
          user,
        ),
        prompt: PROMPT_TEST,
        mode: "primary",
        native: true,
      },
      review: {
        name: "review",
        description:
          "Reviews completed implementation and surfaces findings by severity. Accepts optional focus areas (security, performance, logic, style, tests, docs).",
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
          }),
          user,
        ),
        prompt: PROMPT_REVIEW,
        mode: "primary",
        native: true,
      },
      general: {
        name: "general",
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
          }),
          user,
        ),
        options: {},
        mode: "subagent",
        native: true,
      },
      chores: {
        name: "chores",
        description:
          "VCS specialist. Handles ALL version control operations: git add/commit/push/pull/fetch/rebase/merge/branch/stash/tag, PR creation and management via gh, conflict resolution. Any agent that needs to run a git or gh command MUST delegate to this agent via Task.",
        options: {},
        // user overrides applied before the strict bash restriction so users
        // cannot accidentally grant chores access to non-VCS operations.
        permission: PermissionNext.merge(
          defaults,
          user,
          PermissionNext.fromConfig({
            question: "allow",
            task: "deny",
            bash: {
              "*": "deny",
              "git *": "allow",
              "gh pr *": "allow",
              "gh repo *": "allow",
              "gh issue *": "allow",
              "gh run *": "allow",
              "gh release *": "allow",
              "gh auth status": "allow",
              "gh auth *": "deny",
              "gh secret *": "deny",
              "gh ssh-key *": "deny",
              "svn checkout *": "allow",
              "svn update *": "allow",
              "svn commit *": "allow",
              "svn status *": "allow",
              "svn diff *": "allow",
              "svn log *": "allow",
              "svn add *": "allow",
              "svn revert *": "allow",
              "hg clone *": "allow",
              "hg pull *": "allow",
              "hg push *": "allow",
              "hg commit *": "allow",
              "hg status *": "allow",
              "hg diff *": "allow",
              "hg log *": "allow",
              "hg add *": "allow",
              "hg revert *": "allow",
              "hg update *": "allow",
            },
          }),
        ),
        prompt: PROMPT_CHORES,
        mode: "subagent",
        native: true,
      },
      explore: {
        name: "explore",
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            read: "allow",
            external_directory: {
              "*": "ask",
              ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
            },
          }),
          user,
        ),
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        options: {},
        mode: "subagent",
        native: true,
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        options: {},
      },
      title: {
        name: "title",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        temperature: 0.5,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_TITLE,
      },
      summary: {
        name: "summary",
        mode: "primary",
        options: {},
        native: true,
        hidden: true,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
        prompt: PROMPT_SUMMARY,
      },
    }

    const ollamaModel = Env.get("OLLAMA_MODEL")
    if (ollamaModel) {
      result.secret = {
        name: "secret",
        description: `Private agent for analyzing gitignored (sensitive) files. Runs locally on ollama — data never leaves the machine. Never outputs raw sensitive values, only logical abstractions. Use this agent whenever you need to reason about files that are gitignored.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
          }),
          user,
        ),
        model: {
          providerID: "ollama",
          modelID: ollamaModel,
        },
        prompt: PROMPT_SECRET,
        options: {},
        mode: "subagent",
        native: true,
      }
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.variant = value.variant ?? item.variant
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
    }

    // Ensure Truncate.GLOB is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    )
  }

  export async function defaultAgent() {
    const cfg = await Config.get()
    const agents = await state()

    if (cfg.default_agent) {
      const agent = agents[cfg.default_agent]
      if (!agent) throw new Error(`default agent "${cfg.default_agent}" not found`)
      if (agent.mode === "subagent") throw new Error(`default agent "${cfg.default_agent}" is a subagent`)
      if (agent.hidden === true) throw new Error(`default agent "${cfg.default_agent}" is hidden`)
      return agent.name
    }

    const primaryVisible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
    if (!primaryVisible) throw new Error("no primary visible agent found")
    return primaryVisible.name
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)

    const system = [PROMPT_GENERATE]
    await Plugin.trigger("experimental.chat.system.transform", { model }, { system })
    const existing = await list()

    const params = {
      experimental_telemetry: {
        isEnabled: false,
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    } satisfies Parameters<typeof generateObject>[0]

    if (defaultModel.providerID === "openai" && (await Auth.get(defaultModel.providerID))?.type === "oauth") {
      const result = streamObject({
        ...params,
        providerOptions: ProviderTransform.providerOptions(model, {
          instructions: SystemPrompt.instructions(),
          store: false,
        }),
        onError: () => {},
      })
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error
      }
      return result.object
    }

    const result = await generateObject(params)
    return result.object
  }
}
