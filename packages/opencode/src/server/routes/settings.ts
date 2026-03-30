import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Bus } from "../../bus"
import { BusEvent } from "../../bus/bus-event"
import { VuHitraSettings } from "../../project/vuhitra-settings"
import { lazy } from "../../util/lazy"

const FeaturesSchema = z.object({
  indexing: z.object({ enabled: z.boolean() }),
  memory: z.object({ enabled: z.boolean(), ttl: z.number().optional() }),
  biblion: z.object({ enabled: z.boolean() }),
  model_lock: z.object({ enabled: z.boolean() }),
  review_max_rounds: z.number(),
  explore_max_instances: z.number(),
  compaction_threshold: z.number(),
})

const FeaturesResponseSchema = FeaturesSchema.extend({
  file_not_found: z.boolean().optional(),
})

const SettingsUpdated = BusEvent.define("settings.updated", FeaturesResponseSchema)

const FeatureKeys = [
  "indexing.enabled",
  "memory.enabled",
  "memory.ttl",
  "biblion.enabled",
  "model_lock.enabled",
  "review_max_rounds",
  "explore_max_instances",
  "compaction_threshold",
] as const

type FeatureKey = (typeof FeatureKeys)[number]

function isValidFeatureKey(key: string): key is FeatureKey {
  return FeatureKeys.includes(key as FeatureKey)
}

function getFeatures(dir?: string) {
  const { settings, fileNotFound } = VuHitraSettings.readSettings(dir)
  return {
    indexing: { enabled: settings.indexing?.enabled ?? false },
    memory: { enabled: settings.memory?.enabled ?? false, ttl: settings.memory?.ttl ?? 86400 },
    biblion: { enabled: settings.biblion?.enabled ?? false },
    model_lock: { enabled: settings.model_lock?.enabled ?? false },
    review_max_rounds: settings.review_max_rounds ?? 7,
    explore_max_instances: settings.explore_max_instances ?? 3,
    compaction_threshold: settings.compaction_threshold ?? 0.7,
    ...(fileNotFound ? { file_not_found: true } : {}),
  }
}

async function setFeature(key: FeatureKey, value: unknown, dir?: string) {
  switch (key) {
    case "indexing.enabled":
      if (typeof value !== "boolean") {
        throw new Error(`indexing.enabled must be a boolean, got ${typeof value}`)
      }
      await VuHitraSettings.writeSettings({ indexing: { enabled: value } }, dir)
      break
    case "memory.enabled":
      if (typeof value !== "boolean") {
        throw new Error(`memory.enabled must be a boolean, got ${typeof value}`)
      }
      await VuHitraSettings.writeSettings({ memory: { enabled: value } }, dir)
      break
    case "memory.ttl":
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`memory.ttl must be a positive integer, got ${value}`)
      }
      await VuHitraSettings.setMemoryTtl(value, dir)
      break
    case "biblion.enabled":
      if (typeof value !== "boolean") {
        throw new Error(`biblion.enabled must be a boolean, got ${typeof value}`)
      }
      await VuHitraSettings.writeSettings({ biblion: { enabled: value } }, dir)
      break
    case "model_lock.enabled":
      if (typeof value !== "boolean") {
        throw new Error(`model_lock.enabled must be a boolean, got ${typeof value}`)
      }
      await VuHitraSettings.writeSettings({ model_lock: { enabled: value } }, dir)
      break
    case "review_max_rounds":
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`review_max_rounds must be a positive integer, got ${value}`)
      }
      await VuHitraSettings.writeSettings({ review_max_rounds: value }, dir)
      break
    case "explore_max_instances":
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`explore_max_instances must be a positive integer, got ${value}`)
      }
      await VuHitraSettings.writeSettings({ explore_max_instances: value }, dir)
      break
    case "compaction_threshold":
      if (typeof value !== "number" || value < 0 || value > 1) {
        throw new Error(`compaction_threshold must be a number between 0 and 1, got ${value}`)
      }
      await VuHitraSettings.writeSettings({ compaction_threshold: value }, dir)
      break
  }
}

export const SettingsRoutes = lazy(() =>
  new Hono()
    .get(
      "/features",
      describeRoute({
        summary: "Get feature settings",
        operationId: "settings.features.get",
        responses: {
          200: {
            description: "Feature toggle settings",
            content: {
              "application/json": {
                schema: resolver(FeaturesResponseSchema),
              },
            },
          },
        },
      }),
      validator("query", z.object({ directory: z.string().optional() })),
      async (c) => {
        const { directory } = c.req.valid("query")
        const features = getFeatures(directory)
        return c.json(features)
      },
    )
    .post(
      "/features",
      describeRoute({
        summary: "Update feature setting",
        operationId: "settings.features.update",
        responses: {
          200: {
            description: "Updated feature settings",
            content: {
              "application/json": {
                schema: resolver(FeaturesResponseSchema),
              },
            },
          },
          400: {
            description: "Invalid key or value",
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
          key: z.string(),
          value: z.any(),
          directory: z.string().optional(),
        }),
      ),
      validator("query", z.object({ directory: z.string().optional() })),
      async (c) => {
        const body = c.req.valid("json")
        const { key, value, directory } = body

        if (!isValidFeatureKey(key)) {
          return c.json({ error: "Invalid feature key" }, 400)
        }

        try {
          await setFeature(key, value, directory)
          const features = getFeatures(directory)
          await Bus.publish(SettingsUpdated, features)
          return c.json(features)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return c.json({ error: message }, 400)
        }
      },
    ),
)
