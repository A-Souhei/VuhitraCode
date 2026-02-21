import * as fs from "fs/promises"
import * as path from "path"
import ignore from "ignore"
import { Instance } from "../project/instance"

export async function isGitignored(filepath: string): Promise<boolean> {
  const worktree = Instance.worktree
  const relative = path.relative(worktree, filepath)
  if (relative.startsWith("..")) return false
  try {
    const content = await fs.readFile(path.join(worktree, ".gitignore"), "utf-8")
    return ignore().add(content).ignores(relative)
  } catch {
    return false
  }
}
