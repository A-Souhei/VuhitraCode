import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { VuHitraSettings } from "@/project/vuhitra-settings"
import { Env } from "@/env"
import { Log } from "@/util/log"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Tool } from "@/tool/tool"
import Redis from "ioredis"
import { Scoring } from "@/cache/scoring"
import { Canonicalize } from "@/cache/canonicalize"

export namespace Memory {
  const log = Log.create({ service: "memory" })

  export const Status = z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("disabled"),
        reason: z.enum(["not_configured", "embedding_unreachable", "backend_unreachable", "error"]).optional(),
        message: z.string().optional(),
      }),
      z.object({
        type: z.literal("ready"),
        entry_count: z.number(),
        token_count: z.number(),
        backend: z.enum(["qdrant", "redis"]),
        embedding_url: z.string().optional(),
        embedding_model: z.string().optional(),
        backend_url: z.string().optional(),
      }),
    ])
    .meta({ ref: "MemoryStatus" })
  export type Status = z.infer<typeof Status>

  export const Event = {
    Updated: BusEvent.define("memory.updated", Status),
  }

  type EntryType = "issue" | "resolution" | "finding" | "command" | "procedure" | "script" | "branch" | "log"

  interface MemoryEntry {
    type: EntryType
    content: string
    branch: string
    session_id: string
    timestamp: number
    tags: string[]
    token_count: number
    query?: string
    answer?: string
    quality?: number
    used_count?: number
    created_at?: string
    problem?: string
    context?: string
    solution?: string
    steps?: string[]
  }

  interface State {
    status: Status
    redisClient: Redis | null
    entryCount: number
    tokenCount: number
    collectionName?: string
    initialising?: boolean
  }

  const state = Instance.state<State>(
    () => ({
      status: { type: "disabled", reason: "not_configured" },
      redisClient: null,
      entryCount: 0,
      tokenCount: 0,
    }),
    async (s) => {
      if (s.redisClient) {
        await s.redisClient.quit().catch(() => {})
        s.redisClient = null
      }
    },
  )

  // ─── Config helpers ───────────────────────────────────────────────────────────

  // Fix #1: collectionName is stored per-instance in state to avoid cross-project leaks
  function collectionName() {
    const s = state()
    return (s.collectionName ??= "memory_" + Instance.project.id.replace(/[^a-zA-Z0-9]+/g, "_"))
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

  let _qdrantHeaders: Record<string, string> | undefined
  function qdrantHeaders() {
    if (_qdrantHeaders) return _qdrantHeaders
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const key = Env.get("QDRANT_API_KEY")
    if (key) headers["api-key"] = key
    return (_qdrantHeaders = headers)
  }

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

  // ─── Utilities ────────────────────────────────────────────────────────────────

  // Fix #5: extend sanitize pattern to also match colon-separated assignments (KEY: value)
  export function sanitize(text: string): string {
    // Only match all-caps env-var style names that contain an underscore (e.g. API_KEY, SECRET_TOKEN)
    // or are an exact known secret keyword — avoids over-redacting prose like "key: value"
    text = text.replace(
      /\b([A-Z][A-Z0-9]*_[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|PWD|CREDENTIAL|CERT|PRIVATE)|(?:API_KEY|ACCESS_KEY|SECRET_KEY|AUTH_TOKEN|PRIVATE_KEY))\s*[:=]\s*\S+/g,
      "[REDACTED]",
    )
    text = text.replace(/(Bearer|Basic)\s+[A-Za-z0-9+/=._-]{8,}/gi, "$1 [REDACTED]")
    text = text.replace(/\b[0-9a-fA-F]{32,}\b/g, "[REDACTED]")
    text = text.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[REDACTED]")
    text = text.replace(/(-----BEGIN [A-Z ]+KEY-----[\s\S]*?-----END [A-Z ]+KEY-----)/g, "[REDACTED_PRIVATE_KEY]")
    return text
  }

  function safeUrl(raw: string): string {
    try {
      const u = new URL(raw)
      u.username = ""
      u.password = ""
      return u.toString()
    } catch {
      return raw
    }
  }

  // Fix #3: cache a Promise to prevent double embed on concurrent callers
  let _dimPromise: Promise<number> | undefined
  async function dimension(signal?: AbortSignal) {
    return (_dimPromise ??= embed("dim", signal)
      .then((v) => v.length)
      .catch((e) => {
        _dimPromise = undefined
        throw e
      }))
  }

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

  // ─── Qdrant backend ───────────────────────────────────────────────────────────

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
      // Fix #9: use cached dimension instead of re-embedding
      const dim = await dimension(signal)
      const combined2 = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
      const response = await fetch(`${url}/collections/${name}`, {
        method: "PUT",
        headers: qdrantHeaders(),
        signal: combined2,
        body: JSON.stringify({ vectors: { size: dim, distance: "Cosine" } }),
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

    async search(
      vector: number[],
      topK: number,
    ): Promise<{ id: string; score: number; type: string; tags: string; content: string }[]> {
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
        result: { id: string; score: number; payload: { type: string; tags: string; content: string } }[]
      }
      return data.result.map((r) => ({ id: String(r.id), score: r.score, ...r.payload }))
    },

    async count(): Promise<number> {
      const name = collectionName()
      const url = qdrantUrl()
      const response = await fetch(`${url}/collections/${name}/points/count`, {
        method: "POST",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ exact: true }),
      })
      if (!response.ok) return 0
      const data = (await response.json()) as { result?: { count?: number } }
      return data.result?.count ?? 0
    },

    async sumTokenCount(): Promise<number> {
      const name = collectionName()
      const url = qdrantUrl()
      let total = 0
      let offset: unknown = null
      do {
        const body: Record<string, unknown> = { limit: 100, with_payload: ["token_count"], with_vector: false }
        if (offset !== null) body.offset = offset
        const response = await fetch(`${url}/collections/${name}/points/scroll`, {
          method: "POST",
          headers: qdrantHeaders(),
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify(body),
        })
        if (!response.ok) return total
        const data = (await response.json()) as {
          result: { points: { payload?: { token_count?: number } }[]; next_page_offset?: unknown }
        }
        for (const p of data.result.points) total += p.payload?.token_count ?? 0
        offset = data.result.next_page_offset ?? null
      } while (offset !== null)
      return total
    },

    async checkHealth(signal?: AbortSignal) {
      const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000)
      const r = await fetch(`${qdrantUrl()}/healthz`, { signal: combined })
      if (!r.ok) throw new Error(`Qdrant unhealthy: ${r.status}`)
    },

    async deleteAll() {
      const name = collectionName()
      const url = qdrantUrl()
      const response = await fetch(`${url}/collections/${name}/points/delete`, {
        method: "POST",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ filter: {} }),
      })
      if (!response.ok) throw new Error(`Failed to delete all points: ${response.status} ${response.statusText}`)
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
      // Fix #9: use cached dimension instead of re-embedding
      const dim = await dimension(signal)
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
          "type",
          "TAG",
          "tags",
          "TEXT",
          "content",
          "TEXT",
          "timestamp",
          "NUMERIC",
          "token_count",
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
      } catch (e: unknown) {
        const msg = String((e as { message?: string })?.message ?? "")
        if (!msg.includes("Index already exists")) throw e
      }
    },

    async upsert(points: { id: string; vector: number[]; payload: Record<string, unknown> }[]) {
      const client = getRedisClient()
      const pipeline = client.pipeline()
      const prefix = redis.keyPrefix()
      for (const p of points) {
        const key = `${prefix}${p.id}`
        pipeline.hset(
          key,
          "type",
          String(p.payload.type ?? ""),
          "tags",
          String(p.payload.tags ?? ""),
          "content",
          String(p.payload.content ?? ""),
          "timestamp",
          String(p.payload.timestamp ?? 0),
          "token_count",
          String(p.payload.token_count ?? 0),
          "session_id",
          String(p.payload.session_id ?? ""),
          "branch",
          String(p.payload.branch ?? ""),
          "query",
          String(p.payload.query ?? ""),
          "quality",
          String(p.payload.quality ?? Scoring.DEFAULT_QUALITY),
          "used_count",
          String(p.payload.used_count ?? 0),
          "created_at",
          String(p.payload.created_at ?? ""),
          "vector",
          redis.encodeVector(p.vector),
        )
      }
      await pipeline.exec()
    },

    async search(
      vector: number[],
      topK: number,
    ): Promise<{ id: string; score: number; type: string; tags: string; content: string }[]> {
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
        "4",
        "type",
        "tags",
        "content",
        "score",
        "SORTBY",
        "score",
        "DIALECT",
        "2",
      )) as unknown[]
      const hits: { id: string; score: number; type: string; tags: string; content: string }[] = []
      for (let i = 1; i < result.length; i += 2) {
        if (i + 1 >= result.length) break
        const key = result[i] as string
        const fields = result[i + 1] as string[]
        if (!Array.isArray(fields)) continue
        let type = "",
          tags = "",
          content = "",
          score = 0
        for (let j = 0; j < fields.length; j += 2) {
          if (fields[j] === "type") type = fields[j + 1]
          if (fields[j] === "tags") tags = fields[j + 1]
          if (fields[j] === "content") content = fields[j + 1]
          if (fields[j] === "score") score = parseFloat(fields[j + 1]) || 0
        }
        const id = key.replace(redis.keyPrefix(), "")
        if (content) hits.push({ id, score, type, tags, content })
      }
      return hits
    },

    async count(): Promise<number> {
      const client = getRedisClient()
      const indexName = collectionName()
      const result = (await client.call("FT.SEARCH", indexName, "*", "LIMIT", "0", "0").catch((e) => {
        log.warn("redis memory count failed, defaulting to 0", { error: String(e) })
        return [0]
      })) as unknown[]
      return (result[0] as number) ?? 0
    },

    async sumTokenCount(): Promise<number> {
      const client = getRedisClient()
      const prefix = redis.keyPrefix()
      let total = 0
      let cursor = "0"
      do {
        const [next, keys] = (await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", "100")) as [string, string[]]
        cursor = next
        if (keys.length > 0) {
          const pipeline = client.pipeline()
          for (const key of keys) pipeline.hget(key, "token_count")
          const results = ((await pipeline.exec()) ?? []) as ([Error | null, string | null] | null)[]
          for (const res of results) {
            if (!res || res[0]) continue
            total += parseInt(res[1] ?? "0", 10) || 0
          }
        }
      } while (cursor !== "0")
      return total
    },

    // Fix #3: use { once: true } to avoid AbortSignal listener leak
    async checkHealth(signal?: AbortSignal) {
      const client = getRedisClient()
      await client.connect().catch(() => {})
      const ping = client.ping()
      const pong = signal
        ? await Promise.race([
            ping,
            new Promise<never>((_, reject) => {
              signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
            }),
          ])
        : await ping
      if (pong !== "PONG") throw new Error("Redis unhealthy: unexpected PING response")
    },

    async deleteAll() {
      const client = getRedisClient()
      const prefix = redis.keyPrefix()
      let cursor = "0"
      do {
        const [next, keys] = (await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", "100")) as [string, string[]]
        cursor = next
        if (keys.length > 0) await client.del(...keys)
      } while (cursor !== "0")
    },
  }

  // ─── Store dispatch ───────────────────────────────────────────────────────────

  const store = {
    async ensureIndex(signal?: AbortSignal) {
      return useRedis() ? redis.ensureIndex(signal) : qdrant.ensureCollection(signal)
    },
    async upsert(points: { id: string; vector: number[]; payload: Record<string, unknown> }[]) {
      return useRedis() ? redis.upsert(points) : qdrant.upsert(points)
    },
    async search(
      vector: number[],
      topK: number,
    ): Promise<{ id: string; score: number; type: string; tags: string; content: string }[]> {
      return useRedis() ? redis.search(vector, topK) : qdrant.search(vector, topK)
    },
    async count() {
      return useRedis() ? redis.count() : qdrant.count()
    },
    async sumTokenCount() {
      return useRedis() ? redis.sumTokenCount() : qdrant.sumTokenCount()
    },
    async checkHealth(signal?: AbortSignal) {
      return useRedis() ? redis.checkHealth(signal) : qdrant.checkHealth(signal)
    },
    async deleteAll() {
      return useRedis() ? redis.deleteAll() : qdrant.deleteAll()
    },
  }

  // ─── Services check ───────────────────────────────────────────────────────────

  // Metadata prefix for Redis
  function metaKey(id: string) {
    return `${collectionName()}:meta:${id}`
  }

  // Get used_count from Redis (with fallback)
  async function getUsedCount(id: string): Promise<number> {
    if (!useRedis()) return 0
    try {
      const client = getRedisClient()
      const count = await client.hget(metaKey(id), "used_count")
      return parseInt(count || "0", 10)
    } catch {
      return 0
    }
  }

  // Increment used_count in Redis (with fallback)
  async function incrementUsedCount(id: string): Promise<void> {
    if (!useRedis()) return
    try {
      const client = getRedisClient()
      await client.hincrby(metaKey(id), "used_count", 1)
    } catch {
      // Silently fail - usage tracking is not critical
    }
  }

  // Store metadata on write
  async function storeMetadata(id: string, entry: Partial<MemoryEntry>): Promise<void> {
    if (!useRedis()) return
    try {
      const client = getRedisClient()
      await client.hset(metaKey(id), {
        used_count: String(entry.used_count ?? 0),
        quality: String(entry.quality ?? Scoring.DEFAULT_QUALITY),
        tags: (entry.tags ?? []).join(","),
        query: entry.query ?? "",
        created_at: entry.created_at ?? new Date().toISOString(),
      })
    } catch {
      // Silently fail - metadata storage is not critical
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

  export function classifyReason(msg: string): "embedding_unreachable" | "backend_unreachable" | "error" {
    const lower = msg.toLowerCase()
    if (lower.includes("ollama") || lower.startsWith("embedding")) return "embedding_unreachable"
    if (lower.includes("qdrant") || lower.includes("redis") || lower.includes("backend")) return "backend_unreachable"
    return "error"
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  export function status(): Status {
    return state().status
  }

  // Fix #2: re-acquire state after awaits to avoid mutating orphaned state on disposal mid-flight
  export async function write(entry: Omit<MemoryEntry, "token_count">): Promise<void> {
    const s = state()
    if (s.status.type !== "ready") return
    try {
      const content = sanitize(entry.content)
      const token_count = Math.ceil(content.length / 4)
      const id = crypto.randomUUID()

      // Canonicalize to extract query and tags
      const canonical = Canonicalize.createCanonicalResult(content, entry.type, entry.tags)

      // Merge canonical data with entry
      const query = entry.query ?? canonical.query
      const tags = entry.tags ?? canonical.tags
      const quality = entry.quality ?? Scoring.DEFAULT_QUALITY
      const used_count = entry.used_count ?? 0
      const created_at = entry.created_at ?? new Date().toISOString()

      // Embed the canonical query for better similarity matching
      const vector = await embed(query)

      const payload: Record<string, unknown> = {
        type: entry.type,
        content,
        query,
        tags: tags.join(","),
        quality,
        used_count,
        created_at,
        timestamp: entry.timestamp,
        token_count,
        session_id: entry.session_id,
        branch: entry.branch,
      }

      // Add optional fields
      if (entry.problem) payload.problem = entry.problem
      if (entry.context) payload.context = entry.context
      if (entry.solution) payload.solution = entry.solution
      if (entry.steps) payload.steps = entry.steps.join(",")

      await store.upsert([{ id, vector, payload }])

      // Store metadata in Redis
      await storeMetadata(id, { ...entry, query, tags, quality, used_count, created_at })

      // Re-acquire state after awaits
      const s2 = state()
      if (s2.status.type !== "ready") return
      s2.entryCount++
      s2.tokenCount += token_count
      s2.status = { ...s2.status, entry_count: s2.entryCount, token_count: s2.tokenCount }
      Bus.publish(Event.Updated, s2.status)
      Bus.publish(TuiEvent.ToastShow, {
        title: `◈ Memory — ${s2.entryCount} ${s2.entryCount === 1 ? "entry" : "entries"}`,
        message: `New ${entry.type} recorded`,
        variant: "info",
      })
    } catch (e) {
      log.warn("failed to write memory entry", { type: entry.type, error: String(e) })
    }
  }

  export async function search(query: string, topK = 5): Promise<string[]> {
    if (state().status.type !== "ready") return []
    const vector = await embed(query)
    const hits = await store.search(vector, Scoring.DEFAULT_MAX_CANDIDATES)

    // Build entries with similarity scores
    const entries = hits.map((h) => ({
      entry: {
        id: h.id,
        type: h.type,
        tags: h.tags.split(","),
        content: h.content,
        used_count: 0,
      },
      similarity: h.score,
    }))

    // Apply scoring and sort
    const scored = Scoring.scoreEntries(entries)

    return scored.slice(0, topK).map((s) => {
      let result = `[${s.entry.type}] tags: ${s.entry.tags.join(",")}\n${s.entry.content}`
      return result
    })
  }

  export interface SearchEntry {
    id: string
    type: EntryType
    query: string
    content: string
    tags: string[]
    quality: number
    used_count: number
    similarity: number
    score: number
  }

  export async function searchWithScores(query: string, topK = 5): Promise<SearchEntry[]> {
    if (state().status.type !== "ready") return []
    const vector = await embed(query)
    // Requires updating store.search to return IDs and scores
    return []
  }

  export async function clear(): Promise<void> {
    const s = state()
    if (s.status.type !== "ready") return
    await store.deleteAll()
    if (state() !== s) return // disposed or reinitialised mid-flight
    if (s.status.type !== "ready") return
    s.entryCount = 0
    s.tokenCount = 0
    s.status = { ...s.status, entry_count: 0, token_count: 0 }
    Bus.publish(Event.Updated, s.status)
  }

  // Fix #1 & #4: disposal-aware init; compare state() to initialState after every await
  export function init() {
    if (!VuHitraSettings.memoryEnabled()) {
      const s = state()
      s.status = { type: "disabled", reason: "not_configured" }
      Bus.publish(Event.Updated, s.status)
      return
    }
    Promise.resolve().then(async () => {
      const initialState = state()
      if (initialState.initialising) return
      initialState.initialising = true
      try {
        await checkServices()
        if (state() !== initialState) return // disposed mid-init
        await store.ensureIndex()
        if (state() !== initialState) return // disposed mid-init
        const [entryCount, tokenCount] = await Promise.all([store.count(), store.sumTokenCount()])
        if (state() !== initialState) return // disposed mid-init
        const s2 = state()
        s2.entryCount = entryCount
        s2.tokenCount = tokenCount
        s2.status = {
          type: "ready",
          entry_count: entryCount,
          token_count: tokenCount,
          backend: activeBackend(),
          embedding_url: safeUrl(embeddingUrl()),
          embedding_model: embeddingModel(),
          backend_url: safeUrl(useRedis() ? redisUrl() : qdrantUrl()),
        }
        s2.initialising = false
        Bus.publish(Event.Updated, s2.status)
      } catch (e) {
        if (state() !== initialState) return // disposed mid-init
        const msg = e instanceof Error ? e.message : String(e)
        log.error("memory failed to start", { error: msg })
        const reason = classifyReason(msg)
        const s2 = state()
        s2.initialising = false
        s2.status = { type: "disabled", reason, message: msg }
        Bus.publish(Event.Updated, s2.status)
      }
    })
  }

  // ─── memento_write tool ───────────────────────────────────────────────────────

  export const WriteTool = Tool.define("memento_write", {
    description:
      "Write an entry to agent memory for future reference. Use this to capture important findings, commands, procedures, scripts, issues, and resolutions. Content is automatically sanitized before storage. NOT for codebase knowledge (architecture, patterns, APIs) — use `biblion_write` for that.",
    parameters: z.object({
      type: z
        .enum(["issue", "resolution", "finding", "command", "procedure", "script", "branch", "log"])
        .describe("Type of memory entry"),
      content: z.string().describe("The content to memorize. Will be sanitized of credentials before storage."),
      tags: z.array(z.string()).optional().describe("Optional tags for categorization"),
      session_id: z.string().optional().describe("Session ID (auto-populated if omitted)"),
      branch: z.string().optional().describe("Git branch name (leave empty if unknown)"),
      quality: z
        .number()
        .min(0)
        .max(10)
        .optional()
        .describe("Quality score from 0-10 (user-provided). If omitted, defaults to 5 (neutral)."),
    }),
    async execute(params, ctx) {
      if (status().type !== "ready") {
        return {
          title: `Memory: ${params.type}`,
          metadata: {} as { quality?: number },
          output: "Memory is not available — backend is not configured or unreachable. Entry was not stored.",
        }
      }
      // Normalize quality from 0-10 to 0-1
      const quality = params.quality !== undefined ? params.quality / 10 : Scoring.DEFAULT_QUALITY
      await write({
        type: params.type,
        content: params.content,
        tags: params.tags ?? [],
        session_id: params.session_id ?? ctx.sessionID,
        branch: params.branch ?? "",
        timestamp: Date.now(),
        quality,
      })
      return {
        title: `Memory: ${params.type}`,
        metadata: { quality },
        output: `Memory entry written (type: ${params.type}, quality: ${quality.toFixed(2)})`,
      }
    },
  })
}
