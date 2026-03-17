import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Env } from "../../env"
import { Instance } from "../../project/instance"
import path from "path"
import fs from "fs"

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: ModelsDev.Provider.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const allProviders = await ModelsDev.get()
        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }

        const connected = await Provider.list()
        const providers = Object.assign(
          mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
          connected,
        )
        return c.json({
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
          connected: Object.keys(connected),
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ProviderAuth.methods())
      },
    )
    .get(
      "/ollama/models",
      describeRoute({
        summary: "List Ollama models",
        description: "Fetch available models from the Ollama server.",
        operationId: "provider.ollama.models",
        responses: {
          200: {
            description: "List of Ollama models",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    models: z.array(
                      z.object({
                        id: z.string(),
                        name: z.string(),
                        size: z.number(),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const rawOllamaURL = Env.get("OLLAMA_URL") ?? "http://localhost:11434"
        const ollamaAPIURL = rawOllamaURL.replace(/\/+$/, "")

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)

        const response = await fetch(`${ollamaAPIURL}/api/tags`, {
          signal: controller.signal,
        }).catch(() => null)
        clearTimeout(timeout)

        if (!response || !response.ok) {
          return c.json({ models: [] })
        }

        const data = (await response.json()) as {
          models: Array<{ name: string; size: number; digest: string; modified_at: string }>
        }

        const models = (data.models ?? []).map((m) => ({
          id: m.name,
          name: m.name,
          size: m.size,
        }))

        return c.json({ models })
      },
    )
    .patch(
      "/ollama/config",
      describeRoute({
        summary: "Configure Ollama settings",
        description: "Update Ollama configuration including enabled models and secret model.",
        operationId: "provider.ollama.config",
        responses: {
          200: {
            description: "Configuration updated successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          enabledModels: z.array(z.string()).optional(),
          secretModel: z.string().optional(),
        }),
      ),
      async (c) => {
        const { enabledModels, secretModel } = c.req.valid("json")

        const envPath = path.join(Instance.directory, ".vuhitra", "env.json")
        let envJson: Record<string, string> = {}
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, "utf-8")
          envJson = JSON.parse(content)
        }

        if (enabledModels !== undefined) {
          const value = enabledModels.length > 0 ? enabledModels.join(",") : ""
          Env.set("OLLAMA_ENABLED_MODELS", value)
          if (value) {
            envJson["OLLAMA_ENABLED_MODELS"] = value
          } else {
            delete envJson["OLLAMA_ENABLED_MODELS"]
          }
        }

        if (secretModel !== undefined) {
          if (secretModel) {
            Env.set("OLLAMA_SECRET_MODEL", secretModel)
            envJson["OLLAMA_SECRET_MODEL"] = secretModel
          } else {
            Env.remove("OLLAMA_SECRET_MODEL")
            delete envJson["OLLAMA_SECRET_MODEL"]
          }
        }

        fs.writeFileSync(envPath, JSON.stringify(envJson, null, 2))

        return c.json(true)
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method } = c.req.valid("json")
        const result = await ProviderAuth.authorize({
          providerID,
          method,
        })
        return c.json(result)
      },
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await ProviderAuth.callback({
          providerID,
          method,
          code,
        })
        return c.json(true)
      },
    ),
)
