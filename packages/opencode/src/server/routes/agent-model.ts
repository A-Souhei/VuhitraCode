import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { VuHitraSettings } from "../../project/vuhitra-settings"
import { Profiles } from "../../project/profiles"
import { lazy } from "../../util/lazy"

const AgentModelSchema = z.object({
  providerID: z.string().min(1).max(256).regex(/^[A-Za-z0-9_\-./:]+$/),
  modelID: z.string().min(1).max(256).regex(/^[A-Za-z0-9_\-./:]+$/),
})

const AgentModelsResponseSchema = z.object({
  agent_models: z.record(z.string(), AgentModelSchema),
})

const SetAgentModelSchema = z.object({
  agent: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
  modelID: z.string().min(1).max(256).regex(/^[A-Za-z0-9_\-./:]+$/),
  providerID: z.string().min(1).max(256).regex(/^[A-Za-z0-9_\-./:]+$/),
  directory: z.string().optional(),
})

async function getAgentModels(dir?: string) {
  const profileName = await VuHitraSettings.activeProfile(dir)
  const profile = await Profiles.readProfile(profileName, dir)
  return {
    agent_models: profile.agent_models ?? {},
  }
}

export const AgentModelRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get agent models",
        operationId: "agent-model.get",
        responses: {
          200: {
            description: "Agent models",
            content: {
              "application/json": {
                schema: resolver(AgentModelsResponseSchema),
              },
            },
          },
        },
      }),
      validator("query", z.object({ directory: z.string().optional() })),
      async (c) => {
        const { directory } = c.req.valid("query")
        const models = await getAgentModels(directory)
        return c.json(models)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Set agent model",
        operationId: "agent-model.set",
        responses: {
          200: {
            description: "Updated agent models",
            content: {
              "application/json": {
                schema: resolver(AgentModelsResponseSchema),
              },
            },
          },
          400: {
            description: "Invalid agent or value",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator("json", SetAgentModelSchema),
      async (c) => {
        const { agent, modelID, providerID, directory } = c.req.valid("json")

        try {
          await VuHitraSettings.setAgentModel(agent, { providerID, modelID }, directory)
          const models = await getAgentModels(directory)
          return c.json(models)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return c.json({ error: message }, 400)
        }
      },
    ),
)
