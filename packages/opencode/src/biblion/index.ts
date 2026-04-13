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
import { Question } from "@/question"

export namespace Biblion {
  const log = Log.create({ service: "biblion" })

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
    .meta({ ref: "BiblionStatus" })
  export type Status = z.infer<typeof Status>

  export const Event = {
    Updated: BusEvent.define("biblion.updated", Status),
  }

  type EntryType = "structure" | "pattern" | "dependency" | "api" | "config" | "workflow"

  interface BiblionEntry {
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
    project_id?: string
    project_path?: string
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

  function collectionName() {
    return "biblion_global"
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

  export function sanitize(text: string): string {
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
      projectId?: string,
    ): Promise<
      {
        id: string
        score: number
        type: string
        tags: string
        content: string
        quality?: number
        used_count?: number
        query?: string
        created_at?: string
        project_id?: string
        project_path?: string
      }[]
    > {
      const name = collectionName()
      const url = qdrantUrl()
      const body: Record<string, unknown> = { vector, limit: topK, with_payload: true }
      if (projectId) {
        body.filter = { must: [{ key: "project_id", match: { value: projectId } }] }
      }
      const response = await fetch(`${url}/collections/${name}/points/search`, {
        method: "POST",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`Qdrant search failed: ${response.status} ${response.statusText}`)
      const data = (await response.json()) as {
        result: { id: string; score: number; payload: Record<string, unknown> }[]
      }
      return data.result.map(
        (r) =>
          ({ id: String(r.id), score: r.score, ...r.payload }) as {
            id: string
            score: number
            type: string
            tags: string
            content: string
            quality?: number
            used_count?: number
            query?: string
            created_at?: string
            project_id?: string
            project_path?: string
          },
      )
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

    async deleteByProject(projectId: string) {
      const name = collectionName()
      const url = qdrantUrl()
      const response = await fetch(`${url}/collections/${name}/points/delete`, {
        method: "POST",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ filter: { must: [{ key: "project_id", match: { value: projectId } }] } }),
      })
      if (!response.ok) throw new Error(`Failed to delete project points: ${response.status} ${response.statusText}`)
    },

    async delete(id: string) {
      const name = collectionName()
      const url = qdrantUrl()
      const response = await fetch(`${url}/collections/${name}/points/delete`, {
        method: "POST",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ points: [id] }),
      })
      if (!response.ok) throw new Error(`Failed to delete point: ${response.status} ${response.statusText}`)
    },

    async updateQuality(id: string, quality: number) {
      if (quality < 0 || quality > 1) {
        throw new Error(`quality must be between 0 and 1, got ${quality}`)
      }
      const name = collectionName()
      const url = qdrantUrl()
      const response = await fetch(`${url}/collections/${name}/points/payload`, {
        method: "POST",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ payload: { quality }, points: [id] }),
      })
      if (!response.ok) throw new Error(`Failed to update quality: ${response.status} ${response.statusText}`)
    },

    async list(): Promise<
      { id: string; type: string; tags: string; content: string; project_id?: string; project_path?: string }[]
    > {
      const name = collectionName()
      const url = qdrantUrl()
      const response = await fetch(`${url}/collections/${name}/points/scroll`, {
        method: "POST",
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ limit: 1000, with_payload: true, with_vector: false }),
      })
      if (!response.ok) throw new Error(`Failed to list points: ${response.status} ${response.statusText}`)
      const data = (await response.json()) as {
        result: {
          points: {
            id: string
            payload: { type: string; tags: string; content: string; project_id?: string; project_path?: string }
          }[]
          next_page_offset?: unknown
        }
      }
      if (data.result.next_page_offset != null)
        log.warn("biblion list truncated at 1000 entries; not all entries returned")
      return data.result.points.map((p) => ({ id: String(p.id), ...p.payload }))
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
          "project_id",
          "TAG",
          "project_path",
          "TEXT",
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
          "project_id",
          String(p.payload.project_id ?? ""),
          "project_path",
          String(p.payload.project_path ?? ""),
          "vector",
          redis.encodeVector(p.vector),
        )
      }
      await pipeline.exec()
    },

    async search(
      vector: number[],
      topK: number,
      projectId?: string,
    ): Promise<
      {
        id: string
        score: number
        type: string
        tags: string
        content: string
        quality?: number
        used_count?: number
        query?: string
        created_at?: string
        project_id?: string
        project_path?: string
      }[]
    > {
      const client = getRedisClient()
      const indexName = collectionName()
      const vecBuf = redis.encodeVector(vector)
      // Escape special chars for Redis TAG filter (project IDs are typically UUIDs/simple strings)
      const knnQuery = projectId
        ? `(@project_id:{${projectId.replace(/[-]/g, "\\-")}})=>[KNN ${topK} @vector $vec AS score]`
        : `*=>[KNN ${topK} @vector $vec AS score]`
      const result = (await client.call(
        "FT.SEARCH",
        indexName,
        knnQuery,
        "PARAMS",
        "2",
        "vec",
        vecBuf,
        "RETURN",
        "11",
        "type",
        "tags",
        "content",
        "score",
        "quality",
        "used_count",
        "created_at",
        "query",
        "project_id",
        "project_path",
        "id",
        "SORTBY",
        "score",
        "DIALECT",
        "2",
      )) as unknown[]
      const hits: {
        id: string
        score: number
        type: string
        tags: string
        content: string
        quality?: number
        used_count?: number
        query?: string
        created_at?: string
        project_id?: string
        project_path?: string
      }[] = []
      for (let i = 1; i < result.length; i += 2) {
        if (i + 1 >= result.length) break
        const docId = result[i] as string
        const fields = result[i + 1] as string[]
        if (!Array.isArray(fields)) continue
        let type = "",
          tags = "",
          content = "",
          scoreStr = "0",
          qualityStr = "",
          usedCountStr = "",
          query = "",
          created_at = "",
          project_id = "",
          project_path = ""
        for (let j = 0; j < fields.length; j += 2) {
          if (fields[j] === "type") type = fields[j + 1]
          if (fields[j] === "tags") tags = fields[j + 1]
          if (fields[j] === "content") content = fields[j + 1]
          if (fields[j] === "score") scoreStr = fields[j + 1]
          if (fields[j] === "quality") qualityStr = fields[j + 1]
          if (fields[j] === "used_count") usedCountStr = fields[j + 1]
          if (fields[j] === "query") query = fields[j + 1]
          if (fields[j] === "created_at") created_at = fields[j + 1]
          if (fields[j] === "project_id") project_id = fields[j + 1]
          if (fields[j] === "project_path") project_path = fields[j + 1]
        }
        const prefix = redis.keyPrefix()
        const id = typeof docId === "string" && docId.startsWith(prefix) ? docId.slice(prefix.length) : String(docId)
        // Redis KNN returns cosine distance (0=identical, 2=opposite); convert to similarity
        const dist = parseFloat(scoreStr) || 0
        const score = 1 - dist / 2
        if (content)
          hits.push({
            id,
            score,
            type,
            tags,
            content,
            quality: qualityStr !== "" ? parseFloat(qualityStr) : undefined,
            used_count: usedCountStr !== "" ? parseInt(usedCountStr, 10) : undefined,
            query: query || undefined,
            created_at: created_at || undefined,
            project_id: project_id || undefined,
            project_path: project_path || undefined,
          })
      }
      return hits
    },

    async count(): Promise<number> {
      const client = getRedisClient()
      const indexName = collectionName()
      const result = (await client.call("FT.SEARCH", indexName, "*", "LIMIT", "0", "0").catch((e) => {
        log.warn("redis biblion count failed, defaulting to 0", { error: String(e) })
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
      const collection = collectionName()
      // Delete both point keys and metadata keys
      const patterns = [`${collection}:point:*`, `${collection}:meta:*`]
      for (const pattern of patterns) {
        let cursor = "0"
        do {
          const [next, keys] = (await client.scan(cursor, "MATCH", pattern, "COUNT", "100")) as [string, string[]]
          cursor = next
          if (keys.length > 0) await client.del(...keys)
        } while (cursor !== "0")
      }
    },

    async deleteByProject(projectId: string) {
      const client = getRedisClient()
      const prefix = redis.keyPrefix()
      const collection = collectionName()
      let cursor = "0"
      do {
        const [next, keys] = (await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", "100")) as [string, string[]]
        cursor = next
        if (keys.length > 0) {
          const pipeline = client.pipeline()
          for (const key of keys) pipeline.hget(key, "project_id")
          const results = ((await pipeline.exec()) ?? []) as ([Error | null, string | null] | null)[]
          const toDelete: string[] = []
          for (let i = 0; i < keys.length; i++) {
            const res = results[i]
            if (!res || res[0]) continue
            if (res[1] === projectId) {
              toDelete.push(keys[i])
              const id = keys[i].startsWith(prefix) ? keys[i].slice(prefix.length) : keys[i]
              toDelete.push(`${collection}:meta:${id}`)
            }
          }
          if (toDelete.length > 0) await client.del(...toDelete)
        }
      } while (cursor !== "0")
    },

    async delete(id: string) {
      const client = getRedisClient()
      const prefix = redis.keyPrefix()
      await client.del(`${prefix}${id}`)
    },

    async updateQuality(id: string, quality: number) {
      if (quality < 0 || quality > 1) {
        throw new Error(`quality must be between 0 and 1, got ${quality}`)
      }
      const client = getRedisClient()
      const prefix = redis.keyPrefix()
      const pipeline = client.pipeline()
      pipeline.hset(`${prefix}${id}`, "quality", String(quality))
      pipeline.hset(`${collectionName()}:meta:${id}`, "quality", String(quality))
      await pipeline.exec()
    },

    async list(): Promise<
      { id: string; type: string; tags: string; content: string; project_id?: string; project_path?: string }[]
    > {
      const client = getRedisClient()
      const prefix = redis.keyPrefix()
      const entries: {
        id: string
        type: string
        tags: string
        content: string
        project_id?: string
        project_path?: string
      }[] = []
      let cursor = "0"
      do {
        const [next, keys] = (await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", "100")) as [string, string[]]
        cursor = next
        if (keys.length > 0) {
          const pipeline = client.pipeline()
          for (const key of keys) pipeline.hgetall(key)
          const results = ((await pipeline.exec()) ?? []) as ([Error | null, Record<string, string>] | null)[]
          for (let i = 0; i < keys.length; i++) {
            const res = results[i]
            if (!res || res[0]) continue
            const fields = res[1]
            const id = keys[i].startsWith(prefix) ? keys[i].slice(prefix.length) : keys[i]
            entries.push({
              id,
              type: fields.type ?? "",
              tags: fields.tags ?? "",
              content: fields.content ?? "",
              project_id: fields.project_id || undefined,
              project_path: fields.project_path || undefined,
            })
          }
        }
      } while (cursor !== "0")
      return entries
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
      projectId?: string,
    ): Promise<
      {
        id: string
        score: number
        type: string
        tags: string
        content: string
        quality?: number
        used_count?: number
        query?: string
        created_at?: string
        project_id?: string
        project_path?: string
      }[]
    > {
      return useRedis() ? redis.search(vector, topK, projectId) : qdrant.search(vector, topK, projectId)
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
    async deleteByProject(projectId: string) {
      return useRedis() ? redis.deleteByProject(projectId) : qdrant.deleteByProject(projectId)
    },
    async delete(id: string) {
      return useRedis() ? redis.delete(id) : qdrant.delete(id)
    },
    async updateQuality(id: string, quality: number) {
      return useRedis() ? redis.updateQuality(id, quality) : qdrant.updateQuality(id, quality)
    },
    async list() {
      return useRedis() ? redis.list() : qdrant.list()
    },
  }

  // ─── Metadata helpers (Redis-based) ──────────────────────────────────────────

  function metaKey(id: string) {
    return `${collectionName()}:meta:${id}`
  }

  async function getUsedCount(id: string): Promise<number> {
    if (!useRedis()) return 0
    try {
      const client = getRedisClient()
      const count = await client.hget(metaKey(id), "used_count")
      return parseInt(count || "0", 10)
    } catch (e) {
      log.warn("failed to get used_count from redis", { id, error: String(e) })
      return 0
    }
  }

  async function incrementUsedCount(id: string): Promise<void> {
    if (!useRedis()) return
    try {
      const client = getRedisClient()
      await client.hincrby(metaKey(id), "used_count", 1)
    } catch (e) {
      log.warn("failed to increment used_count in redis", { id, error: String(e) })
    }
  }

  async function storeMetadata(id: string, entry: Partial<BiblionEntry>): Promise<void> {
    if (!useRedis()) return
    try {
      const client = getRedisClient()
      await client.hset(metaKey(id), {
        used_count: String(entry.used_count ?? 0),
        quality: String(entry.quality ?? Scoring.DEFAULT_QUALITY),
        tags: (entry.tags ?? []).join(","),
        query: entry.query ?? "",
        created_at: entry.created_at ?? new Date().toISOString(),
        project_id: entry.project_id ?? "",
        project_path: entry.project_path ?? "",
      })
    } catch (e) {
      log.warn("failed to store metadata in redis", { id, error: String(e) })
    }
  }

  // ─── Services check ───────────────────────────────────────────────────────────

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

  export async function write(entry: Omit<BiblionEntry, "token_count">): Promise<string | undefined> {
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
      const tags = entry.tags?.length ? entry.tags : canonical.tags
      const quality = entry.quality ?? Scoring.DEFAULT_QUALITY
      const used_count = entry.used_count ?? 0
      const created_at = entry.created_at ?? new Date().toISOString()

      // Embed the canonical query for better similarity matching
      const vector = await embed(query)

      // Deduplication: skip if a sufficiently similar entry already exists
      const similar = await store.search(vector, 1)
      if (similar.length > 0 && similar[0].score >= VuHitraSettings.cacheDedupThreshold()) {
        log.info("dedup: biblion entry skipped (duplicate)", { score: similar[0].score, existingId: similar[0].id })
        return
      }

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
        project_id: Instance.project.id,
        project_path: Instance.directory,
      }

      if (entry.problem) payload.problem = entry.problem
      if (entry.context) payload.context = entry.context
      if (entry.solution) payload.solution = entry.solution
      if (entry.steps) payload.steps = entry.steps.join(",")

      await store.upsert([{ id, vector, payload }])

      // Store metadata in Redis
      await storeMetadata(id, { ...entry, query, tags, quality, used_count, created_at })

      // Re-acquire state after awaits to avoid mutating orphaned state on disposal mid-flight
      const s2 = state()
      if (s2.status.type !== "ready") return // disposed mid-flight
      s2.entryCount++
      s2.tokenCount += token_count
      s2.status = { ...s2.status, entry_count: s2.entryCount, token_count: s2.tokenCount }
      Bus.publish(Event.Updated, s2.status)
      Bus.publish(TuiEvent.ToastShow, {
        title: `◈ Biblion — ${s2.entryCount} ${s2.entryCount === 1 ? "entry" : "entries"}`,
        message: `New ${entry.type} recorded`,
        variant: "info",
      })
      return id
    } catch (e) {
      log.warn("failed to write biblion entry", { type: entry.type, error: String(e) })
      return
    }
  }

  export async function search(query: string, topK = 5): Promise<string[]> {
    const results = await searchWithScores(query, topK)
    return results.map((s) => `[${s.type}] tags: ${s.tags.join(",")}\n${s.content}`)
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
    project_id?: string
    project_path?: string
  }

  export async function searchWithScores(query: string, topK = 5, projectId?: string): Promise<SearchEntry[]> {
    if (state().status.type !== "ready") return []
    const vector = await embed(query)
    const hits = await store.search(vector, VuHitraSettings.cacheMaxCandidates(), projectId)

    // For Redis backend, fetch fresh used_count from meta keys in parallel
    const usedCounts = useRedis()
      ? await Promise.all(hits.map((h) => getUsedCount(h.id)))
      : hits.map((h) => h.used_count ?? 0)

    const entries = hits.map((h, i) => ({
      entry: {
        id: h.id,
        type: h.type as EntryType,
        query: h.query ?? "",
        content: h.content,
        tags: h.tags.split(",").filter(Boolean),
        quality: h.quality ?? Scoring.DEFAULT_QUALITY,
        used_count: usedCounts[i],
        project_id: h.project_id,
        project_path: h.project_path,
      },
      similarity: h.score,
    }))

    const scored = Scoring.scoreEntries(entries, {
      similarityWeight: VuHitraSettings.cacheSimilarityWeight(),
      usageWeight: VuHitraSettings.cacheUsageWeight(),
    })

    // Increment used_count for top results (non-blocking)
    scored.slice(0, topK).forEach((s) => {
      incrementUsedCount(s.entry.id).catch((e) =>
        Log.Default.warn("failed to increment used_count", { error: String(e) }),
      )
    })

    return scored.slice(0, topK).map((s) => ({
      id: s.entry.id,
      type: s.entry.type,
      query: s.entry.query,
      content: s.entry.content,
      tags: s.entry.tags,
      quality: s.entry.quality,
      used_count: s.entry.used_count,
      similarity: s.similarity,
      score: s.score,
      project_id: s.entry.project_id,
      project_path: s.entry.project_path,
    }))
  }

  export async function list(): Promise<
    { id: string; type: string; tags: string; content: string; project_id?: string; project_path?: string }[]
  > {
    if (state().status.type !== "ready") return []
    return store.list()
  }

  export async function deleteEntry(id: string): Promise<void> {
    const s = state()
    if (s.status.type !== "ready") return
    await store.delete(id)
    if (state() !== s) return // disposed mid-flight
    if (s.status.type !== "ready") return // status changed mid-flight
    s.entryCount = Math.max(0, s.entryCount - 1)
    // note: per-entry token_count is not stored in state, so token_count may drift slightly after individual deletes
    s.status = { ...s.status, entry_count: s.entryCount }
    Bus.publish(Event.Updated, s.status)
  }

  export async function updateQuality(id: string, quality: number): Promise<void> {
    if (state().status.type !== "ready") return
    try {
      await store.updateQuality(id, quality)
    } catch (e) {
      log.warn("failed to update biblion entry quality", { id, error: String(e) })
    }
  }

  export async function clear(projectId?: string): Promise<void> {
    const s = state()
    if (s.status.type !== "ready") return
    await store.deleteByProject(projectId ?? Instance.project.id)
    if (state() !== s) return
    if (s.status.type !== "ready") return
    const [entryCount, tokenCount] = await Promise.all([store.count(), store.sumTokenCount()])
    if (state() !== s) return
    if (s.status.type !== "ready") return
    s.entryCount = entryCount
    s.tokenCount = tokenCount
    s.status = { ...s.status, entry_count: entryCount, token_count: tokenCount }
    Bus.publish(Event.Updated, s.status)
  }

  export async function clearAll(): Promise<void> {
    const s = state()
    if (s.status.type !== "ready") return
    await store.deleteAll()
    if (state() !== s) return
    if (s.status.type !== "ready") return
    s.entryCount = 0
    s.tokenCount = 0
    s.status = { ...s.status, entry_count: 0, token_count: 0 }
    Bus.publish(Event.Updated, s.status)
  }

  export function init() {
    if (!VuHitraSettings.biblionEnabled()) {
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
        if (state() !== initialState) return
        await store.ensureIndex()
        if (state() !== initialState) return
        const [entryCount, tokenCount] = await Promise.all([store.count(), store.sumTokenCount()])
        if (state() !== initialState) return
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
        if (state() !== initialState) return
        const msg = e instanceof Error ? e.message : String(e)
        log.error("biblion failed to start", { error: msg })
        const reason = classifyReason(msg)
        const s2 = state()
        s2.initialising = false
        s2.status = { type: "disabled", reason, message: msg }
        Bus.publish(Event.Updated, s2.status)
      }
    })
  }

  // ─── biblion_write tool ────────────────────────────────────────────────────────

  /**
   * NOTE on biblion_read permission vs. biblion_read tool:
   *
   * biblion_read is a **permission**, NOT a callable tool. There is no "biblion_read" tool
   * exported from this module.
   *
   * When an LLM session is granted `biblion_read` permission, the system will automatically
   * inject biblion search results into the session's context based on the current task.
   * This injection happens transparently — agents do not call a tool to read from biblion;
   * the reading occurs automatically when the permission is present.
   *
   * The `biblion_write` tool below IS a callable tool that requires explicit invocation.
   */

  export const WriteTool = Tool.define("biblion_write", {
    description:
      "Write an entry to the biblion knowledge base for future reference. Use this to capture codebase knowledge about structure, patterns, dependencies, APIs, configurations, and workflows. Content is automatically sanitized before storage. NOT for operational/procedural agent memory (commands, fixes, logs) — use `memento_write` for that.",
    parameters: z.object({
      type: z
        .enum(["structure", "pattern", "dependency", "api", "config", "workflow"])
        .describe("Type of biblion entry"),
      content: z.string().describe("The content to store. Will be sanitized of credentials before storage."),
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
          title: `Biblion: ${params.type}`,
          metadata: {} as { quality?: number },
          output: "Biblion is not available — backend is not configured or unreachable. Entry was not stored.",
        }
      }
      // Normalize quality from 0-10 to 0-1
      const quality = params.quality !== undefined ? params.quality / 10 : Scoring.DEFAULT_QUALITY
      const entryId = await write({
        type: params.type,
        content: params.content,
        tags: params.tags ?? [],
        session_id: params.session_id ?? ctx.sessionID,
        branch: params.branch ?? "",
        timestamp: Date.now(),
        quality,
      })

      // If no entryId (write failed or was skipped), return early
      if (!entryId) {
        return {
          title: `Biblion: ${params.type}`,
          metadata: {} as { quality?: number },
          output: "Biblion entry was not stored (duplicate or error).",
        }
      }

      // Prompt the user for a quality rating
      try {
        const answers = await Question.ask({
          sessionID: ctx.sessionID,
          questions: [
            {
              question: `Rate the quality of this biblion entry (0-10, where 0=poor, 10=excellent):`,
              header: "Quality Rating",
              options: [
                { label: "10 - Excellent", description: "Highly valuable, well-structured, immediately useful" },
                { label: "8 - Very Good", description: "Valuable content with good structure" },
                { label: "5 - Average", description: "Moderately useful, standard quality" },
                { label: "3 - Below Average", description: "Limited usefulness or needs refinement" },
                { label: "0 - Poor", description: "Low value, consider if entry is needed" },
              ],
              custom: true, // Allow custom input for specific ratings
            },
          ],
        })

        // Parse the answer - it's an array of selected labels
        const answer = answers[0]?.[0]
        if (answer) {
          // Extract numeric rating from the answer
          let rating: number | undefined

          // Check if it's one of the preset options
          if (answer.includes(" - ")) {
            const numStr = answer.split(" - ")[0]
            rating = parseInt(numStr, 10)
          } else {
            // Try to parse as a direct number
            rating = parseInt(answer, 10)
          }

          // Validate the rating
          if (!isNaN(rating) && rating >= 0 && rating <= 10) {
            const normalizedQuality = rating / 10

            // Update quality in-place on the existing entry (avoids triggering dedup on re-write)
            await updateQuality(entryId, normalizedQuality)

            return {
              title: `Biblion: ${params.type}`,
              metadata: { quality: normalizedQuality },
              output: `Biblion entry written with quality rating ${rating}/10 (${normalizedQuality.toFixed(2)})`,
            }
          } else {
            return {
              title: `Biblion: ${params.type}`,
              metadata: { quality },
              output: "Invalid rating provided. Entry written with default quality.",
            }
          }
        }
      } catch (e) {
        // Question.ask failed (e.g., no UI available), proceed with default quality
        Log.Default.warn("failed to prompt for quality rating", { error: String(e) })
      }

      return {
        title: `Biblion: ${params.type}`,
        metadata: { quality },
        output: `Biblion entry written (type: ${params.type}, quality: ${quality.toFixed(2)})`,
      }
    },
  })
}
