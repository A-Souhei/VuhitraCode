import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Memory } from "../../memory"
import { lazy } from "../../util/lazy"

export const MemoryRoutes = lazy(() =>
  new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get memory status",
        operationId: "memory.status",
        responses: {
          200: {
            description: "Memory status retrieved successfully",
            content: {
              "application/json": {
                schema: resolver(Memory.Status),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Memory.status())
      },
    )
    .delete(
      "/",
      describeRoute({
        summary: "Clear all memory entries",
        operationId: "memory.delete",
        responses: {
          200: {
            description: "Memory cleared successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
        },
      }),
      async (c) => {
        await Memory.clear()
        return c.json({ success: true })
      },
    ),
)
