import z from "zod"
import Redis from "ioredis"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Env } from "@/env"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Database, eq } from "@/storage/db"
import { BridgeNodeTable } from "./bridge.sql"
import { SessionTable } from "@/session/session.sql"

export namespace Bridge {
  const log = Log.create({ service: "bridge" })

  // ─── Types ────────────────────────────────────────────────────────────────────

  export const Role = z.enum(["master", "friend"])
  export type Role = z.infer<typeof Role>

  export const NodeStatus = z.enum(["active", "inactive", "locked"])
  export type NodeStatus = z.infer<typeof NodeStatus>

  export const NodeInfo = z.object({
    nodeID: z.string(),
    role: Role,
    sessionID: z.string(),
    slug: z.string(),
    title: z.string(),
    directory: z.string(),
    nodeURL: z.string(),
    heartbeat: z.number(),
    status: NodeStatus,
  })
  export type NodeInfo = z.infer<typeof NodeInfo>

  export const Info = z.object({
    bridgeID: z.string(),
    masterID: z.string(),
    masterSlug: z.string(),
    nodes: z.array(NodeInfo),
    limit: z.number(),
  })
  export type Info = z.infer<typeof Info>

  export const ContextEntry = z.object({
    nodeID: z.string(),
    role: Role,
    directory: z.string(),
    type: z.enum(["finding", "work_summary", "task_result", "status"]),
    content: z.string(),
    timestamp: z.number(),
  })
  export type ContextEntry = z.infer<typeof ContextEntry>

  // ─── Bus events ───────────────────────────────────────────────────────────────

  export const Event = {
    StateChanged: BusEvent.define("bridge.state.changed", Info),
    NodeJoined: BusEvent.define("bridge.node.joined", NodeInfo),
    NodeLeft: BusEvent.define("bridge.node.left", z.object({ nodeID: z.string(), bridgeID: z.string() })),
    ContextShared: BusEvent.define("bridge.context.shared", ContextEntry),
    InputLocked: BusEvent.define("bridge.input.locked", z.object({ locked: z.boolean() })),
    TaskDispatched: BusEvent.define(
      "bridge.task.dispatched",
      z.object({
        targetNodeID: z.string(),
        taskID: z.string(),
        sessionID: z.string(),
        agentName: z.string(),
      }),
    ),
    TaskResult: BusEvent.define(
      "bridge.task.result",
      z.object({
        taskID: z.string(),
        nodeID: z.string(),
        result: z.string(),
        success: z.boolean(),
      }),
    ),
  }

  // ─── State ────────────────────────────────────────────────────────────────────

  interface State {
    bridgeID: string | null
    role: Role | null
    sessionID: string | null
    slug: string | null
    masterInput: string | null
    pubClient: Redis | null
    subClient: Redis | null
    heartbeatTimer: ReturnType<typeof setInterval> | null
    info: Info | null
    inputLocked: boolean
    coordinator: string | null
    lastRefresh: number
    inProgress: Promise<Info> | null
    pendingSessionID: string | null
  }

  const state = Instance.state<State>(
    () => ({
      bridgeID: null,
      role: null,
      sessionID: null,
      slug: null,
      masterInput: null,
      pubClient: null,
      subClient: null,
      heartbeatTimer: null,
      info: null,
      inputLocked: false,
      coordinator: null,
      lastRefresh: 0,
      inProgress: null,
      pendingSessionID: null,
    }),
    async () => {
      initPromise = null
      await leave()
    },
  )

  // ─── Key helpers ──────────────────────────────────────────────────────────────

  function keys(id: string) {
    return {
      master: `bridge:${id}:master`,
      nodes: `bridge:${id}:nodes`,
      context: `bridge:${id}:context`,
      channel: `bridge:${id}:channel`,
      session: (sessionID: string) => `bridge:sessions:${sessionID}`,
    }
  }

  // ─── Redis helpers ────────────────────────────────────────────────────────────

  function toRedisURL(url: string) {
    return url.startsWith("redis://") || url.startsWith("rediss://") ? url : `redis://${url}`
  }

  function makeClient(coordinatorURL?: string): Redis {
    if (coordinatorURL) return new Redis(toRedisURL(coordinatorURL), { lazyConnect: true, enableReadyCheck: false })
    const url = Env.get("REDIS_URL")
    if (url) return new Redis(url, { lazyConnect: true, enableReadyCheck: false })
    const host = Env.get("REDIS_HOST") || "localhost"
    const port = parseInt(Env.get("REDIS_PORT") || "6379", 10) || 6379
    const password = Env.get("REDIS_PASSWORD")
    return new Redis({ host, port, ...(password ? { password } : {}), lazyConnect: true, enableReadyCheck: false })
  }

  export function available(): boolean {
    return !!(Env.get("REDIS_URL") || Env.get("REDIS_HOST") || Env.get("REDIS_PORT") || state().coordinator)
  }

  // ─── State accessors ──────────────────────────────────────────────────────────

  export function bridgeID() {
    return state().bridgeID
  }
  export function role() {
    return state().role
  }
  export function isMaster() {
    return state().role === "master"
  }
  export function isFriend() {
    return state().role === "friend"
  }
  export function isActive() {
    return state().bridgeID !== null
  }
  export function info() {
    return state().info
  }
  export function isInputLocked() {
    return state().inputLocked
  }

  // ─── Pub/sub message handler ──────────────────────────────────────────────────

  async function handleMessage(raw: string) {
    const s = state()
    let msg: { type: string; [key: string]: unknown }
    try {
      msg = JSON.parse(raw)
    } catch {
      log.warn("bridge: failed to parse channel message", { raw })
      return
    }

    if (msg.type === "node.joined") {
      const node = NodeInfo.safeParse(msg.node)
      if (node.success) {
        Bus.publish(Event.NodeJoined, node.data)
        // Auto-lock the joining friend's input if we are the master
        if (s.role === "master" && node.data.role === "friend") {
          setInputLocked(node.data.nodeID, true).catch((e) =>
            log.warn("bridge: auto-lock failed", { error: String(e) }),
          )
        }
      }
    } else if (msg.type === "node.left") {
      const parsed = z.object({ nodeID: z.string() }).safeParse(msg)
      if (parsed.success && s.bridgeID)
        Bus.publish(Event.NodeLeft, { nodeID: parsed.data.nodeID, bridgeID: s.bridgeID })
    } else if (msg.type === "context.shared") {
      const entry = ContextEntry.safeParse(msg.entry)
      if (entry.success) Bus.publish(Event.ContextShared, entry.data)
    } else if (msg.type === "input.locked") {
      const parsed = z.object({ nodeID: z.string(), locked: z.boolean() }).safeParse(msg)
      if (parsed.success) {
        const ls = state()
        if (ls.bridgeID && ls.sessionID && parsed.data.nodeID === ls.sessionID) {
          state().inputLocked = parsed.data.locked
          Bus.publish(Event.InputLocked, { locked: parsed.data.locked })
        }
      }
    } else if (msg.type === "task.dispatched") {
      const parsed = z
        .object({ targetNodeID: z.string(), taskID: z.string(), sessionID: z.string(), agentName: z.string() })
        .safeParse(msg)
      if (parsed.success) Bus.publish(Event.TaskDispatched, parsed.data)
    } else if (msg.type === "task.result") {
      const parsed = z
        .object({ taskID: z.string(), nodeID: z.string(), result: z.string(), success: z.boolean() })
        .safeParse(msg)
      if (parsed.success) Bus.publish(Event.TaskResult, parsed.data)
    } else if (msg.type === "bridge.closed") {
      if (state().role === "friend") await leave()
      return // always skip refresh on bridge.closed
    }

    // Refresh info after all other events
    const now = Date.now()
    const cs = state()
    if (now - cs.lastRefresh >= 1000) {
      cs.lastRefresh = now // pessimistically claim slot to prevent concurrent double-refresh
      const updated = await refreshInfo().catch(() => null)
      if (updated) {
        Bus.publish(Event.StateChanged, updated)
      }
    }
  }

  // ─── Heartbeat ────────────────────────────────────────────────────────────────

  function startHeartbeat(id: string, sessionID: string) {
    const s = state()
    if (s.heartbeatTimer) clearInterval(s.heartbeatTimer)
    s.heartbeatTimer = setInterval(async () => {
      const cs = state()
      if (!cs.pubClient || !cs.bridgeID) return
      const k = keys(id)
      const raw = await cs.pubClient.hget(k.nodes, sessionID).catch(() => null)
      if (!raw) return
      let node: NodeInfo
      try {
        const parsed = NodeInfo.safeParse(JSON.parse(raw))
        if (!parsed.success) return
        node = parsed.data
      } catch {
        return
      }
      const updated: NodeInfo = { ...node, heartbeat: Date.now() }
      await cs.pubClient
        .hset(k.nodes, sessionID, JSON.stringify(updated))
        .catch((e) => log.warn("bridge: heartbeat failed", { error: String(e) }))
    }, 15_000)
  }

  // ─── Build Info ───────────────────────────────────────────────────────────────

  async function buildInfo(pub: Redis, id: string, limit: number): Promise<Info | null> {
    const k = keys(id)
    const [masterRaw, nodesRaw] = await Promise.all([pub.hgetall(k.master), pub.hgetall(k.nodes)])
    if (!masterRaw || !masterRaw.slug) return null
    const masterSlug = masterRaw.slug
    const now = Date.now()
    const nodes = Object.values(nodesRaw ?? {})
      .map((v) => {
        try {
          return NodeInfo.safeParse(JSON.parse(v))
        } catch {
          return { success: false as const, error: null }
        }
      })
      .filter((r): r is { success: true; data: NodeInfo } => r.success)
      .map((r) => r.data)
      .filter((n) => now - n.heartbeat < 60_000)
    return { bridgeID: id, masterID: id, masterSlug, nodes, limit }
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  export async function setMaster(input: {
    sessionID: string
    slug: string
    title: string
    directory: string
    nodeURL: string
    limit?: number
    coordinator?: string
  }): Promise<Info> {
    if (!available() && !input.coordinator) throw new Error("Bridge mode requires Redis. Set REDIS_URL or REDIS_HOST.")

    const s = state()
    // Idempotent if already master for same session — refresh info before returning
    if (s.role === "master" && s.bridgeID === input.sessionID && s.info) return (await refreshInfo()) ?? s.info
    if (s.inProgress) {
      if (s.pendingSessionID === input.sessionID) return s.inProgress
      throw new Error("Bridge operation already in progress for a different session")
    }
    s.pendingSessionID = input.sessionID
    const pending = (async () => {
      if (s.bridgeID) await leave()

      const id = input.sessionID
      const k = keys(id)
      // Configurable via BRIDGE_MAX_NODES env var, defaults to 3
      const limit = input.limit ?? (parseInt(Env.get("BRIDGE_MAX_NODES") ?? "3", 10) || 3)

      const pub = makeClient(input.coordinator)
      const sub = makeClient(input.coordinator)
      await pub.connect()
      await sub.connect()

      try {
        const node: NodeInfo = {
          nodeID: input.sessionID,
          role: "master",
          sessionID: input.sessionID,
          slug: input.slug,
          title: input.title,
          directory: input.directory,
          nodeURL: input.nodeURL,
          heartbeat: Date.now(),
          status: "active",
        }

        await Promise.all([
          pub.hset(k.master, {
            sessionID: input.sessionID,
            slug: input.slug,
            title: input.title,
            directory: input.directory,
            nodeURL: input.nodeURL,
            heartbeat: String(Date.now()),
          }),
          pub.hset(k.nodes, input.sessionID, JSON.stringify(node)),
          pub.set(k.session(input.sessionID), id),
          pub.set(`bridge:${id}:limit`, String(limit)),
          pub.set(`bridge:slug:${input.slug}`, id),
        ])

        await sub.subscribe(k.channel)
        sub.on("message", (_, msg) => {
          handleMessage(msg).catch((e) => log.warn("bridge: message handler error", { error: String(e) }))
        })

        const inf = await buildInfo(pub, id, limit)
        if (!inf) throw new Error("Bridge master disappeared immediately after creation")

        Database.use((db) =>
          db
            .insert(BridgeNodeTable)
            .values({
              session_id: input.sessionID,
              bridge_id: id,
              role: "master",
              directory: input.directory,
              node_url: input.nodeURL,
              status: "active",
              limit: limit,
              coordinator: input.coordinator ?? null,
            })
            .onConflictDoUpdate({
              target: BridgeNodeTable.session_id,
              set: {
                bridge_id: id,
                role: "master",
                status: "active",
                node_url: input.nodeURL,
                limit: limit,
                coordinator: input.coordinator ?? null,
              },
            })
            .run(),
        )

        s.bridgeID = id
        s.role = "master"
        s.sessionID = input.sessionID
        s.slug = input.slug
        s.pubClient = pub
        s.subClient = sub
        s.info = inf
        s.inputLocked = false
        s.coordinator = input.coordinator ?? null

        startHeartbeat(id, input.sessionID)

        await pub
          .publish(k.channel, JSON.stringify({ type: "node.joined", node }))
          .catch((e) => log.warn("bridge: publish join failed", { error: String(e) }))

        Bus.publish(Event.StateChanged, inf)
        log.info("bridge: became master", { bridgeID: id })
        return inf
      } catch (e) {
        await pub.quit().catch(() => {})
        await sub.quit().catch(() => {})
        throw e
      }
    })().finally(() => {
      s.inProgress = null
      s.pendingSessionID = null
    })
    s.inProgress = pending
    return pending
  }

  export async function setFriend(input: {
    masterIDOrSlug: string
    sessionID: string
    slug: string
    title: string
    directory: string
    nodeURL: string
    coordinator?: string
  }): Promise<Info> {
    if (!available() && !input.coordinator) throw new Error("Bridge mode requires Redis. Set REDIS_URL or REDIS_HOST.")

    const s = state()
    // Idempotent if already friend in same bridge for same session
    if (
      s.role === "friend" &&
      s.info !== null &&
      s.sessionID === input.sessionID &&
      (s.bridgeID === input.masterIDOrSlug || s.masterInput === input.masterIDOrSlug)
    )
      return (await refreshInfo()) ?? s.info
    if (s.inProgress) {
      if (s.pendingSessionID === input.sessionID) return s.inProgress
      throw new Error("Bridge operation already in progress for a different session")
    }
    s.pendingSessionID = input.sessionID
    const pending = (async () => {
      if (s.bridgeID) await leave()

      const pub = makeClient(input.coordinator)
      const sub = makeClient(input.coordinator)
      await pub.connect()
      await sub.connect()

      try {
        // Resolve master ID via slug reverse-index
        let masterID = input.masterIDOrSlug
        if (!masterID.startsWith("ses_")) {
          const direct = await pub.get(`bridge:slug:${input.masterIDOrSlug}`)
          if (!direct) throw new Error(`Bridge master not found for slug: ${input.masterIDOrSlug}`)
          masterID = direct
        }

        const k = keys(masterID)
        const masterRaw = await pub.hgetall(k.master)
        if (!masterRaw?.sessionID) throw new Error(`Bridge ${masterID} does not exist or has no master.`)

        // Validate directory uniqueness and limit
        const nodesRaw = await pub.hgetall(k.nodes)
        const nodes = Object.values(nodesRaw ?? {})
          .map((v) => {
            try {
              return NodeInfo.safeParse(JSON.parse(v))
            } catch {
              return { success: false as const, error: null }
            }
          })
          .filter((r): r is { success: true; data: NodeInfo } => r.success)
          .map((r) => r.data)
          .filter((n) => Date.now() - n.heartbeat < 60_000)
        const limitRaw = await pub.get(`bridge:${masterID}:limit`)
        // Configurable via BRIDGE_MAX_NODES env var, defaults to 3
        const parsed = limitRaw ? parseInt(limitRaw, 10) : NaN
        const limit =
          Number.isFinite(parsed) && parsed > 0 ? parsed : parseInt(Env.get("BRIDGE_MAX_NODES") ?? "3", 10) || 3
        // NOTE: limit and directory-uniqueness checks are non-atomic against concurrent joins.
        // A Redis Lua script could enforce atomicity, but this is acceptable for the
        // expected small node counts (BRIDGE_MAX_NODES default: 3).
        if (nodes.length >= limit) throw new Error(`Bridge ${masterID} is full (limit: ${limit}).`)
        if (nodes.some((n) => n.directory === input.directory))
          throw new Error(`A node with directory ${input.directory} is already in this bridge.`)

        const node: NodeInfo = {
          nodeID: input.sessionID,
          role: "friend",
          sessionID: input.sessionID,
          slug: input.slug,
          title: input.title,
          directory: input.directory,
          nodeURL: input.nodeURL,
          heartbeat: Date.now(),
          status: "active",
        }

        await Promise.all([
          pub.hset(k.nodes, input.sessionID, JSON.stringify(node)),
          pub.set(k.session(input.sessionID), masterID),
        ])

        await sub.subscribe(k.channel)
        sub.on("message", (_, msg) => {
          handleMessage(msg).catch((e) => log.warn("bridge: message handler error", { error: String(e) }))
        })

        const inf = await buildInfo(pub, masterID, limit)
        if (!inf) throw new Error("Bridge master disappeared after joining")

        Database.use((db) =>
          db
            .insert(BridgeNodeTable)
            .values({
              session_id: input.sessionID,
              bridge_id: masterID,
              role: "friend",
              directory: input.directory,
              node_url: input.nodeURL,
              status: "active",
              limit: limit,
              coordinator: input.coordinator ?? null,
            })
            .onConflictDoUpdate({
              target: BridgeNodeTable.session_id,
              set: {
                bridge_id: masterID,
                role: "friend",
                status: "active",
                node_url: input.nodeURL,
                limit: limit,
                coordinator: input.coordinator ?? null,
              },
            })
            .run(),
        )

        s.bridgeID = masterID
        s.role = "friend"
        s.sessionID = input.sessionID
        s.masterInput = input.masterIDOrSlug
        // s.slug intentionally not set for friends — master owns the bridge:slug: key
        s.pubClient = pub
        s.subClient = sub
        s.info = inf
        s.inputLocked = false
        s.coordinator = input.coordinator ?? null

        startHeartbeat(masterID, input.sessionID)

        await pub
          .publish(k.channel, JSON.stringify({ type: "node.joined", node }))
          .catch((e) => log.warn("bridge: publish join failed", { error: String(e) }))

        Bus.publish(Event.StateChanged, inf)
        log.info("bridge: joined as friend", { bridgeID: masterID, sessionID: input.sessionID })
        return inf
      } catch (e) {
        await pub.quit().catch(() => {})
        await sub.quit().catch(() => {})
        throw e
      }
    })().finally(() => {
      s.inProgress = null
      s.pendingSessionID = null
    })
    s.inProgress = pending
    return pending
  }

  export async function leave(): Promise<void> {
    const s = state()
    if (!s.bridgeID) return

    // Capture and atomically clear bridgeID to prevent re-entrant leave() calls
    const id = s.bridgeID
    const sessionID = s.sessionID
    const slug = s.slug
    const k = keys(id)
    const prevRole = s.role
    s.bridgeID = null // ← close re-entrancy window immediately
    s.role = null // ← close isMaster()/isFriend() window

    if (s.heartbeatTimer) {
      clearInterval(s.heartbeatTimer)
      s.heartbeatTimer = null
    }

    if (s.subClient) {
      s.subClient.removeAllListeners("message")
      await s.subClient.unsubscribe().catch(() => {})
      await s.subClient.quit().catch(() => {})
      s.subClient = null
    }

    const pub = s.pubClient
    s.pubClient = null

    if (pub && sessionID) {
      if (prevRole === "master") {
        await pub
          .publish(k.channel, JSON.stringify({ type: "bridge.closed" }))
          .catch((e) => log.warn("bridge: publish closed failed", { error: String(e) }))
        const nodeIDs = await pub.hkeys(k.nodes).catch((e) => {
          log.warn("bridge: hkeys failed during leave, friend session keys may leak", { error: String(e) })
          return [] as string[]
        })
        await Promise.all([
          pub.del(k.master),
          pub.del(k.nodes),
          pub.del(k.context),
          pub.del(`bridge:${id}:limit`),
        ]).catch((e) => log.warn("bridge: cleanup failed", { error: String(e) }))
        const sessionKeys = [...nodeIDs, sessionID].map((sid) => k.session(sid))
        await pub.del(...sessionKeys).catch(() => {})
        if (slug) await pub.del(`bridge:slug:${slug}`).catch(() => {})
      } else {
        await pub.hdel(k.nodes, sessionID).catch((e) => log.warn("bridge: hdel node failed", { error: String(e) }))
        await pub.del(k.session(sessionID)).catch(() => {})
        await pub
          .publish(k.channel, JSON.stringify({ type: "node.left", nodeID: sessionID }))
          .catch((e) => log.warn("bridge: publish left failed", { error: String(e) }))
      }
    }

    if (pub) {
      await pub.quit().catch(() => {})
    }

    s.sessionID = null
    s.slug = null
    s.masterInput = null
    s.info = null
    s.inputLocked = false
    s.pendingSessionID = null

    if (sessionID) {
      try {
        Database.use((db) =>
          db.update(BridgeNodeTable).set({ status: "inactive" }).where(eq(BridgeNodeTable.session_id, sessionID)).run(),
        )
      } catch (e) {
        log.warn("bridge: failed to update status to inactive", { error: String(e) })
      }
    }

    log.info("bridge: left", { bridgeID: id, role: prevRole })
  }

  export async function shareContext(entry: Omit<ContextEntry, "nodeID" | "timestamp">): Promise<void> {
    const s = state()
    if (!s.bridgeID || !s.pubClient || !s.sessionID) return
    const full: ContextEntry = { ...entry, nodeID: s.sessionID, timestamp: Date.now() }
    const k = keys(s.bridgeID)
    await Promise.all([
      s.pubClient
        .lpush(k.context, JSON.stringify(full))
        .then(() => s.pubClient!.ltrim(k.context, 0, 199))
        .catch((e) => log.warn("bridge: shareContext lpush/ltrim failed", { error: String(e) })),
      s.pubClient
        .publish(k.channel, JSON.stringify({ type: "context.shared", entry: full }))
        .catch((e) => log.warn("bridge: publish context failed", { error: String(e) })),
    ])
  }

  export async function getContext(id: string, limit = 50): Promise<ContextEntry[]> {
    const s = state()
    if (!s.pubClient || !s.bridgeID || s.bridgeID !== id) return []
    const raw = await s.pubClient.lrange(keys(s.bridgeID).context, 0, limit - 1)
    return raw
      .map((v) => {
        try {
          return ContextEntry.safeParse(JSON.parse(v))
        } catch {
          return { success: false as const, error: null }
        }
      })
      .filter((r): r is { success: true; data: ContextEntry } => r.success)
      .map((r) => r.data)
  }

  export async function getNodes(id: string): Promise<NodeInfo[]> {
    const s = state()
    if (!s.pubClient) return []
    const raw = await s.pubClient.hgetall(keys(id).nodes)
    const now = Date.now()
    return Object.values(raw ?? {})
      .map((v) => {
        try {
          return NodeInfo.safeParse(JSON.parse(v))
        } catch {
          return { success: false as const, error: null }
        }
      })
      .filter((r): r is { success: true; data: NodeInfo } => r.success)
      .map((r) => r.data)
      .filter((n) => now - n.heartbeat < 60_000)
  }

  export async function refreshInfo(): Promise<Info | null> {
    const s = state()
    if (!s.bridgeID || !s.pubClient) return null
    const inf = await buildInfo(
      s.pubClient,
      s.bridgeID,
      s.info?.limit ?? (parseInt(Env.get("BRIDGE_MAX_NODES") ?? "3", 10) || 3),
    )
    s.info = inf
    s.lastRefresh = Date.now()
    return inf
  }

  export async function pollTaskResult(taskID: string, timeoutMs = 300_000): Promise<string | null> {
    const s = state()
    if (!s.pubClient || !s.bridgeID) return null
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const entries = await getContext(s.bridgeID, 50)
      const match = entries.find((e) => e.content.includes(taskID) && e.type === "task_result")
      if (match) return match.content
      await new Promise((r) => setTimeout(r, 2000))
    }
    return null
  }

  export async function setInputLocked(targetNodeID: string, locked: boolean): Promise<boolean> {
    const s = state()
    if (!s.bridgeID || !s.pubClient || s.role !== "master") return false
    const k = keys(s.bridgeID)
    const raw = await s.pubClient.hget(k.nodes, targetNodeID)
    if (!raw) return false
    let node
    try {
      node = NodeInfo.safeParse(JSON.parse(raw))
    } catch {
      return false
    }
    if (!node.success) return false
    if (node.data.role !== "friend") return false
    const updated: NodeInfo = { ...node.data, status: locked ? "locked" : "active" }
    await s.pubClient.hset(k.nodes, targetNodeID, JSON.stringify(updated))
    await s.pubClient
      .publish(k.channel, JSON.stringify({ type: "input.locked", nodeID: targetNodeID, locked }))
      .catch((e) => log.warn("bridge: publish input.locked failed", { error: String(e) }))
    return true
  }

  let initPromise: Promise<void> | null = null

  export async function init() {
    if (initPromise) return initPromise
    initPromise = _init().finally(() => {
      initPromise = null
    })
    return initPromise
  }

  async function _init() {
    const row = Database.use((db) =>
      db.select().from(BridgeNodeTable).where(eq(BridgeNodeTable.directory, Instance.directory)).get(),
    )
    if (!row || row.status !== "active") return
    if (!available() && !row.coordinator) return

    const pub = makeClient(row.coordinator ?? undefined)
    await pub.connect()
    const alive = await pub.exists(keys(row.bridge_id).master).catch(() => 0)
    await pub.quit().catch(() => {})

    if (!alive) {
      log.info("bridge: previous bridge gone, marking inactive", { bridgeID: row.bridge_id })
      Database.use((db) =>
        db
          .update(BridgeNodeTable)
          .set({ status: "inactive" })
          .where(eq(BridgeNodeTable.session_id, row.session_id))
          .run(),
      )
      return
    }

    const session = Database.use((db) =>
      db.select().from(SessionTable).where(eq(SessionTable.id, row.session_id)).get(),
    )
    const slug = session?.slug ?? row.session_id
    const title = session?.title ?? row.session_id

    log.info("bridge: restoring membership", { bridgeID: row.bridge_id, role: row.role })
    if (row.role === "master") {
      await setMaster({
        sessionID: row.session_id,
        slug,
        title,
        directory: row.directory,
        nodeURL: row.node_url,
        limit: row.limit,
        coordinator: row.coordinator ?? undefined,
      }).catch((e) => log.warn("bridge: restore master failed", { error: String(e) }))
    } else {
      await setFriend({
        masterIDOrSlug: row.bridge_id,
        sessionID: row.session_id,
        slug,
        title,
        directory: row.directory,
        nodeURL: row.node_url,
        coordinator: row.coordinator ?? undefined,
      }).catch((e) => log.warn("bridge: restore friend failed", { error: String(e) }))
    }
  }
}
