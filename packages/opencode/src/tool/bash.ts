import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"
import { isGitignored, extractPathsFromCode, extractBarePaths } from "@/util/gitignore"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

const FILE_READ_CMDS = new Set([
  "cat",
  "less",
  "more",
  "head",
  "tail",
  "sed",
  "awk",
  "grep",
  "sort",
  "uniq",
  "wc",
  "strings",
  "xxd",
  "od",
  "base64",
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
])

// Commands that can run inline code (-c, -e, or -r flags)
// These need special handling to extract file paths from code strings
const INTERPRETER_CMDS = new Set([
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
  "bash",
  "sh",
  "zsh",
  "fish",
  "php",
  "Rscript",
  "R",
  "julia",
  "elixir",
  "pwsh",
  "powershell",
  "lua",
  "dash",
])

// Helper to check if command is an interpreter (handles versioned names)
const isInterpreterCmd = (cmd: string): boolean => {
  if (INTERPRETER_CMDS.has(cmd)) return true
  // Handle versioned interpreter names
  if (cmd.startsWith("python")) return true // python2, python3.11, etc.
  if (cmd === "nodejs" || cmd === "bun" || cmd === "deno") return true
  return false
}

// Get the inline code flag for an interpreter
const getInlineFlag = (cmd: string): string[] => {
  if (cmd.startsWith("python")) return ["-c"]
  if (cmd === "php") return ["-r"]
  if (cmd === "bash" || cmd === "sh" || cmd === "zsh" || cmd === "fish" || cmd === "dash") return ["-c"]
  if (cmd === "pwsh" || cmd === "powershell") return ["-c"]
  // node, bun, deno, perl, ruby, R, Rscript, julia, elixir, lua use -e
  return ["-e"]
}

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue

        // Get full command text including redirects if present
        const commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // not an exhaustive list, but covers most common cases
        if (
          ["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0]) ||
          FILE_READ_CMDS.has(command[0])
        ) {
          // base64 can read files in both encode and decode modes
          // "base64 file" encodes file content (exposes data)
          // "base64 -d file" decodes file content (exposes data)
          // Both should be blocked for gitignored files
          if (command[0] === "base64") {
            for (const arg of command.slice(1)) {
              if (arg.startsWith("-")) continue
              const resolved = await $`realpath ${arg}`
                .cwd(cwd)
                .quiet()
                .nothrow()
                .text()
                .then((x) => x.trim())
              if (resolved) {
                if ((await isGitignored(resolved)) && ctx.agent !== "secret" && ctx.agent !== "data-explore") {
                  const rel = path.relative(Instance.worktree, resolved)
                  throw new Error(
                    `Access denied: "${rel}" is gitignored (private).\n` +
                      `This file may contain sensitive data. Use the Read tool to access it safely instead.`,
                  )
                }
              }
            }
            continue
          }
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = await $`realpath ${arg}`
              .cwd(cwd)
              .quiet()
              .nothrow()
              .text()
              .then((x) => x.trim())
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              // Git Bash on Windows returns Unix-style paths like /c/Users/...
              const normalized =
                process.platform === "win32" && resolved.match(/^\/[a-z]\//)
                  ? resolved.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
                  : resolved
              if (!Instance.containsPath(normalized)) {
                const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
                directories.add(dir)
              }
              if (
                FILE_READ_CMDS.has(command[0]) &&
                (await isGitignored(normalized)) &&
                ctx.agent !== "secret" &&
                ctx.agent !== "data-explore"
              ) {
                const rel = path.relative(Instance.worktree, normalized)
                throw new Error(
                  `Access denied: "${rel}" is gitignored (private).\n` +
                    `This file may contain sensitive data. Use the Read tool to access it safely instead.`,
                )
              }
            }
          }
        }

        // Check interpreter commands with inline code for gitignored file access
        // python -c "...", node -e "...", bash -c "...", php -r "...", etc.
        if (isInterpreterCmd(command[0])) {
          const inlineFlags = getInlineFlag(command[0])
          for (let i = 0; i < command.length - 1; i++) {
            if (inlineFlags.includes(command[i])) {
              // The code string is the next argument - strip quotes if present
              const codeArg = command[i + 1]
              if (!codeArg) continue
              // Remove surrounding quotes (single, double, or backticks)
              let code =
                (codeArg.startsWith("'") && codeArg.endsWith("'")) || (codeArg.startsWith('"') && codeArg.endsWith('"'))
                  ? codeArg.slice(1, -1)
                  : codeArg

              // Unescape shell escape sequences that may be present in the code string
              // This handles cases like: python -c "open(\"file.txt\")" or elixir -e "File.read!(\"file.txt\")"
              // where the quotes are escaped for shell but we need to extract the actual paths
              code = code
                .replace(/\\\\/g, "\x00") // Temporarily replace \\ with null char
                .replace(/\\"/g, '"') // Unescape \"
                .replace(/\\'/g, "'") // Unescape \'
                .replace(/\x00/g, "\\") // Restore backslashes

              // Extract paths from quoted strings (for all interpreters)
              const extractedPaths = extractPathsFromCode(code)

              // For shell interpreters, also extract bare file paths
              // Shell commands often have unquoted file arguments
              // Also include PowerShell interpreters since they use bare paths in commands
              const isShellInterpreter = [
                "bash",
                "sh",
                "zsh",
                "fish",
                "dash",
                "ash",
                "mksh",
                "yash",
                "pwsh",
                "powershell",
              ].includes(command[0])
              if (isShellInterpreter) {
                const barePaths = extractBarePaths(code)
                extractedPaths.push(...barePaths)
              }

              for (const extractedPath of extractedPaths) {
                const resolved = await $`realpath ${extractedPath}`
                  .cwd(cwd)
                  .quiet()
                  .nothrow()
                  .text()
                  .then((x) => x.trim())
                if (resolved) {
                  const normalized =
                    process.platform === "win32" && resolved.match(/^\/[a-z]\//)
                      ? resolved.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
                      : resolved
                  if ((await isGitignored(normalized)) && ctx.agent !== "secret" && ctx.agent !== "data-explore") {
                    const rel = path.relative(Instance.worktree, normalized)
                    throw new Error(
                      `Access denied: "${rel}" is gitignored (private).\n` +
                        `This file may contain sensitive data. Use the Read tool to access it safely instead.`,
                    )
                  }
                }
              }
            }
          }
        }

        // cd covered by above check
        if (command.length && command[0] !== "cd") {
          patterns.add(commandText)
          always.add(BashArity.prefix(command).join(" ") + " *")
        }
      }

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => path.join(dir, "*"))
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
          ...shellEnv.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
