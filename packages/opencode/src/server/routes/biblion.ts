import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Biblion } from "../../biblion"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

const Entry = z.object({
  id: z.string(),
  type: z.string(),
  tags: z.string(),
  content: z.string(),
})

export const BiblionRoutes = lazy(() =>
  new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get biblion status",
        operationId: "biblion.status",
        responses: {
          200: {
            description: "Biblion status retrieved successfully",
            content: {
              "application/json": {
                schema: resolver(Biblion.Status),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Biblion.status())
      },
    )
    .get(
      "/list",
      describeRoute({
        summary: "List all biblion entries",
        operationId: "biblion.list",
        responses: {
          200: {
            description: "List of biblion entries",
            content: {
              "application/json": {
                schema: resolver(Entry.array()),
              },
            },
          },
          500: {
            description: "Internal server error",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(false), error: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        try {
          const entries = await Biblion.list()
          return c.json(entries)
        } catch (e) {
          return c.json({ success: false, error: "List failed" }, 500)
        }
      },
    )
    .post(
      "/search",
      describeRoute({
        summary: "Search biblion entries",
        operationId: "biblion.search",
        responses: {
          200: {
            description: "Search results",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
          500: {
            description: "Internal server error",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(false), error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          query: z.string().describe("Search query string"),
          limit: z.number().min(1).max(100).optional().default(5).describe("Maximum number of results to return"),
        }),
      ),
      async (c) => {
        try {
          const { query, limit } = c.req.valid("json")
          const results = await Biblion.search(query, limit)
          return c.json(results)
        } catch (e) {
          return c.json({ success: false, error: "Search failed" }, 500)
        }
      },
    )
    .post(
      "/write",
      describeRoute({
        summary: "Write a biblion entry",
        operationId: "biblion.write",
        responses: {
          200: {
            description: "Entry written successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          503: {
            description: "Biblion not ready",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(false), reason: z.string() })),
              },
            },
          },
          500: {
            description: "Internal server error",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(false), error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          type: z
            .enum(["structure", "pattern", "dependency", "api", "config", "workflow"])
            .describe("Type of biblion entry"),
          content: z.string().max(50000).describe("The content to store"),
          tags: z.array(z.string()).optional().describe("Optional tags for categorization"),
          session_id: z.string().optional().describe("Session ID"),
          branch: z.string().optional().describe("Git branch name"),
        }),
      ),
      async (c) => {
        const status = Biblion.status()
        if (status.type !== "ready") {
          return c.json({ success: false, reason: status.reason }, 503)
        }
        try {
          const entry = c.req.valid("json")
          await Biblion.write({
            type: entry.type,
            content: entry.content,
            tags: entry.tags ?? [],
            session_id: entry.session_id ?? "",
            branch: entry.branch ?? "",
            timestamp: Date.now(),
          })
          return c.json({ success: true })
        } catch (e) {
          return c.json({ success: false, error: "Write failed" }, 500)
        }
      },
    )
    .delete(
      "/clear",
      describeRoute({
        summary: "Clear all biblion entries",
        operationId: "biblion.clear",
        responses: {
          200: {
            description: "Biblion cleared successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          500: {
            description: "Internal server error",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(false), error: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        try {
          await Biblion.clear()
          return c.json({ success: true })
        } catch (e) {
          return c.json({ success: false, error: "Clear failed" }, 500)
        }
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete a specific biblion entry",
        operationId: "biblion.delete",
        responses: {
          200: {
            description: "Entry deleted successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          500: {
            description: "Internal server error",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(false), error: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string().describe("Entry ID to delete"),
        }),
      ),
      async (c) => {
        try {
          const { id } = c.req.valid("param")
          await Biblion.deleteEntry(id)
          return c.json({ success: true })
        } catch (e) {
          return c.json({ success: false, error: "Delete failed" }, 500)
        }
      },
    ),
)
