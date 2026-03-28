import { createSignal, onMount, Show, For } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { authHeaders } from "@/utils/auth"

type EnvInfo = {
  OLLAMA_MODEL?: string
  OLLAMA_URL?: string
  OLLAMA_CONTEXT_SIZE?: string
  OLLAMA_TOOLCALL?: string
  QDRANT_URL?: string
  EMBEDDING_URL?: string
  EMBEDDING_MODEL?: string
  INDEXER_MAX_FILE_SIZE?: string
}

type IconName = "models" | "magnifying-glass" | "bullet-list"

const GROUPS: {
  label: string
  icon: IconName
  tooltip: string
  rows: { label: string; key: keyof EnvInfo }[]
}[] = [
  {
    label: "Ollama",
    icon: "models",
    tooltip: "Local LLM inference via Ollama",
    rows: [
      { label: "URL", key: "OLLAMA_URL" },
      { label: "Model", key: "OLLAMA_MODEL" },
      { label: "Context size", key: "OLLAMA_CONTEXT_SIZE" },
    ],
  },
  {
    label: "Embeddings",
    icon: "magnifying-glass",
    tooltip: "Embedding model used by the indexer",
    rows: [
      { label: "URL", key: "EMBEDDING_URL" },
      { label: "Model", key: "EMBEDDING_MODEL" },
    ],
  },
  {
    label: "Vector store",
    icon: "bullet-list",
    tooltip: "Qdrant vector storage for the indexer",
    rows: [{ label: "URL", key: "QDRANT_URL" }],
  },
]

function InfoRow(props: { label: string; value: string }) {
  return (
    <div class="flex items-center gap-2 min-w-0">
      <span class="text-12-regular text-text-weak shrink-0">{props.label}</span>
      <div class="flex-1" />
      <Tooltip placement="top" value={props.value}>
        <span class="text-11-regular text-text-weaker font-mono truncate max-w-[140px] text-right">
          {props.value}
        </span>
      </Tooltip>
    </div>
  )
}

export function EnvInfoPanel() {
  const sdk = useSDK()
  const server = useServer()
  const [env, setEnv] = createSignal<EnvInfo>({})
  const [fileNotFound, setFileNotFound] = createSignal(false)
  const [loading, setLoading] = createSignal(true)

  onMount(async () => {
    const dir = sdk.directory
    if (!dir) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch(`${sdk.url}/env-info?directory=${encodeURIComponent(dir)}`, {
        headers: authHeaders(server.current?.http),
      })
      if (res.ok) {
        const data = (await res.json()) as { env: EnvInfo; file_not_found?: boolean }
        setEnv(data.env ?? {})
        setFileNotFound(!!data.file_not_found)
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  })

  const hasAnyValue = () => Object.values(env()).some(Boolean)

  return (
    <div class="px-4 border-b border-border-weak-base">
      <Collapsible variant="ghost">
        <Collapsible.Trigger class="py-3 gap-2 cursor-pointer" style={{ height: "auto" }}>
          <Icon name="dot-grid" size="small" class="text-icon-base shrink-0" />
          <div class="flex flex-col flex-1 min-w-0 text-left">
            <span class="text-12-medium text-text-strong">Project Info</span>
            <span class="text-11-regular text-text-weaker truncate">
              {loading() ? "Loading…" : fileNotFound() ? "env.json not found" : "from .vuhitra/env.json"}
            </span>
          </div>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="flex flex-col gap-3 pb-3">
            <Show when={fileNotFound()}>
              <span class="text-11-regular text-text-weaker italic">.vuhitra/env.json not found</span>
            </Show>
            <Show when={!fileNotFound() && !loading() && !hasAnyValue()}>
              <span class="text-12-regular text-text-weaker">—</span>
            </Show>
            <Show when={!fileNotFound() && hasAnyValue()}>
              <For each={GROUPS}>
                {(group) => {
                  const rows = group.rows.filter((r) => env()[r.key])
                  if (rows.length === 0) return null
                  return (
                    <div class="flex flex-col gap-1.5">
                      <div class="flex items-center gap-1.5">
                        <Icon name={group.icon} size="small" class="text-icon-weaker shrink-0" />
                        <Tooltip placement="top" value={group.tooltip}>
                          <span class="text-11-medium text-text-weak">{group.label}</span>
                        </Tooltip>
                      </div>
                      <div class="flex flex-col gap-1 pl-1">
                        <For each={rows}>{(row) => <InfoRow label={row.label} value={env()[row.key]!} />}</For>
                      </div>
                    </div>
                  )
                }}
              </For>
            </Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}
