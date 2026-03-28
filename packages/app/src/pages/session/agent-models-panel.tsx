import { For, createMemo, Show, Switch, Match, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useAgentModels } from "@/hooks/use-agent-models"
import { useLocal } from "@/context/local"
import { useLanguage } from "@/context/language"
import { popularProviders } from "@/hooks/use-providers"
import { useSync } from "@/context/sync"
import { useParams } from "@solidjs/router"

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

function AgentModelList(props: { onSelect: (model: { providerID: string; modelID: string }) => void; class?: string }) {
  const local = useLocal()
  const language = useLanguage()

  const models = createMemo(() =>
    local.model.list().filter((m) => local.model.visible({ modelID: m.id, providerID: m.provider.id })),
  )

  return (
    <List
      class={`flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${props.class ?? ""}`}
      search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
      emptyMessage={language.t("dialog.model.empty")}
      key={(x) => `${x.provider.id}:${x.id}`}
      items={models}
      filterKeys={["provider.name", "name", "id"]}
      sortBy={(a, b) => a.name.localeCompare(b.name)}
      groupBy={(x) => x.provider.name}
      sortGroupsBy={(a, b) => {
        const aProvider = a.items[0].provider.id
        const bProvider = b.items[0].provider.id
        if (popularProviders.includes(aProvider) && !popularProviders.includes(bProvider)) return -1
        if (!popularProviders.includes(aProvider) && popularProviders.includes(bProvider)) return 1
        return popularProviders.indexOf(aProvider) - popularProviders.indexOf(bProvider)
      }}
      onSelect={(x) => {
        if (x) {
          props.onSelect({ providerID: x.provider.id, modelID: x.id })
        }
      }}
    >
      {(i) => (
        <div class="w-full flex items-center gap-x-2 text-13-regular px-2 py-1.5 hover:bg-surface-raised-base rounded cursor-pointer">
          <span class="truncate">{i.name}</span>
          <Show when={isFree(i.provider.id, i.cost)}>
            <Tag>{language.t("model.tag.free")}</Tag>
          </Show>
          <Show when={i.latest}>
            <Tag>{language.t("model.tag.latest")}</Tag>
          </Show>
        </div>
      )}
    </List>
  )
}

function AgentModelPopover(props: {
  children: JSX.Element
  onSelect: (model: { providerID: string; modelID: string }) => void
  disabled?: boolean
}) {
  const language = useLanguage()
  const [store, setStore] = createStore<{
    open: boolean
    dismiss: "escape" | "outside" | null
  }>({
    open: false,
    dismiss: null,
  })

  return (
    <Kobalte
      open={store.open}
      onOpenChange={(next) => {
        if (next) setStore("dismiss", null)
        setStore("open", next)
      }}
      modal={false}
      placement="top-start"
      gutter={4}
    >
      <Kobalte.Trigger as="div">{props.children}</Kobalte.Trigger>
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onEscapeKeyDown={(event) => {
            setStore("dismiss", "escape")
            setStore("open", false)
            event.preventDefault()
            event.stopPropagation()
          }}
          onPointerDownOutside={() => {
            setStore("dismiss", "outside")
            setStore("open", false)
          }}
          onFocusOutside={() => {
            setStore("dismiss", "outside")
            setStore("open", false)
          }}
          onCloseAutoFocus={(event) => {
            if (store.dismiss === "outside") event.preventDefault()
            setStore("dismiss", null)
          }}
        >
          <Kobalte.Title class="sr-only">{language.t("dialog.model.select.title")}</Kobalte.Title>
          <AgentModelList
            class="p-1"
            onSelect={(model) => {
              props.onSelect(model)
              setStore("open", false)
            }}
          />
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}

function AgentRow(props: {
  name: string
  modelOverride: { providerID: string; modelID: string } | undefined
  loading: boolean
  onUpdate: (model: { providerID: string; modelID: string }) => Promise<boolean>
}) {
  const local = useLocal()
  const [pending, setPending] = createSignal(false)

  const currentModel = createMemo(() => {
    if (!props.modelOverride) return undefined
    return local.model
      .list()
      .find((m) => m.provider.id === props.modelOverride!.providerID && m.id === props.modelOverride!.modelID)
  })

  const formatModelName = () => {
    const model = currentModel()
    if (!model) return "—"
    return model.name
  }

  const handleModelSelect = async (model: { providerID: string; modelID: string }) => {
    setPending(true)
    try {
      await props.onUpdate(model)
    } finally {
      setPending(false)
    }
  }

  return (
    <div class="flex items-center gap-2 min-w-0">
      <span class="text-12-regular text-text-base flex-1 min-w-0 truncate">{props.name}</span>
      <AgentModelPopover onSelect={handleModelSelect} disabled={props.loading || pending()}>
        <Button
          variant="ghost"
          size="small"
          class="h-6 px-2 text-11-regular shrink-0"
          disabled={props.loading || pending()}
        >
          {formatModelName()}
        </Button>
      </AgentModelPopover>
    </div>
  )
}

export function AgentModelsPanel() {
  const sync = useSync()
  const params = useParams()
  const agentModels = useAgentModels()

  // Get display profile name
  const displayProfile = createMemo(() => {
    if (params.id) {
      const session = sync.data.session.find((s) => s.id === params.id)
      if (session?.profile) return session.profile
    }
    return sync.data.active_profile ?? "default"
  })

  return (
    <div class="px-4 py-3 border-b border-border-weak-base">
      <div class="flex items-center gap-2 min-w-0">
        <Icon name="models" size="small" class="text-icon-base shrink-0" />
        <Tooltip
          placement="top"
          value="Configure AI models used by different agents. Each agent type (alice, sentinel, scout, etc.) can use different models for specialized tasks."
        >
          <div class="flex flex-col flex-1 min-w-0">
            <span class="text-12-medium text-text-strong">Agent Models</span>
            <span class="text-11-regular text-text-weaker truncate">{displayProfile()}</span>
          </div>
        </Tooltip>
        <Show when={agentModels.loading()}>
          <span class="text-11-regular text-text-weaker shrink-0">Loading...</span>
        </Show>
      </div>
      <div class="flex flex-col gap-2 mt-2">
        <Switch>
          <Match when={agentModels.error()}>
            <span class="text-12-regular text-error">{agentModels.error()}</span>
          </Match>
          <Match when={agentModels.agents().length === 0}>
            <span class="text-12-regular text-text-weaker">—</span>
          </Match>
          <Match when={true}>
            <For each={agentModels.agents()}>
              {(agent) => {
                const modelOverride = createMemo(() => agentModels.agentModels()[agent.name])

                return (
                  <AgentRow
                    name={agent.name}
                    modelOverride={modelOverride()}
                    loading={agentModels.loading()}
                    onUpdate={(model) => agentModels.updateAgentModel(agent.name, model)}
                  />
                )
              }}
            </For>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
