import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { Global } from "../global"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Scheduler } from "../scheduler"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })
  const hour = 60 * 60 * 1000
  const prune = "7.days"

  export function init() {
    Scheduler.register({
      id: "snapshot.cleanup",
      interval: hour,
      run: cleanup,
      scope: "instance",
    })
  }

  export async function cleanup() {
    if (Instance.project.vcs !== "git" || Flag.OPENCODE_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    const exists = await fs
      .stat(git)
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} gc --prune=${prune}`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
    if (result.exitCode !== 0) {
      log.warn("cleanup failed", {
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return
    }
    log.info("cleanup", { prune })
  }

  export async function track() {
    if (Instance.project.vcs !== "git" || Flag.OPENCODE_CLIENT === "acp") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`
        .env({
          ...process.env,
          GIT_DIR: git,
          GIT_WORK_TREE: Instance.worktree,
        })
        .quiet()
        .nothrow()
      // Configure git to not convert line endings on Windows
      await $`git --git-dir ${git} config core.autocrlf false`.quiet().nothrow()
      log.info("initialized")
    }
    await add(git)
    const hash = await $`git --git-dir ${git} --work-tree ${Instance.worktree} write-tree`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .text()
    log.info("tracking", { hash, cwd: Instance.directory, git })
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    await add(git)
    const result =
      await $`git -c core.autocrlf=false -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-only ${hash} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()

    // If git diff fails, return empty patch
    if (result.exitCode !== 0) {
      log.warn("failed to get diff", { hash, exitCode: result.exitCode })
      return { hash, files: [] }
    }

    const files = result.text()
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => path.join(Instance.worktree, x)),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    const result =
      await $`git --git-dir ${git} --work-tree ${Instance.worktree} read-tree ${snapshot} && git --git-dir ${git} --work-tree ${Instance.worktree} checkout-index -a -f`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.error("failed to restore snapshot", {
        snapshot,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
    }
  }

  export async function revert(patches: Patch[]) {
    const files = new Set<string>()
    const git = gitdir()
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result = await $`git --git-dir ${git} --work-tree ${Instance.worktree} checkout ${item.hash} -- ${file}`
          .quiet()
          .cwd(Instance.worktree)
          .nothrow()
        if (result.exitCode !== 0) {
          const relativePath = path.relative(Instance.worktree, file)
          const checkTree =
            await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${item.hash} -- ${relativePath}`
              .quiet()
              .cwd(Instance.worktree)
              .nothrow()
          if (checkTree.exitCode === 0 && checkTree.text().trim()) {
            log.info("file existed in snapshot but checkout failed, keeping", {
              file,
            })
          } else {
            log.info("file did not exist in snapshot, deleting", { file })
            await fs.unlink(file).catch(() => {})
          }
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    const git = gitdir()
    await add(git)
    const result =
      await $`git -c core.autocrlf=false -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff ${hash} -- .`
        .quiet()
        .cwd(Instance.worktree)
        .nothrow()

    if (result.exitCode !== 0) {
      log.warn("failed to get diff", {
        hash,
        exitCode: result.exitCode,
        stderr: result.stderr.toString(),
        stdout: result.stdout.toString(),
      })
      return ""
    }

    return result.text().trim()
  }

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>
  export async function diffFull(from: string, to: string): Promise<FileDiff[]> {
    const git = gitdir()
    const result: FileDiff[] = []
    const status = new Map<string, "added" | "deleted" | "modified">()

    const statuses =
      await $`git -c core.autocrlf=false -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --name-status --no-renames ${from} ${to} -- .`
        .quiet()
        .cwd(Instance.directory)
        .nothrow()
        .text()

    for (const line of statuses.trim().split("\n")) {
      if (!line) continue
      const [code, file] = line.split("\t")
      if (!code || !file) continue
      const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
      status.set(file, kind)
    }

    for await (const line of $`git -c core.autocrlf=false -c core.quotepath=false --git-dir ${git} --work-tree ${Instance.worktree} diff --no-ext-diff --no-renames --numstat ${from} ${to} -- .`
      .quiet()
      .cwd(Instance.directory)
      .nothrow()
      .lines()) {
      if (!line) continue
      const [additions, deletions, file] = line.split("\t")
      const isBinaryFile = additions === "-" && deletions === "-"
      const before = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${from}:${file}`
            .quiet()
            .nothrow()
            .text()
      const after = isBinaryFile
        ? ""
        : await $`git -c core.autocrlf=false --git-dir ${git} --work-tree ${Instance.worktree} show ${to}:${file}`
            .quiet()
            .nothrow()
            .text()
      const added = isBinaryFile ? 0 : parseInt(additions)
      const deleted = isBinaryFile ? 0 : parseInt(deletions)
      result.push({
        file,
        before,
        after,
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
        status: status.get(file) ?? "modified",
      })
    }

    // Expand submodule entries into file-level diffs
    // Use a single ls-tree call per snapshot tree to detect all gitlinks (mode 160000)
    const submodulePaths = new Set<string>()
    if (result.length > 0) {
      const files = result.map((d) => d.file)
      for (const tree of [from, to]) {
        const lsOut = await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${tree} -- ${files}`
          .quiet()
          .cwd(Instance.directory)
          .nothrow()
          .text()
        for (const line of lsOut.trim().split("\n")) {
          if (!line) continue
          const [mode, , , name] = line.split(/\s+/)
          if (mode === "160000" && name) submodulePaths.add(name)
        }
      }
    }

    if (submodulePaths.size > 0) {
      const expanded: FileDiff[] = []
      for (const subPath of submodulePaths) {
        const subDiffs = await getSubmoduleDiffs(git, from, to, subPath)
        for (const sd of subDiffs) {
          expanded.push(sd)
        }
      }
      // Return non-submodule entries plus expanded submodule files
      return [...result.filter((d) => !submodulePaths.has(d.file)), ...expanded]
    }

    return result
  }

  async function getSubmoduleDiffs(git: string, from: string, to: string, subPath: string): Promise<FileDiff[]> {
    const subRepoPath = path.join(Instance.worktree, subPath)
    if (!subRepoPath.startsWith(Instance.worktree + path.sep) && subRepoPath !== Instance.worktree) {
      log.warn("submodule path escapes worktree, skipping", { subPath })
      return []
    }
    const exists = await fs
      .stat(subRepoPath)
      .then(() => true)
      .catch(() => false)
    if (!exists) {
      log.warn("submodule directory not found, skipping", { subPath })
      return []
    }
    const result: FileDiff[] = []

    // Get nested submodule paths to skip them
    const nestedSubOutput = await $`git -c core.quotepath=false submodule status`
      .quiet()
      .cwd(subRepoPath)
      .nothrow()
      .text()
    const nestedSubs = new Set<string>()
    for (const line of nestedSubOutput.trim().split("\n")) {
      const m = line.match(/^[+-U ]?[0-9a-f]+\s+(.+?)(?:\s+\(.*\))?$/)
      if (m) nestedSubs.add(m[1])
    }

    // Get the commit hashes for the submodule in both snapshots using ls-tree
    // ls-tree output format: "<mode> <type> <hash>\t<path>"
    const fromLsTree = await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${from} -- ${subPath}`
      .quiet()
      .nothrow()
      .text()
    const toLsTree = await $`git --git-dir ${git} --work-tree ${Instance.worktree} ls-tree ${to} -- ${subPath}`
      .quiet()
      .nothrow()
      .text()

    const fromHash = fromLsTree.trim().split(/\s+/)[2]
    const toHash = toLsTree.trim().split(/\s+/)[2]

    if (!fromHash && !toHash) {
      log.warn("could not resolve submodule commits", { subPath })
      return result
    }

    // Get status for each file in the submodule
    const subStatus = new Map<string, "added" | "deleted" | "modified">()

    // Handle added submodule (no fromHash) or deleted submodule (no toHash)
    if (!fromHash) {
      // Submodule was added - get all files from toHash and treat as added
      const fileList = await $`git -c core.autocrlf=false -c core.quotepath=false ls-tree -r --name-only ${toHash}`
        .quiet()
        .cwd(subRepoPath)
        .nothrow()
        .text()
      for (const f of fileList.trim().split("\n").filter(Boolean)) {
        subStatus.set(f, "added")
      }
    } else if (!toHash) {
      // Submodule was deleted - get all files from fromHash and treat as deleted
      const fileList = await $`git -c core.autocrlf=false -c core.quotepath=false ls-tree -r --name-only ${fromHash}`
        .quiet()
        .cwd(subRepoPath)
        .nothrow()
        .text()
      for (const f of fileList.trim().split("\n").filter(Boolean)) {
        subStatus.set(f, "deleted")
      }
    } else {
      // Both commits exist - run diff to get file changes
      const statusOutput =
        await $`git -c core.autocrlf=false -c core.quotepath=false diff --name-status --no-renames ${fromHash} ${toHash}`
          .quiet()
          .cwd(subRepoPath)
          .nothrow()
          .text()
      for (const line of statusOutput.trim().split("\n")) {
        if (!line) continue
        const [code, f] = line.split("\t")
        if (!code || !f) continue
        const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
        subStatus.set(f, kind)
      }
    }

    // Get numstat for the submodule
    const numstat =
      !fromHash || !toHash
        ? ""
        : await $`git -c core.autocrlf=false -c core.quotepath=false diff --numstat --no-renames ${fromHash} ${toHash}`
            .quiet()
            .cwd(subRepoPath)
            .nothrow()
            .text()

    for (const line of numstat.trim().split("\n")) {
      if (!line) continue
      const [additions, deletions, f] = line.split("\t")
      if (!f) continue
      if (nestedSubs.has(f)) continue // skip nested submodule entries
      const isBinary = additions === "-" && deletions === "-"
      const fullPath = path.posix.join(subPath, f)

      const before = isBinary
        ? ""
        : fromHash
          ? await $`git -c core.autocrlf=false show ${fromHash}:${f}`.quiet().cwd(subRepoPath).nothrow().text()
          : ""
      const after = isBinary
        ? ""
        : toHash
          ? await $`git -c core.autocrlf=false show ${toHash}:${f}`.quiet().cwd(subRepoPath).nothrow().text()
          : ""

      const added = isBinary ? 0 : parseInt(additions)
      const deleted = isBinary ? 0 : parseInt(deletions)
      result.push({
        file: fullPath,
        before: before ?? "",
        after: after ?? "",
        additions: Number.isFinite(added) ? added : 0,
        deletions: Number.isFinite(deleted) ? deleted : 0,
        status: subStatus.get(f) ?? "modified",
      })
    }

    // Handle files that are added or deleted but not in numstat
    const seen = new Set(result.map((r) => r.file))
    for (const [f, st] of subStatus) {
      if (nestedSubs.has(f)) continue // skip nested submodule entries
      const fullPath = path.posix.join(subPath, f)
      if (seen.has(fullPath)) continue

      const before =
        st === "added" || !fromHash
          ? ""
          : await $`git -c core.autocrlf=false show ${fromHash}:${f}`.quiet().cwd(subRepoPath).nothrow().text()
      const after =
        st === "deleted" || !toHash
          ? ""
          : await $`git -c core.autocrlf=false show ${toHash}:${f}`.quiet().cwd(subRepoPath).nothrow().text()

      result.push({
        file: fullPath,
        before: before ?? "",
        after: after ?? "",
        additions: st === "added" ? (after?.split("\n").length ?? 0) : 0,
        deletions: st === "deleted" ? (before?.split("\n").length ?? 0) : 0,
        status: st,
      })
    }

    return result
  }

  function gitdir() {
    const project = Instance.project
    return path.join(Global.Path.data, "snapshot", project.id)
  }

  async function add(git: string) {
    await syncExclude(git)
    await $`git --git-dir ${git} --work-tree ${Instance.worktree} add .`.quiet().cwd(Instance.directory).nothrow()
  }

  async function syncExclude(git: string) {
    const file = await excludes()
    const target = path.join(git, "info", "exclude")
    await fs.mkdir(path.join(git, "info"), { recursive: true })
    if (!file) {
      await Bun.write(target, "")
      return
    }
    const text = await Bun.file(file)
      .text()
      .catch(() => "")
    await Bun.write(target, text)
  }

  async function excludes() {
    const file = await $`git rev-parse --path-format=absolute --git-path info/exclude`
      .quiet()
      .cwd(Instance.worktree)
      .nothrow()
      .text()
    if (!file.trim()) return
    const exists = await fs
      .stat(file.trim())
      .then(() => true)
      .catch(() => false)
    if (!exists) return
    return file.trim()
  }
}
