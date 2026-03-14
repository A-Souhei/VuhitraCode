import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { VuHitraSettings } from "../../project/vuhitra-settings"
import { lazy } from "../../util/lazy"
import { Session } from "../../session"

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
        const profiles = await VuHitraSettings.listProfiles(c.req.valid("query").directory)
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
        return c.json(VuHitraSettings.activeProfile(c.req.valid("query").directory))
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
        await VuHitraSettings.setActiveProfile(c.req.valid("json").name, c.req.valid("json").directory)
        return c.json({ success: true })
      },
    )
    .get(
      "/session-active",
      describeRoute({
        summary: "Get session profile",
        operationId: "profile.session_active",
        responses: {
          200: {
            description: "Session profile name",
            content: { "application/json": { schema: resolver(z.string().nullable()) } },
          },
        },
      }),
      validator("query", z.object({ sessionID: z.string() })),
      async (c) => {
        const session = await Session.get(c.req.valid("query").sessionID)
        return c.json(session.profile ?? null)
      },
    )
    .post(
      "/session-switch",
      describeRoute({
        summary: "Switch session profile",
        operationId: "profile.session_switch",
        responses: {
          200: {
            description: "Session profile updated",
            content: { "application/json": { schema: resolver(z.object({ success: z.boolean() })) } },
          },
          400: {
            description: "Invalid profile name or session ID",
            content: { "application/json": { schema: resolver(z.object({ error: z.string() })) } },
          },
        },
      }),
      validator("json", z.object({ sessionID: z.string(), name: z.string() })),
      async (c) => {
        const body = c.req.valid("json")
        if (!/^[A-Za-z0-9_\-.]+$/.test(body.name)) {
          return c.json({ error: `Invalid profile name: ${body.name}` }, 400)
        }
        await Session.setProfile({ sessionID: body.sessionID, profile: body.name })
        return c.json({ success: true })
      },
    ),
)
