import * as path from "path"
import { Instance } from "../project/instance"

export async function isGitignored(filepath: string): Promise<boolean> {
  const worktree = Instance.worktree
  const relative = path.relative(worktree, filepath)
  if (relative.startsWith("..")) return false
  try {
    const proc = Bun.spawn(["git", "check-ignore", "-q", relative], {
      cwd: worktree,
      stdout: "ignore",
      stderr: "ignore",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return true
  }
}
