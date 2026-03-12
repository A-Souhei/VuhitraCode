import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Bridge } from "../../bridge"
import { Server } from "../server"
import { Env } from "../../env"
import { lazy } from "../../util/lazy"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { Identifier } from "../../id/id"
import { Bus } from "../../bus"

// Set BRIDGE_NODE_URL to your machine's reachable IP/hostname for cross-machine bridge
function nodeURL() {
  const override = Env.get("BRIDGE_NODE_URL")
  if (!override) return Server.url().toString()
  const raw = override.startsWith("http") ? override : `http://${override}`
  try {
    return new URL(raw).toString()
  } catch {
    // Invalid BRIDGE_NODE_URL — fall back to local server URL
    return Server.url().toString()
  }
}

export const BridgeRoutes = lazy(() =>
  new Hono()
    .get(
      "/info",
      describeRoute({
        summary: "Get bridge info",
        operationId: "bridge.info",
        responses: {
          200: {
            description: "Current bridge info or null if not active",
            content: {
              "application/json": {
                schema: resolver(Bridge.Info.nullable()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Bridge.info())
      },
    )
    .get(
      "/nodes",
      describeRoute({
        summary: "Get bridge nodes",
        operationId: "bridge.nodes",
        responses: {
          200: {
            description: "List of nodes in the bridge",
            content: {
              "application/json": {
                schema: resolver(Bridge.NodeInfo.array()),
              },
            },
          },
          403: {
            description: "Bridge not active or bridgeID mismatch",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          bridgeID: z.string().max(200),
        }),
      ),
      async (c) => {
        const { bridgeID } = c.req.valid("query")
        if (!Bridge.isActive() || Bridge.bridgeID() !== bridgeID)
          return c.json({ error: "Bridge not active or bridgeID mismatch" }, 403)
        return c.json(await Bridge.getNodes(bridgeID))
      },
    )
    .get(
      "/context",
      describeRoute({
        summary: "Get bridge shared context",
        operationId: "bridge.context",
        responses: {
          200: {
            description: "List of shared context entries",
            content: {
              "application/json": {
                schema: resolver(Bridge.ContextEntry.array()),
              },
            },
          },
          403: {
            description: "Bridge not active or bridgeID mismatch",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          bridgeID: z.string().max(200),
          limit: z.coerce.number().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const { bridgeID, limit } = c.req.valid("query")
        if (!Bridge.isActive() || Bridge.bridgeID() !== bridgeID)
          return c.json({ error: "Bridge not active or bridgeID mismatch" }, 403)
        return c.json(await Bridge.getContext(bridgeID, limit))
      },
    )
    .post(
      "/set-master",
      describeRoute({
        summary: "Become bridge master",
        operationId: "bridge.setMaster",
        responses: {
          200: {
            description: "Bridge info after becoming master",
            content: {
              "application/json": {
                schema: resolver(Bridge.Info),
              },
            },
          },
          400: {
            description: "Invalid input or bridge full",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          sessionID: z.string().max(200),
          slug: z.string().max(200),
          title: z.string().max(500),
          directory: z.string().max(500),
          limit: z.number().int().min(1).max(100).optional(),
          coordinator: z
            .string()
            .url()
            .regex(/^rediss?:\/\//)
            .optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        try {
          const result = await Bridge.setMaster({ ...body, nodeURL: nodeURL() })
          return c.json(result)
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
        }
      },
    )
    .post(
      "/set-friend",
      describeRoute({
        summary: "Join a bridge as friend",
        operationId: "bridge.setFriend",
        responses: {
          200: {
            description: "Bridge info after joining as friend",
            content: {
              "application/json": {
                schema: resolver(Bridge.Info),
              },
            },
          },
          400: {
            description: "Invalid input or bridge full",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          masterIDOrSlug: z.string().max(200),
          sessionID: z.string().max(200),
          slug: z.string().max(200),
          title: z.string().max(500),
          directory: z.string().max(500),
          coordinator: z
            .string()
            .url()
            .regex(/^rediss?:\/\//)
            .optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        try {
          const result = await Bridge.setFriend({ ...body, nodeURL: nodeURL() })
          return c.json(result)
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
        }
      },
    )
    .post(
      "/leave",
      describeRoute({
        summary: "Leave the current bridge",
        operationId: "bridge.leave",
        responses: {
          200: {
            description: "Successfully left the bridge",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          403: {
            description: "bridgeID mismatch",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          bridgeID: z.string().max(200).optional(),
        }),
      ),
      async (c) => {
        const { bridgeID } = c.req.valid("json")
        if (bridgeID && Bridge.bridgeID() !== bridgeID) return c.json({ error: "bridgeID mismatch" }, 403)
        await Bridge.leave()
        return c.json({ success: true as const })
      },
    )
    .post(
      "/share-context",
      describeRoute({
        summary: "Share a context entry with the bridge",
        operationId: "bridge.shareContext",
        responses: {
          200: {
            description: "Context entry shared successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          400: {
            description: "Not in an active bridge",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator("json", Bridge.ContextEntry.omit({ nodeID: true, timestamp: true })),
      async (c) => {
        if (!Bridge.isActive()) return c.json({ error: "Not in an active bridge" }, 400)
        const entry = c.req.valid("json")
        await Bridge.shareContext(entry)
        return c.json({ success: true as const })
      },
    )
    .post(
      "/lock-input",
      describeRoute({
        summary: "Lock or unlock input for a target node",
        operationId: "bridge.lockInput",
        responses: {
          200: {
            description: "Input lock state updated",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          403: {
            description: "Only master can lock input",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
          404: {
            description: "Target node not found",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          targetNodeID: z.string().min(1),
          locked: z.boolean(),
        }),
      ),
      async (c) => {
        if (!Bridge.isMaster()) return c.json({ error: "Only master can lock input" }, 403)
        const { targetNodeID, locked } = c.req.valid("json")
        const ok = await Bridge.setInputLocked(targetNodeID, locked)
        if (!ok) return c.json({ error: "Target node not found" }, 404)
        return c.json({ success: true as const })
      },
    )
    .post(
      "/dispatch-task",
      describeRoute({
        summary: "Dispatch a task to this friend node (async fire-and-start)",
        operationId: "bridge.dispatchTask",
        responses: {
          200: {
            description: "Task accepted — friend Alice has started running",
            content: {
              "application/json": {
                schema: resolver(z.object({ taskID: z.string(), sessionID: z.string(), success: z.literal(true) })),
              },
            },
          },
          403: {
            description: "Only callable on a friend node",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          taskID: z.string(),
          prompt: z.string(),
          description: z.string(),
        }),
      ),
      async (c) => {
        if (!Bridge.isFriend()) return c.json({ error: "Only callable on a friend node" }, 403)
        const { taskID, prompt, description } = c.req.valid("json")
        const session = await Session.create({ title: description })
        const bid = Bridge.bridgeID()
        if (!bid) return c.json({ error: "Bridge ID unavailable" }, 500)
        Bus.publish(Bridge.Event.TaskDispatched, {
          targetNodeID: bid,
          taskID,
          sessionID: session.id,
          agentName: "alice",
        })
        const parts = await SessionPrompt.resolvePromptParts(prompt)
        const messageID = Identifier.ascending("message")

        // Fire-and-forget: start friend Alice's orchestration without awaiting
        SessionPrompt.prompt({
          messageID,
          sessionID: session.id,
          agent: "alice",
          parts,
        })
          .then((result) => {
            const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
            Bridge.shareContext({
              role: "friend",
              directory: session.directory ?? process.cwd(),
              type: "task_result",
              content: `task_id: ${taskID}\n${text}`,
            }).catch(() => {})
          })
          .catch(() => {})

        return c.json({ taskID, sessionID: session.id, success: true as const })
      },
    ),
)
