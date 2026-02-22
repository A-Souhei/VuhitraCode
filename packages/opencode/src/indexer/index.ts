import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { FileWatcher } from "@/file/watcher"
import { FileIgnore } from "@/file/ignore"
import { Glob } from "@/util/glob"
import { Env } from "@/env"
import { VuHitraSettings } from "@/project/vuhitra-settings"
import { isGitignored } from "@/util/gitignore"
import { Faker } from "@/util/faker"
import { Log } from "@/util/log"
import path from "path"
import fs from "fs"

export namespace Indexer {
  const log = Log.create({ service: "indexer" })

  export const Status = z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("disabled") }),
      z.object({ type: z.literal("indexing"), progress: z.number() }),
      z.object({ type: z.literal("complete") }),
    ])
    .meta({ ref: "IndexerStatus" })
  export type Status = z.infer<typeof Status>

  export const Event = {
    Updated: BusEvent.define("indexer.updated", z.object({})),
  }

  interface State {
    status: Status
    abortController: AbortController
  }

  const state = Instance.state<State>(
    () => ({ status: { type: "disabled" }, abortController: new AbortController() }),
    async (s) => {
      s.abortController.abort()
    },
  )

  function collectionName() {
    return "opencode_" + Instance.project.id.replace(/[^a-zA-Z0-9]+/g, "_")
  }

  function qdrantUrl() {
    return Env.get("QDRANT_URL") || "http://localhost:6333"
  }

  function embeddingUrl() {
    return Env.get("EMBEDDING_URL") || "http://localhost:11434"
  }

  function embeddingModel() {
    return Env.get("EMBEDDING_MODEL") || "nomic-embed-text:latest"
  }

  function qdrantHeaders(): Record<string, string> {
    const key = Env.get("QDRANT_API_KEY")
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (key) headers["api-key"] = key
    return headers
  }

  function toUUID(str: string): string {
    const hasher = new Bun.CryptoHasher("md5")
    hasher.update(str)
    const hex = hasher.digest("hex")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  }

  async function embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const url = embeddingUrl()
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    const response = await fetch(`${url}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: combined,
      body: JSON.stringify({ model: embeddingModel(), prompt: text }),
    })
    if (!response.ok) throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`)
    const data = (await response.json()) as { embedding: number[] }
    return data.embedding
  }

  async function ensureCollection(signal?: AbortSignal) {
    const name = collectionName()
    const url = qdrantUrl()
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    const existing = await fetch(`${url}/collections/${name}`, {
      method: "GET",
      headers: qdrantHeaders(),
      signal: combined,
    })
    if (existing.ok) return
    const sample = await embed("dim", signal)
    const size = sample.length
    const combined2 = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    const response = await fetch(`${url}/collections/${name}`, {
      method: "PUT",
      headers: qdrantHeaders(),
      signal: combined2,
      body: JSON.stringify({
        vectors: { size, distance: "Cosine" },
      }),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { status?: { error?: string } }
      if (!String(body?.status?.error ?? "").includes("already exists")) {
        throw new Error(`Failed to ensure collection: ${response.status} ${response.statusText}`)
      }
    }
  }

  async function upsertPoints(points: { id: string; vector: number[]; payload: Record<string, unknown> }[]) {
    const name = collectionName()
    const url = qdrantUrl()
    const response = await fetch(`${url}/collections/${name}/points`, {
      method: "PUT",
      headers: qdrantHeaders(),
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ points }),
    })
    if (!response.ok) throw new Error(`Failed to upsert points: ${response.status} ${response.statusText}`)
  }

  async function deleteByFilePath(filePath: string) {
    const name = collectionName()
    const url = qdrantUrl()
    const response = await fetch(`${url}/collections/${name}/points/delete`, {
      method: "POST",
      headers: qdrantHeaders(),
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        filter: {
          must: [{ key: "file_path", match: { value: filePath } }],
        },
      }),
    })
    if (!response.ok) throw new Error(`Failed to delete points: ${response.status} ${response.statusText}`)
  }

  async function getIndexedMtime(filePath: string): Promise<number | null> {
    const name = collectionName()
    const url = qdrantUrl()
    const response = await fetch(`${url}/collections/${name}/points/scroll`, {
      method: "POST",
      headers: qdrantHeaders(),
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        filter: { must: [{ key: "file_path", match: { value: filePath } }] },
        limit: 1,
        with_payload: ["mtime"],
      }),
    })
    if (!response.ok) throw new Error(`Failed to get indexed mtime: ${response.status} ${response.statusText}`)
    const data = (await response.json()) as { result: { points: { payload: { mtime?: number } }[] } }
    return data.result?.points?.[0]?.payload?.mtime ?? null
  }

  export function chunkFile(content: string, filePath: string): { id: string; text: string; startLine: number }[] {
    if (!content.trim()) return []
    const lines = content.split("\n")
    const CHUNK_SIZE = 50
    const OVERLAP = 10
    const chunks: { id: string; text: string; startLine: number }[] = []

    for (let i = 0; i < lines.length; i += CHUNK_SIZE - OVERLAP) {
      const startLine = i + 1
      const chunkLines = lines.slice(i, i + CHUNK_SIZE)
      const text = chunkLines.join("\n")
      const id = toUUID(`${filePath}:${startLine}`)
      chunks.push({ id, text, startLine })
      if (i + CHUNK_SIZE >= lines.length) break
    }

    return chunks
  }

  async function indexFile(
    filePath: string,
    skipIfUnchanged = false,
    signal?: AbortSignal,
    isIgnored?: (f: string) => boolean,
  ) {
    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) return
      if (stat.size > 1024 * 1024) return

      if (skipIfUnchanged) {
        const indexedMtime = await getIndexedMtime(filePath)
        if (indexedMtime === stat.mtimeMs) return
      }

      let content = await fs.promises.readFile(filePath, "utf-8")
      const ignored = isIgnored ? isIgnored(filePath) : await isGitignored(filePath)
      if (ignored) {
        content = await Faker.fakeContent(content, filePath)
      }
      const chunks = chunkFile(content, filePath)
      if (chunks.length === 0) return

      await deleteByFilePath(filePath)

      const points: { id: string; vector: number[]; payload: Record<string, unknown> }[] = []
      for (const chunk of chunks) {
        const vector = await embed(`File: ${filePath}\n\n${chunk.text}`, signal)
        points.push({
          id: chunk.id,
          vector,
          payload: {
            file_path: filePath,
            text: chunk.text,
            start_line: chunk.startLine,
            mtime: stat.mtimeMs,
          },
        })
      }

      await upsertPoints(points)
    } catch (e) {
      log.warn("failed to index file", { file: filePath, error: String(e) })
    }
  }

  async function checkServices() {
    const timeout = AbortSignal.timeout(5_000)
    await Promise.all([
      fetch(`${qdrantUrl()}/healthz`, { signal: timeout }).then((r) => {
        if (!r.ok) throw new Error(`Qdrant unhealthy: ${r.status}`)
      }),
      fetch(`${embeddingUrl()}/api/tags`, { signal: timeout }).then((r) => {
        if (!r.ok) throw new Error(`Ollama unhealthy: ${r.status}`)
      }),
    ])
  }

  async function buildIgnoreChecker(worktree: string, files: string[]): Promise<(filepath: string) => boolean> {
    const ignored = new Set<string>()
    try {
      const relative = files.map((f) => path.relative(worktree, f))
      const proc = Bun.spawn(["git", "check-ignore", "--stdin"], {
        cwd: worktree,
        stdin: new TextEncoder().encode(relative.join("\n")),
        stdout: "pipe",
        stderr: "ignore",
      })
      const text = await new Response(proc.stdout as ReadableStream).text()
      await proc.exited
      text.split("\n").filter(Boolean).forEach((rel) => ignored.add(path.resolve(worktree, rel)))
    } catch (error) {
      log.warn("git check-ignore failed; git-ignored files may be indexed", { error: String(error) })
    }
    return (filepath: string) => ignored.has(filepath)
  }

  async function runInitialIndex() {
    const s = state()
    await checkServices()
    await ensureCollection(s.abortController.signal)
    const files = (await Glob.scan("**/*", { cwd: Instance.directory, absolute: true, dot: true })).filter(
      (f) => !FileIgnore.match(path.relative(Instance.directory, f)),
    )
    if (files.length === 0) {
      s.status = { type: "complete" }
      Bus.publish(Event.Updated, {})
      return
    }
    const isIgnored = await buildIgnoreChecker(Instance.worktree, files)
    let done = 0
    let lastProgress = -1
    for (const file of files) {
      if (s.abortController.signal.aborted) {
        s.status = { type: "disabled" }
        Bus.publish(Event.Updated, {})
        return
      }
      await indexFile(file, true, s.abortController.signal, isIgnored)
      done++
      const progress = Math.round((done / files.length) * 100)
      s.status = { type: "indexing", progress }
      if (progress !== lastProgress) {
        Bus.publish(Event.Updated, {})
        lastProgress = progress
      }
    }
    s.status = { type: "complete" }
    Bus.publish(Event.Updated, {})
  }

  function watchForChanges() {
    Bus.subscribe(FileWatcher.Event.Updated, async ({ properties: { file, event } }) => {
      const rel = path.relative(Instance.directory, file)
      if (FileIgnore.match(rel)) return
      if (event === "unlink") {
        await deleteByFilePath(file).catch((error) => {
          log.error("failed to delete index entry for file", { file, error: String(error) })
        })
      } else {
        await indexFile(file).catch((error) => {
          log.error("failed to index file from watcher event", { file, event, error: String(error) })
        })
      }
    })
  }

  export function status(): Status {
    return state().status
  }

  const MAX_QUERY_LENGTH = 1000

  export async function search(query: string, topK = 5): Promise<string[]> {
    if (!query || query.length > MAX_QUERY_LENGTH) throw new Error("Invalid query length")
    if (state().status.type !== "complete") return []
    const vector = await embed(query)
    const name = collectionName()
    const url = qdrantUrl()
    const response = await fetch(`${url}/collections/${name}/points/search`, {
      method: "POST",
      headers: qdrantHeaders(),
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ vector, limit: topK, with_payload: true }),
    })
    if (!response.ok) throw new Error(`Qdrant search failed: ${response.status} ${response.statusText}`)
    const data = (await response.json()) as {
      result: { payload: { file_path: string; text: string; start_line: number } }[]
    }
    return data.result.map((r) => {
      const { file_path, text, start_line } = r.payload
      return `// ${file_path}:${start_line}\n${text}`
    })
  }

  export function init() {
    if (!VuHitraSettings.indexingEnabled()) return
    const s = state()
    s.status = { type: "indexing", progress: 0 }
    Promise.resolve().then(async () => {
      try {
        await runInitialIndex()
        watchForChanges()
      } catch (e) {
        log.error("indexer failed to start", { error: String(e) })
        s.status = { type: "disabled" }
        Bus.publish(Event.Updated, {})
      }
    })
  }
}
