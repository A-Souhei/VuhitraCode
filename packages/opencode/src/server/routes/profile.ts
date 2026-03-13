import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { VuHitraSettings } from "../../project/vuhitra-settings"
import { lazy } from "../../util/lazy"

export const ProfileRoutes = lazy(() =>
  new Hono()
    .get(
      "/list",
      describeRoute({
        summary: "List available profiles",
        operationId: "profile.list",
        responses: {
          200: {
            description: "List of profile names",
            content: { "application/json": { schema: resolver(z.array(z.string())) } },
          },
        },
      }),
      validator("query", z.object({ directory: z.string().optional() })),
      async (c) => {
        const { directory } = c.req.valid("query")
        const profiles = await VuHitraSettings.listProfiles(directory)
        return c.json(profiles)
      },
    )
    .get(
      "/active",
      describeRoute({
        summary: "Get active profile",
        operationId: "profile.active",
        responses: {
          200: {
            description: "Active profile name",
            content: { "application/json": { schema: resolver(z.string()) } },
          },
        },
      }),
      validator("query", z.object({ directory: z.string().optional() })),
      async (c) => {
        const { directory } = c.req.valid("query")
        return c.json(VuHitraSettings.activeProfile(directory))
      },
    )
    .post(
      "/switch",
      describeRoute({
        summary: "Switch active profile",
        operationId: "profile.switch",
        responses: {
          200: {
            description: "Profile switched successfully",
            content: { "application/json": { schema: resolver(z.object({ success: z.boolean() })) } },
          },
          400: {
            description: "Invalid profile name",
            content: { "application/json": { schema: resolver(z.object({ error: z.string() })) } },
          },
        },
      }),
      validator("json", z.object({ name: z.string(), directory: z.string() })),
      async (c) => {
        const { name, directory } = c.req.valid("json")
        await VuHitraSettings.setActiveProfile(name, directory).catch((err: unknown) => {
          throw err
        })
        return c.json({ success: true })
      },
    ),
)
