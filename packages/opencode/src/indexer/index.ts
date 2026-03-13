import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { FileWatcher } from "@/file/watcher"
import { FileIgnore } from "@/file/ignore"
import { Env } from "@/env"
import { VuHitraSettings } from "@/project/vuhitra-settings"
import { isGitignored } from "@/util/gitignore"
import { Log } from "@/util/log"
import ignore from "ignore"
import path from "path"
import fs from "fs"
import Redis from "ioredis"

export namespace Indexer {
  const log = Log.create({ service: "indexer" })

  export const Status = z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("disabled"),
        reason: z
          .enum(["not_configured", "embedding_unreachable", "backend_unreachable", "error", "deleted", "aborted"])
          .optional(),
        message: z.string().optional(),
      }),
      z.object({
        type: z.literal("indexing"),
        progress: z.number(),
        total: z.number(),
        backend: z.enum(["qdrant", "redis"]),
        embedding_url: z.string().optional(),
        embedding_model: z.string().optional(),
        backend_url: z.string().optional(),
      }),
      z.object({
        type: z.literal("complete"),
        backend: z.enum(["qdrant", "redis"]),
        embedding_url: z.string().optional(),
        embedding_model: z.string().optional(),
        backend_url: z.string().optional(),
      }),
    ])
    .meta({ ref: "IndexerStatus" })
  export type Status = z.infer<typeof Status>

  export const Event = {
    Updated: BusEvent.define("indexer.updated", Status),
  }

  interface State {
    status: Status
    abortController: AbortController
    deleting: boolean
    redisClient: Redis | null
    mtimeCache: Map<string, number> | null
    mtimeCacheDirty: boolean
    mtimeCacheFlushTimer: ReturnType<typeof setTimeout> | null
  }

  const state = Instance.state<State>(
    () => ({
      status: { type: "disabled", reason: "not_configured" },
      abortController: new AbortController(),
      deleting: false,
      redisClient: null,
      mtimeCache: null,
      mtimeCacheDirty: false,
      mtimeCacheFlushTimer: null,
    }),
    async (s) => {
      s.abortController.abort()
      if (s.mtimeCacheFlushTimer !== null) {
        clearTimeout(s.mtimeCacheFlushTimer)
        s.mtimeCacheFlushTimer = null
        if (s.mtimeCache && s.mtimeCacheDirty) saveMtimeCacheToDisk(s.mtimeCache)
      }
      if (s.redisClient) {
        await s.redisClient.quit().catch(() => {})
        s.redisClient = null
      }
    },
  )

  // ─── Config helpers ──────────────────────────────────────────────────────────

  // PERF-1: Memoized collectionName
  let _collectionName: string | undefined
  function collectionName() {
    return (_collectionName ??= "opencode_" + Instance.project.id.replace(/[^a-zA-Z0-9]+/g, "_"))
  }

  let _qdrantUrl: string | undefined
  function qdrantUrl() {
    return (_qdrantUrl ??= Env.get("QDRANT_URL") || "http://localhost:6333")
  }

  let _embeddingUrl: string | undefined
  function embeddingUrl() {
    return (_embeddingUrl ??= Env.get("EMBEDDING_URL") || "http://localhost:11434")
  }

  let _embeddingModel: string | undefined
  function embeddingModel() {
    return (_embeddingModel ??= Env.get("EMBEDDING_MODEL") || "nomic-embed-text:latest")
  }

  // PERF-7: Memoized maxFileSizeBytes
  let _maxFileSizeBytes: number | undefined
  function maxFileSizeBytes() {
    if (_maxFileSizeBytes !== undefined) return _maxFileSizeBytes
    const val = Env.get("INDEXER_MAX_FILE_SIZE")
    if (val) {
      const parsed = parseInt(val, 10)
      if (!isNaN(parsed) && parsed > 0 && parsed <= 100 * 1024 * 1024) return (_maxFileSizeBytes = parsed)
    }
    return (_maxFileSizeBytes = 1024 * 1024)
  }

  // PERF-4: Memoized qdrantHeaders
  let _qdrantHeaders: Record<string, string> | undefined
  function qdrantHeaders() {
    if (_qdrantHeaders) return _qdrantHeaders
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const key = Env.get("QDRANT_API_KEY")
    if (key) headers["api-key"] = key
    return (_qdrantHeaders = headers)
  }

  // PERF-3: Memoized useRedis
  let _useRedis: boolean | undefined
  function useRedis() {
    return (_useRedis ??= !!(Env.get("REDIS_URL") || Env.get("REDIS_HOST")))
  }

  let _redisUrl: string | undefined
  function redisUrl() {
    return (_redisUrl ??=
      Env.get("REDIS_URL") || `redis://${Env.get("REDIS_HOST") || "localhost"}:${Env.get("REDIS_PORT") || "6379"}`)
  }

  function getRedisClient(): Redis {
    const s = state()
    if (!s.redisClient) {
      const url = Env.get("REDIS_URL")
      if (url) {
        s.redisClient = new Redis(url, { lazyConnect: true, enableReadyCheck: false })
      } else {
        const host = Env.get("REDIS_HOST") || "localhost"
        const port = parseInt(Env.get("REDIS_PORT") || "6379", 10)
        const password = Env.get("REDIS_PASSWORD")
        s.redisClient = new Redis({ host, port, password, lazyConnect: true, enableReadyCheck: false })
      }
    }
    return s.redisClient
  }

  function activeBackend(): "qdrant" | "redis" {
    return useRedis() ? "redis" : "qdrant"
  }

  // ─── Mtime cache (in-memory + debounced disk persistence) ────────────────────

  function mtimeCachePath() {
    return path.join(Instance.directory, ".vuhitra", "indexer-cache.json")
  }

  // Cache values: positive = indexed file mtime; negative = gitignored sentinel (-mtime);
  // null (absent key) = never seen. Negative sentinels are persisted to disk so the
  // mtime early-return never fires for gitignored files across restarts.
  function loadMtimeCacheFromDisk(): Map<string, number> | null {
    try {
      const raw = fs.readFileSync(mtimeCachePath(), "utf-8")
      const obj = JSON.parse(raw) as Record<string, number>
      return new Map(Object.entries(obj))
    } catch {
      return null
    }
  }

  function saveMtimeCacheToDisk(mtimes: Map<string, number>) {
    try {
      const dir = path.join(Instance.directory, ".vuhitra")
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const obj: Record<string, number> = {}
      for (const [k, v] of mtimes) obj[k] = v
      fs.writeFileSync(mtimeCachePath(), JSON.stringify(obj), "utf-8")
    } catch (e) {
      log.warn("failed to save mtime cache", { error: String(e) })
    }
  }

  function deleteMtimeCache() {
    const s = state()
    s.mtimeCache = null
    s.mtimeCacheDirty = false
    if (s.mtimeCacheFlushTimer !== null) {
      clearTimeout(s.mtimeCacheFlushTimer)
      s.mtimeCacheFlushTimer = null
    }
    try {
      fs.rmSync(mtimeCachePath(), { force: true })
    } catch {}
  }

  // PERF-9: Trailing-edge debounce for mtime cache flush
  /** Mark the in-memory cache dirty and schedule a debounced flush to disk. */
  function scheduleFlushMtimeCache() {
    const s = state()
    s.mtimeCacheDirty = true
    if (s.mtimeCacheFlushTimer !== null) clearTimeout(s.mtimeCacheFlushTimer)
    s.mtimeCacheFlushTimer = setTimeout(() => {
      s.mtimeCacheFlushTimer = null
      s.mtimeCacheDirty = false
      if (s.mtimeCache) saveMtimeCacheToDisk(s.mtimeCache)
    }, 2000)
  }

  function setMtimeCacheEntry(file: string, mtime: number) {
    const s = state()
    if (!s.mtimeCache) s.mtimeCache = new Map()
    s.mtimeCache.set(file, mtime)
    scheduleFlushMtimeCache()
  }

  function deleteMtimeCacheEntry(file: string) {
    const s = state()
    if (s.mtimeCache) {
      s.mtimeCache.delete(file)
      scheduleFlushMtimeCache()
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────

  function toUUID(str: string): string {
    const hasher = new Bun.CryptoHasher("md5")
    hasher.update(str)
    const hex = hasher.digest("hex")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  }

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

  // PERF-8: Cache embedding endpoint URL
  let _embedEndpoint: string | undefined
  async function embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const url = (_embedEndpoint ??= `${embeddingUrl()}/api/embeddings`)
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: combined,
      body: JSON.stringify({ model: embeddingModel(), prompt: text }),
    })
    if (!response.ok) throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`)
    const data = (await response.json()) as { embedding: number[] }
    return data.embedding
  }

  // ─── Qdrant backend ──────────────────────────────────────────────────────────

  const qdrant = {
    async ensureCollection(signal?: AbortSignal) {
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
      const combined2 = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
      const response = await fetch(`${url}/collections/${name}`, {
        method: "PUT",
        headers: qdrantHeaders(),
        signal: combined2,
        body: JSON.stringify({ vectors: { size: sample.length, distance: "Cosine" } }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { status?: { error?: string } }
        if (!String(body?.status?.error ?? "").includes("already exists"))
          throw new Error(`Failed to ensure collection: ${response.status} ${response.statusText}`)
      }
    },

    async upsert(points: { id: string; vector: number[]; payload: Record<string, unknown> }[]) {
      const name = collectionName()
      const url = qdrantUrl()
      const response = await fetch(`${url}/collections/${name}/points`, {
        method: "PUT",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ points }),
      })
      if (!response.ok) throw new Error(`Failed to upsert points: ${response.status} ${response.statusText}`)
    },

    async deleteByPath(filePath: string) {
      const name = collectionName()
      const url = qdrantUrl()
      const response = await fetch(`${url}/collections/${name}/points/delete`, {
        method: "POST",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ filter: { must: [{ key: "file_path", match: { value: filePath } }] } }),
      })
      if (!response.ok) throw new Error(`Failed to delete points: ${response.status} ${response.statusText}`)
    },

    async getAllMtimes(signal?: AbortSignal): Promise<Map<string, number>> {
      const mtimes = new Map<string, number>()
      const name = collectionName()
      const url = qdrantUrl()
      let offset: string | number | null = null
      do {
        const body: Record<string, unknown> = { limit: 1000, with_payload: ["file_path", "mtime"], with_vectors: false }
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
          if (file_path && mtime !== undefined && !mtimes.has(file_path)) mtimes.set(file_path, mtime)
        }
        offset = data.result.next_page_offset
      } while (offset !== null)
      return mtimes
    },

    async search(vector: number[], topK: number): Promise<{ file_path: string; text: string; start_line: number }[]> {
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
      return data.result.map((r) => r.payload)
    },

    async deleteAll() {
      const name = collectionName()
      const url = qdrantUrl()
      try {
        new URL(url)
      } catch {
        throw new Error("Invalid QDRANT_URL configuration")
      }
      const response = await fetch(`${url}/collections/${name}`, {
        method: "DELETE",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status === 404) return
      if (!response.ok) throw new Error(`Failed to delete collection: ${response.status} ${response.statusText}`)
      const verify = await fetch(`${url}/collections/${name}`, {
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(10_000),
      }).catch((e) => {
        log.warn("failed to verify collection deletion", { error: String(e) })
        return null
      })
      if (verify?.ok) throw new Error(`Collection ${name} still exists after deletion`)
    },

    async checkHealth(signal?: AbortSignal) {
      const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000)
      const r = await fetch(`${qdrantUrl()}/healthz`, { signal: combined })
      if (!r.ok) throw new Error(`Qdrant unhealthy: ${r.status}`)
    },
  }

  // ─── Redis backend ────────────────────────────────────────────────────────────

  const redis = {
    keyPrefix() {
      return `${collectionName()}:point:`
    },

    encodeVector(vec: number[]): Buffer {
      const buf = Buffer.allocUnsafe(vec.length * 4)
      for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i], i * 4)
      return buf
    },

    async ensureIndex(signal?: AbortSignal) {
      const client = getRedisClient()
      await client.connect().catch(() => {})
      const dim = (await embed("dim", signal)).length
      const indexName = collectionName()
      const prefix = redis.keyPrefix()
      try {
        await client.call(
          "FT.CREATE",
          indexName,
          "ON",
          "HASH",
          "PREFIX",
          "1",
          prefix,
          "SCHEMA",
          "file_path",
          "TAG",
          "text",
          "TEXT",
          "start_line",
          "NUMERIC",
          "mtime",
          "NUMERIC",
          "vector",
          "VECTOR",
          "HNSW",
          "6",
          "TYPE",
          "FLOAT32",
          "DIM",
          String(dim),
          "DISTANCE_METRIC",
          "COSINE",
        )
      } catch (e: any) {
        const msg = String(e?.message ?? "")
        if (!msg.includes("Index already exists")) throw e
        // Index exists — verify dimension matches to detect embedding model changes
        try {
          const info = (await client.call("FT.INFO", indexName)) as string[]
          // FT.INFO returns flat key-value pairs; find "attributes" and look for "dim"
          const attrIdx = info.indexOf("attributes")
          if (attrIdx !== -1) {
            const attrs = info[attrIdx + 1] as unknown as string[][]
            for (const attr of attrs) {
              if (!Array.isArray(attr)) continue
              const dimIdx = attr.indexOf("dim")
              if (dimIdx !== -1) {
                const existingDim = Number(attr[dimIdx + 1])
                if (existingDim !== dim) {
                  log.info("embedding dimension mismatch, dropping and recreating Redis index", { existingDim, dim })
                  await client.call("FT.DROPINDEX", indexName)
                  await client.call(
                    "FT.CREATE",
                    indexName,
                    "ON",
                    "HASH",
                    "PREFIX",
                    "1",
                    prefix,
                    "SCHEMA",
                    "file_path",
                    "TAG",
                    "text",
                    "TEXT",
                    "start_line",
                    "NUMERIC",
                    "mtime",
                    "NUMERIC",
                    "vector",
                    "VECTOR",
                    "HNSW",
                    "6",
                    "TYPE",
                    "FLOAT32",
                    "DIM",
                    String(dim),
                    "DISTANCE_METRIC",
                    "COSINE",
                  )
                }
                break
              }
            }
          }
        } catch (infoErr) {
          log.warn("failed to verify Redis index dimension", { error: String(infoErr) })
        }
      }
    },

    // PERF-2: Hoist keyPrefix out of upsert loop
    async upsert(points: { id: string; vector: number[]; payload: Record<string, unknown> }[]) {
      const client = getRedisClient()
      const pipeline = client.pipeline()
      const prefix = redis.keyPrefix()
      for (const p of points) {
        const key = `${prefix}${p.id}`
        pipeline.hset(
          key,
          "file_path",
          String(p.payload.file_path ?? ""),
          "text",
          String(p.payload.text ?? ""),
          "start_line",
          String(p.payload.start_line ?? 0),
          "mtime",
          String(p.payload.mtime ?? 0),
          "vector",
          redis.encodeVector(p.vector),
        )
      }
      await pipeline.exec()
    },

    async deleteByPath(filePath: string) {
      const client = getRedisClient()
      const indexName = collectionName()
      // Escape TAG special chars (comma and backslash are the true separators/escapes)
      const escaped = filePath.replace(/[\\,]/g, "\\$&")
      const toDelete: string[] = []
      const PAGE = 1000
      let offset = 0
      while (true) {
        // RETURN 0 = no fields, response is [count, key1, key2, ...]
        const result = (await client.call(
          "FT.SEARCH",
          indexName,
          `@file_path:{${escaped}}`,
          "RETURN",
          "0",
          "LIMIT",
          String(offset),
          String(PAGE),
        )) as unknown[]
        const total = result[0] as number
        // With RETURN 0, result is [count, key1, key2, ...] — stride 1
        for (let i = 1; i < result.length; i++) {
          if (typeof result[i] === "string") toDelete.push(result[i] as string)
        }
        offset += PAGE
        if (offset >= total) break
      }
      if (toDelete.length > 0) {
        const pipeline = client.pipeline()
        for (const k of toDelete) pipeline.del(k)
        await pipeline.exec()
      }
    },

    async getAllMtimes(): Promise<Map<string, number>> {
      const client = getRedisClient()
      const mtimes = new Map<string, number>()
      const indexName = collectionName()
      let offset = 0
      const pageSize = 1000
      while (true) {
        const result = (await client.call(
          "FT.SEARCH",
          indexName,
          "*",
          "RETURN",
          "2",
          "file_path",
          "mtime",
          "LIMIT",
          String(offset),
          String(pageSize),
        )) as unknown[]
        const total = result[0] as number
        // With RETURN 2, result is [count, key1, [f1,v1,f2,v2], key2, [...], ...]
        for (let i = 1; i < result.length; i += 2) {
          if (i + 1 >= result.length) break
          const fields = result[i + 1] as string[]
          if (!Array.isArray(fields)) continue
          let fp: string | null = null
          let mt: number | null = null
          for (let j = 0; j < fields.length; j += 2) {
            if (fields[j] === "file_path") fp = fields[j + 1]
            if (fields[j] === "mtime") mt = Number(fields[j + 1])
          }
          if (fp && mt !== null && !mtimes.has(fp)) mtimes.set(fp, mt)
        }
        offset += pageSize
        if (offset >= total) break
      }
      return mtimes
    },

    async search(vector: number[], topK: number): Promise<{ file_path: string; text: string; start_line: number }[]> {
      const client = getRedisClient()
      const indexName = collectionName()
      const vecBuf = redis.encodeVector(vector)
      const result = (await client.call(
        "FT.SEARCH",
        indexName,
        `*=>[KNN ${topK} @vector $vec AS score]`,
        "PARAMS",
        "2",
        "vec",
        vecBuf,
        "RETURN",
        "3",
        "file_path",
        "text",
        "start_line",
        "SORTBY",
        "score",
        "DIALECT",
        "2",
      )) as unknown[]
      const hits: { file_path: string; text: string; start_line: number }[] = []
      // With RETURN 3, result is [count, key1, [fields...], key2, [...], ...]
      for (let i = 1; i < result.length; i += 2) {
        if (i + 1 >= result.length) break
        const fields = result[i + 1] as string[]
        if (!Array.isArray(fields)) continue
        let fp = "",
          text = "",
          sl = 0
        for (let j = 0; j < fields.length; j += 2) {
          if (fields[j] === "file_path") fp = fields[j + 1]
          if (fields[j] === "text") text = fields[j + 1]
          if (fields[j] === "start_line") sl = Number(fields[j + 1])
        }
        if (fp) hits.push({ file_path: fp, text, start_line: sl })
      }
      return hits
    },

    async deleteAll() {
      const client = getRedisClient()
      const indexName = collectionName()
      await client.call("FT.DROPINDEX", indexName, "DD").catch((e: any) => {
        const msg = String(e?.message ?? "")
        if (!msg.includes("Unknown Index name")) throw e
      })
    },

    // LOGIC-5: Fix Redis checkHealth PING result discarded when signal provided
    async checkHealth(signal?: AbortSignal) {
      const client = getRedisClient()
      await client.connect().catch(() => {})
      // ioredis ping doesn't accept AbortSignal directly; race with a timeout promise
      const ping = client.ping()
      const pong = signal
        ? await Promise.race([
            ping,
            new Promise<never>((_, reject) => {
              signal.addEventListener("abort", () => reject(new Error("aborted")))
            }),
          ])
        : await ping
      if (pong !== "PONG") throw new Error("Redis unhealthy: unexpected PING response")
    },
  }

  // ─── VectorStore dispatch ─────────────────────────────────────────────────────

  const store = {
    async ensureIndex(signal?: AbortSignal) {
      return useRedis() ? redis.ensureIndex(signal) : qdrant.ensureCollection(signal)
    },
    async upsert(points: { id: string; vector: number[]; payload: Record<string, unknown> }[]) {
      return useRedis() ? redis.upsert(points) : qdrant.upsert(points)
    },
    async deleteByPath(filePath: string) {
      return useRedis() ? redis.deleteByPath(filePath) : qdrant.deleteByPath(filePath)
    },
    async getAllMtimes(signal?: AbortSignal): Promise<Map<string, number>> {
      return useRedis() ? redis.getAllMtimes() : qdrant.getAllMtimes(signal)
    },
    async search(vector: number[], topK: number) {
      return useRedis() ? redis.search(vector, topK) : qdrant.search(vector, topK)
    },
    async deleteAll() {
      return useRedis() ? redis.deleteAll() : qdrant.deleteAll()
    },
    async checkHealth(signal?: AbortSignal) {
      return useRedis() ? redis.checkHealth(signal) : qdrant.checkHealth(signal)
    },
  }

  // ─── Core logic ──────────────────────────────────────────────────────────────

  export function chunkFile(content: string, filePath: string): { id: string; text: string; startLine: number }[] {
    if (!content.trim()) return []
    const lines = content.split("\n")
    const CHUNK_SIZE = 50
    const OVERLAP = 10
    const chunks: { id: string; text: string; startLine: number }[] = []
    for (let i = 0; i < lines.length; i += CHUNK_SIZE - OVERLAP) {
      const startLine = i + 1
      const text = lines.slice(i, i + CHUNK_SIZE).join("\n")
      chunks.push({ id: toUUID(`${filePath}:${startLine}`), text, startLine })
      if (i + CHUNK_SIZE >= lines.length) break
    }
    return chunks
  }

  /** Returns the file's mtimeMs if indexed, -mtimeMs (negative) if gitignored (cached as sentinel so callers skip re-stat but always re-check gitignore), null if skipped for other reasons or errored. */
  async function indexFile(
    filePath: string,
    skipIfUnchanged = false,
    signal?: AbortSignal,
    isIgnored?: (f: string) => boolean,
    indexedMtimes?: Map<string, number>,
  ): Promise<number | null> {
    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) return null
      if (stat.size > maxFileSizeBytes()) return null

      // Skip unchanged files for incremental indexing
      if (skipIfUnchanged && indexedMtimes?.get(filePath) === stat.mtimeMs) return stat.mtimeMs

      // Check if gitignored BEFORE reading the file
      const ignored = isIgnored ? isIgnored(filePath) : await isGitignored(filePath)
      if (ignored) return -stat.mtimeMs

      const content = await fs.promises.readFile(filePath, "utf-8")
      const chunks = chunkFile(content, filePath)
      if (chunks.length === 0) return null

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
                file_path: filePath,
                text: chunk.text,
                start_line: chunk.startLine,
                mtime: stat.mtimeMs,
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
      if (points.length === 0) return null

      await store.deleteByPath(filePath)
      await store.upsert(points)
      return stat.mtimeMs
    } catch (e) {
      log.warn("failed to index file", { file: filePath, error: String(e) })
      return null
    }
  }

  async function checkServices() {
    await Promise.all([
      store.checkHealth(AbortSignal.timeout(5_000)).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(
          msg.includes("backend") || msg.includes("Qdrant") || msg.includes("Redis")
            ? msg
            : `backend unhealthy: ${msg}`,
        )
      }),
      fetch(`${embeddingUrl()}/api/tags`, { signal: AbortSignal.timeout(5_000) })
        .then((r) => {
          if (!r.ok) throw new Error(`embedding unhealthy: ${r.status}`)
        })
        .catch((e: unknown) => {
          if (e instanceof Error && e.message.startsWith("embedding")) throw e
          const msg = e instanceof Error ? e.message : String(e)
          throw new Error(`embedding unreachable: ${msg}`)
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
    const signal = s.abortController.signal
    const backend = activeBackend()
    await store.ensureIndex(signal)

    const isIndexIgnored = loadIndexIgnore()

    // ── Fast path: load mtime cache from disk into in-memory state ────────────
    const cached = loadMtimeCacheFromDisk()
    if (cached) {
      s.mtimeCache = cached
      log.info("loaded mtime cache from disk, skipping vector store scroll", { entries: cached.size })
    } else {
      // ── Slow path: fetch from vector store (first boot or cache deleted) ────
      log.info("no mtime cache found, fetching from vector store")
      const fetched = await store.getAllMtimes(signal).catch((e) => {
        log.warn("failed to fetch indexed mtimes, all files will be re-indexed", { error: String(e) })
        return new Map<string, number>()
      })
      s.mtimeCache = fetched
    }

    const indexedMtimes = s.mtimeCache

    const allFiles: string[] = []
    const scanner = new Bun.Glob("**/*").scan({ cwd: Instance.directory, absolute: true, dot: true, onlyFiles: true })
    for await (const file of scanner) {
      const rel = path.relative(Instance.directory, file)
      if (FileIgnore.match(rel)) continue
      if (isIndexIgnored(rel)) continue
      allFiles.push(file)
    }

    const total = allFiles.length
    s.status = {
      type: "indexing",
      progress: 0,
      total,
      backend,
      embedding_url: embeddingUrl(),
      embedding_model: embeddingModel(),
      backend_url: useRedis() ? redisUrl() : qdrantUrl(),
    }
    Bus.publish(Event.Updated, s.status)

    const isIgnored = await buildIgnoreChecker(Instance.worktree, allFiles)

    const BATCH_SIZE = 500
    let done = 0
    let lastPublish = 0

    // PERF-11: Hoist null guard & cache ref out of mapParallel worker
    if (!s.mtimeCache) s.mtimeCache = new Map()
    const cache = s.mtimeCache
    s.mtimeCacheDirty = true // ensure dispose saves progress even on early exit

    const processBatch = async (batch: string[]): Promise<boolean> => {
      if (batch.length === 0) return true
      await mapParallel(
        batch,
        10,
        async (file) => {
          const mtime = await indexFile(file, true, signal, isIgnored, indexedMtimes)
          // indexFile returns:
          //   stat.mtimeMs (positive) — file indexed successfully, or mtime unchanged (skipped)
          //   -stat.mtimeMs (negative) — file is gitignored (sentinel; re-checked each run)
          //   null — error or file otherwise unindexable (do not update cache)
          if (mtime !== null) {
            cache.set(file, mtime) // <-- direct Map.set on s.mtimeCache ref
          }
          done++
          const now = Date.now()
          if (now - lastPublish >= 100) {
            lastPublish = now
            s.status = {
              type: "indexing",
              progress: done,
              total,
              backend,
              embedding_url: embeddingUrl(),
              embedding_model: embeddingModel(),
              backend_url: useRedis() ? redisUrl() : qdrantUrl(),
            }
            Bus.publish(Event.Updated, s.status)
          }
        },
        signal,
      )
      const endNow = Date.now()
      if (endNow - lastPublish >= 50) {
        lastPublish = endNow
        s.status = {
          type: "indexing",
          progress: done,
          total,
          backend,
          embedding_url: embeddingUrl(),
          embedding_model: embeddingModel(),
          backend_url: useRedis() ? redisUrl() : qdrantUrl(),
        }
        Bus.publish(Event.Updated, s.status)
      }
      saveMtimeCacheToDisk(cache)
      return !signal.aborted
    }

    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      if (signal.aborted) {
        if (!s.deleting) {
          s.status = { type: "disabled", reason: "aborted" }
          Bus.publish(Event.Updated, s.status)
        }
        return
      }
      if (!(await processBatch(allFiles.slice(i, i + BATCH_SIZE)))) {
        if (!s.deleting) {
          s.status = { type: "disabled", reason: "aborted" }
          Bus.publish(Event.Updated, s.status)
        }
        return
      }
    }

    // LOGIC-10: Prune orphan vectors when removing stale cache entries
    if (s.mtimeCache) {
      const existingSet = new Set(allFiles)
      const stalePrunePromises: Promise<void>[] = []
      for (const k of s.mtimeCache.keys()) {
        if (!existingSet.has(k)) {
          s.mtimeCache.delete(k)
          stalePrunePromises.push(
            store.deleteByPath(k).catch((e) => console.error("Failed to prune stale vectors for", k, e)),
          )
        }
      }
      await Promise.all(stalePrunePromises)
    }

    // Persist the updated mtime map so next restart is fast
    if (s.mtimeCache) saveMtimeCacheToDisk(s.mtimeCache)

    s.status = {
      type: "complete",
      backend,
      embedding_url: embeddingUrl(),
      embedding_model: embeddingModel(),
      backend_url: useRedis() ? redisUrl() : qdrantUrl(),
    }
    Bus.publish(Event.Updated, s.status)
  }

  function watchForChanges() {
    const isIndexIgnored = loadIndexIgnore()
    Bus.subscribe(FileWatcher.Event.Updated, async ({ properties: { file, event } }) => {
      const rel = path.relative(Instance.directory, file)
      if (FileIgnore.match(rel)) return
      if (isIndexIgnored(rel)) return
      if (event === "unlink") {
        await store.deleteByPath(file).catch((error) => {
          log.error("failed to delete index entry for file", { file, error: String(error) })
        })
        deleteMtimeCacheEntry(file)
      } else {
        const mtime = await indexFile(file).catch((error) => {
          log.error("failed to index file from watcher event", { file, event, error: String(error) })
          return null
        })
        if (mtime !== null) setMtimeCacheEntry(file, mtime)
      }
    })
  }

  export function status(): Status {
    return state().status
  }

  export function classifyReason(msg: string): "embedding_unreachable" | "backend_unreachable" | "error" {
    const lower = msg.toLowerCase()
    if (lower.includes("ollama") || lower.startsWith("embedding")) return "embedding_unreachable"
    if (lower.includes("qdrant") || lower.includes("redis") || lower.includes("backend")) return "backend_unreachable"
    return "error"
  }

  const MAX_QUERY_LENGTH = 1000

  export async function search(query: string, topK = 5): Promise<string[]> {
    if (!query || query.length > MAX_QUERY_LENGTH) throw new Error("Invalid query length")
    if (state().status.type !== "complete") return []
    const vector = await embed(query)
    const hits = await store.search(vector, topK)
    return hits.map((r) => `// ${r.file_path}:${r.start_line}\n${r.text}`)
  }

  export function init() {
    if (!VuHitraSettings.indexingEnabled()) {
      const s = state()
      s.status = { type: "disabled", reason: "not_configured" }
      Bus.publish(Event.Updated, s.status)
      return
    }
    const s = state()
    Promise.resolve().then(async () => {
      try {
        await checkServices()
        s.status = {
          type: "indexing",
          progress: 0,
          total: 0,
          backend: activeBackend(),
          embedding_url: embeddingUrl(),
          embedding_model: embeddingModel(),
          backend_url: useRedis() ? redisUrl() : qdrantUrl(),
        }
        Bus.publish(Event.Updated, s.status)
        await runInitialIndex()
        // LOGIC-8: Guard watchForChanges after aborted runInitialIndex
        if (!s.abortController.signal.aborted) watchForChanges()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log.error("indexer failed to start", { error: msg })
        const reason = classifyReason(msg)
        s.status = { type: "disabled", reason, message: msg }
        Bus.publish(Event.Updated, s.status)
      }
    })
  }

  export async function deleteCollection(): Promise<void> {
    const s = state()
    if (s.deleting) throw new Error("Deletion already in progress")
    s.deleting = true
    try {
      s.abortController.abort()
      s.abortController = new AbortController()
      await store.deleteAll()
      deleteMtimeCache()
      const newStatus: Status = { type: "disabled", reason: "deleted" }
      s.status = newStatus
      await Bus.publish(Event.Updated, newStatus)
    } finally {
      s.deleting = false
    }
  }
}
