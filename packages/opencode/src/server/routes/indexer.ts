import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { Indexer } from "../../indexer"
import { lazy } from "../../util/lazy"

export const IndexerRoutes = lazy(() =>
  new Hono().delete(
    "/data",
    describeRoute({
      summary: "Delete all index data",
      description:
        "Delete all vector embeddings and index data for the current project. Useful when switching embedding servers or models. The indexer will automatically regenerate the index on next use.",
      operationId: "indexer.deleteData",
      responses: {
        204: {
          description: "Index data successfully deleted",
        },
        400: {
          description: "Confirmation header missing or invalid (requires X-Confirm-Deletion: true)",
        },
      },
    }),
    async (c) => {
      const confirmHeader = c.req.header("X-Confirm-Deletion")?.toLowerCase().trim()
      if (!confirmHeader || confirmHeader.length > 10 || confirmHeader !== "true") {
        return c.json({ error: "Requires X-Confirm-Deletion: true header" }, 400)
      }
      await Indexer.deleteCollection()
      return c.body(null, 204)
    },
  ),
)
