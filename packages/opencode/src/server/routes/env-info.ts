import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "../../project/instance"
import path from "path"
import fs from "fs"

const ENV_KEYS = [
  "OLLAMA_MODEL",
  "OLLAMA_URL",
  "OLLAMA_CONTEXT_SIZE",
  "OLLAMA_TOOLCALL",
  "QDRANT_URL",
  "EMBEDDING_URL",
  "EMBEDDING_MODEL",
  "INDEXER_MAX_FILE_SIZE",
] as const

const EnvInfoSchema = z.object(
  Object.fromEntries(ENV_KEYS.map((k) => [k, z.string().optional()])) as {
    [K in (typeof ENV_KEYS)[number]]: z.ZodOptional<z.ZodString>
  },
)

const EnvInfoResponseSchema = z.object({
  env: EnvInfoSchema,
  file_not_found: z.boolean().optional(),
})

function readEnvInfo(dir?: string): z.infer<typeof EnvInfoResponseSchema> {
  const directory = dir ?? Instance.directory
  if (!directory) return { env: {}, file_not_found: true }

  const filePath = path.join(directory, ".vuhitra", "env.json")
  if (!fs.existsSync(filePath)) return { env: {}, file_not_found: true }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>
    const env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}
    for (const key of ENV_KEYS) {
      const val = raw[key]
      if (typeof val === "string" && val !== "") env[key] = val
    }
    return { env }
  } catch {
    return { env: {}, file_not_found: true }
  }
}

export const EnvInfoRoutes = () =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "Get project env info",
      operationId: "env-info.get",
      responses: {
        200: {
          description: "Project env info from .vuhitra/env.json",
          content: { "application/json": { schema: resolver(EnvInfoResponseSchema) } },
        },
      },
    }),
    validator("query", z.object({ directory: z.string().optional() })),
    (c) => {
      const { directory } = c.req.valid("query")
      return c.json(readEnvInfo(directory))
    },
  )
