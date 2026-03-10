import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Memory } from "../../memory"
import { lazy } from "../../util/lazy"

export const MemoryRoutes = lazy(() =>
  new Hono().get(
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
  ),
)
