import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { FileWatcher } from "@/file/watcher"
import { FileIgnore } from "@/file/ignore"
import { Env } from "@/env"
import { VuHitraSettings } from "@/project/vuhitra-settings"
import { isGitignored } from "@/util/gitignore"
import { Faker } from "@/util/faker"
import { Log } from "@/util/log"
import ignore from "ignore"
import path from "path"
import fs from "fs"

export namespace Indexer {
  const log = Log.create({ service: "indexer" })

  export const Status = z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("disabled") }),
      z.object({ type: z.literal("indexing"), progress: z.number(), total: z.number() }),
      z.object({ type: z.literal("complete") }),
    ])
    .meta({ ref: "IndexerStatus" })
  export type Status = z.infer<typeof Status>

  export const Event = {
    Updated: BusEvent.define("indexer.updated", Status),
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

  function maxFileSizeBytes(): number {
    const val = Env.get("INDEXER_MAX_FILE_SIZE")
    if (val) {
      const parsed = parseInt(val, 10)
      if (!isNaN(parsed) && parsed > 0 && parsed <= 100 * 1024 * 1024) return parsed
    }
    return 1024 * 1024 // 1MB default
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

  // Concurrency limiter for parallel processing
  async function mapParallel<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
    signal?: AbortSignal,
  ): Promise<(R | null)[]> {
    const results: (R | null)[] = new Array(items.length)
    let index = 0
    const count = Math.min(concurrency, items.length)

    const workers = Array.from({ length: count }, async () => {
      while (true) {
        const i = index++
        if (i >= items.length) break
        if (signal?.aborted) break
        try {
          results[i] = await fn(items[i])
        } catch {
          results[i] = null
        }
      }
    })

    await Promise.all(workers)
    return results
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

  async function getAllIndexedMtimes(signal?: AbortSignal): Promise<Map<string, number>> {
    const mtimes = new Map<string, number>()
    const name = collectionName()
    const url = qdrantUrl()
    let offset: string | number | null = null

    do {
      const body: Record<string, unknown> = {
        limit: 1000,
        with_payload: ["file_path", "mtime"],
        with_vectors: false,
      }
      if (offset !== null) body.offset = offset

      const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
      const response = await fetch(`${url}/collections/${name}/points/scroll`, {
        method: "POST",
        headers: qdrantHeaders(),
        signal: combined,
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`Failed to fetch indexed mtimes: ${response.status} ${response.statusText}`)
      const data = (await response.json()) as {
        result: {
          points: { payload: { file_path?: string; mtime?: number } }[]
          next_page_offset: string | number | null
        }
      }

      for (const point of data.result.points) {
        const { file_path, mtime } = point.payload
        // All chunks for the same file share the same mtime; keep the first encountered.
        if (file_path && mtime !== undefined && !mtimes.has(file_path)) {
          mtimes.set(file_path, mtime)
        }
      }
      offset = data.result.next_page_offset
    } while (offset !== null)

    return mtimes
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
    indexedMtimes?: Map<string, number>,
  ) {
    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) return
      if (stat.size > maxFileSizeBytes()) return

      if (skipIfUnchanged) {
        const indexedMtime =
          indexedMtimes !== undefined ? (indexedMtimes.get(filePath) ?? null) : await getIndexedMtime(filePath)
        if (indexedMtime === stat.mtimeMs) return
      }

      let content = await fs.promises.readFile(filePath, "utf-8")
      const ignored = isIgnored ? isIgnored(filePath) : await isGitignored(filePath)
      if (ignored) {
        content = await Faker.fakeContent(content, filePath)
      }
      const chunks = chunkFile(content, filePath)
      if (chunks.length === 0) return

      // Redact file path for gitignored files to prevent leaking directory structure
      const indexedPath = ignored ? "[gitignored]" : filePath

      // Embed all chunks in parallel (using concurrency limit of 10)
      const results = await mapParallel(
        chunks,
        10,
        async (chunk) => {
          try {
            const vector = await embed(`File: ${filePath}\n\n${chunk.text}`, signal)
            return {
              id: chunk.id,
              vector,
              payload: {
                file_path: indexedPath,
                text: chunk.text,
                start_line: chunk.startLine,
                mtime: stat.mtimeMs,
                is_gitignored: ignored,
              },
            }
          } catch (e) {
            log.warn("failed to embed chunk", { file: filePath, chunk: chunk.startLine, error: String(e) })
            return null
          }
        },
        signal,
      )

      const points = results.filter(Boolean) as { id: string; vector: number[]; payload: Record<string, unknown> }[]
      if (points.length === 0) return

      await deleteByFilePath(filePath)
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
      text
        .split("\n")
        .filter(Boolean)
        .forEach((rel) => ignored.add(path.resolve(worktree, rel)))
    } catch (error) {
      log.warn("git check-ignore failed; git-ignored files may be indexed", { error: String(error) })
    }
    return (filepath: string) => ignored.has(filepath)
  }

  function loadIndexIgnore(): (rel: string) => boolean {
    const filePath = path.join(Instance.directory, ".vuhitra", "index-ignore")
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const ig = ignore().add(content)
      return (rel: string) => {
        if (!rel || rel.startsWith("..")) return false
        try {
          return ig.ignores(rel)
        } catch {
          return false
        }
      }
    } catch (e: any) {
      if (e?.code !== "ENOENT") log.warn("failed to load index-ignore file", { error: String(e) })
      return () => false
    }
  }

  async function runInitialIndex() {
    const s = state()
    await ensureCollection(s.abortController.signal)
    // index-ignore rules are loaded once at startup; edits require a restart.
    // Files matching new patterns are not automatically removed from Qdrant.
    const isIndexIgnored = loadIndexIgnore()

    // Bulk-fetch all already-indexed mtimes once to avoid one Qdrant query per file.
    // NOTE: the map may be stale for files modified during the scan; the file watcher
    // will re-index any such files after startup completes.
    const indexedMtimes = await getAllIndexedMtimes(s.abortController.signal).catch((e) => {
      log.warn("failed to fetch indexed mtimes, falling back to per-file queries", { error: String(e) })
      return undefined
    })

    // Collect all files first so we can report an accurate percentage.
    const allFiles: string[] = []
    const scanner = new Bun.Glob("**/*").scan({ cwd: Instance.directory, absolute: true, dot: true, onlyFiles: true })
    for await (const file of scanner) {
      const rel = path.relative(Instance.directory, file)
      if (FileIgnore.match(rel)) continue
      if (isIndexIgnored(rel)) continue
      allFiles.push(file)
    }

    const total = allFiles.length
    // Publish total now so UI shows accurate denominator before first batch event.
    s.status = { type: "indexing", progress: 0, total }
    Bus.publish(Event.Updated, s.status)

    // Build ignore checker once across all files (avoids one subprocess per batch).
    const isIgnored = await buildIgnoreChecker(Instance.worktree, allFiles)

    const BATCH_SIZE = 500
    let done = 0

    const processBatch = async (batch: string[]): Promise<boolean> => {
      if (batch.length === 0) return true

      const FILE_CONCURRENCY = 10
      await mapParallel(
        batch,
        FILE_CONCURRENCY,
        async (file) => {
          await indexFile(file, true, s.abortController.signal, isIgnored, indexedMtimes)
        },
        s.abortController.signal,
      )

      done += batch.length
      s.status = { type: "indexing", progress: done, total }
      Bus.publish(Event.Updated, s.status)
      return !s.abortController.signal.aborted
    }

    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      if (s.abortController.signal.aborted) {
        s.status = { type: "disabled" }
        Bus.publish(Event.Updated, s.status)
        return
      }
      if (!(await processBatch(allFiles.slice(i, i + BATCH_SIZE)))) {
        s.status = { type: "disabled" }
        Bus.publish(Event.Updated, s.status)
        return
      }
    }

    s.status = { type: "complete" }
    Bus.publish(Event.Updated, s.status)
  }

  function watchForChanges() {
    const isIndexIgnored = loadIndexIgnore()
    Bus.subscribe(FileWatcher.Event.Updated, async ({ properties: { file, event } }) => {
      const rel = path.relative(Instance.directory, file)
      if (FileIgnore.match(rel)) return
      if (isIndexIgnored(rel)) return
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
    // Check services BEFORE setting status to "indexing" to avoid misleading UI
    Promise.resolve().then(async () => {
      try {
        await checkServices()
        s.status = { type: "indexing", progress: 0, total: 0 }
        Bus.publish(Event.Updated, s.status)
        await runInitialIndex()
        watchForChanges()
      } catch (e) {
        log.error("indexer failed to start", { error: String(e) })
        s.status = { type: "disabled" }
        Bus.publish(Event.Updated, s.status)
      }
    })
  }
}
