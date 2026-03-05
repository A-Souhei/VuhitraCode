import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { Indexer } from "../../indexer"
import { errors } from "../error"
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
        ...errors(500),
      },
    }),
    async (c) => {
      await Indexer.deleteCollection()
      return c.body(null, 204)
    },
  ),
)
