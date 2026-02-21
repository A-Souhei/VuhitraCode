# Project Structure

Opencode is a fully TypeScript monorepo (1,046 `.ts` files, zero plain JS in source) managed with **Bun workspaces** and **Turbo**.

## Repository Layout

```
opencode/
├── packages/
│   ├── opencode/        ← core CLI (yargs, AI SDK, MCP, DB, tree-sitter)
│   ├── app/             ← web UI (SolidJS + Vite)
│   ├── desktop/         ← desktop wrapper (Tauri)
│   ├── web/             ← marketing site (Astro)
│   ├── ui/              ← shared component library (SolidJS + Tailwind)
│   ├── sdk/js/          ← TypeScript SDK (generated from OpenAPI)
│   ├── enterprise/      ← backend API (SolidStart + Hono + Drizzle)
│   ├── function/        ← serverless functions (Cloudflare Workers)
│   ├── plugin/          ← plugin system SDK
│   ├── util/            ← shared utilities
│   ├── slack/           ← Slack bot integration
│   ├── console/         ← admin console (5 sub-packages)
│   ├── identity/        ← auth services
│   └── extensions/      ← IDE extensions
├── packages/docs/       ← official Mintlify docs site (upstream)
├── docs/                ← fork-internal notes (this folder)
└── packages/opencode/src/index.ts  ← main CLI entry point
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.3.9 |
| UI Framework | SolidJS 1.9.10 |
| Desktop | Tauri 2 |
| Marketing Site | Astro |
| HTTP | Hono 4.10.7 |
| Database | Drizzle ORM |
| Backend Framework | SolidStart |
| Serverless | Cloudflare Workers |
| AI / LLM | Vercel AI SDK 5 (multi-provider) |
| Validation | Zod 4 |
| CLI | yargs 18 |
| Code Parsing | web-tree-sitter 0.25.10 |
| Build | Vite 7 + Turbo |
| Auth | OpenAuth |

## AI Providers Supported

Anthropic, OpenAI, Google, Azure, Bedrock, Groq, Mistral, Cohere, Cerebras, Perplexity, OpenRouter, xAI, and more — all abstracted through the Vercel AI SDK.

## Main Entry Points

- **CLI:** `packages/opencode/src/index.ts`
- **Web UI:** `packages/app/src/index.ts`
- **Desktop:** `packages/desktop` (Tauri wrapping the web app)
- **Backend API:** `packages/enterprise`
- **SDK:** `packages/sdk/js/src/index.ts`

## Commands

```bash
# Run CLI from source (dev)
bun run --cwd packages/opencode --conditions=browser src/index.ts

# Run web UI dev server
bun run dev:web

# Run desktop app
bun run dev:desktop

# Install all dependencies
bun install

# Typecheck all packages
bun run typecheck
```
