import { For, createMemo, Show, Switch, Match, onMount, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { showToast } from "@opencode-ai/ui/toast"
import { useSubagentModels } from "@/hooks/use-subagent-models"
import { useLocal } from "@/context/local"
import { useLanguage } from "@/context/language"
import { popularProviders } from "@/hooks/use-providers"

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

function SubagentModelList(props: {
  onSelect: (model: { providerID: string; modelID: string }) => void
  class?: string
}) {
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

function SubagentModelPopover(props: {
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
          <SubagentModelList
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

function SubagentRow(props: {
  name: string
  modelLock: boolean
  modelOverride: { providerID: string; modelID: string } | undefined
  configuredModel: { providerID: string; modelID: string } | undefined
  loading: boolean
  onUpdate: (model: { providerID: string; modelID: string }) => Promise<boolean>
}) {
  const local = useLocal()
  const [pending, setPending] = createSignal(false)

  const currentModel = createMemo(() => {
    const modelKey = props.modelOverride ?? props.configuredModel
    if (!modelKey) return undefined
    return local.model.list().find((m) => m.provider.id === modelKey.providerID && m.id === modelKey.modelID)
  })

  const formatModelName = () => {
    const model = currentModel()
    if (!model) return "—"
    return model.name
  }

  const handleModelSelect = async (model: { providerID: string; modelID: string }) => {
    if (props.modelLock) {
      showToast({
        variant: "error",
        title: "Model locked",
        description: `${props.name} has a locked model configuration`,
      })
      return
    }
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
      <Show when={props.modelLock}>
        <span class="text-11-regular text-text-weaker shrink-0">{formatModelName()} (locked)</span>
      </Show>
      <Show when={!props.modelLock}>
        <SubagentModelPopover onSelect={handleModelSelect} disabled={props.loading || pending()}>
          <Button
            variant="ghost"
            size="small"
            class="h-6 px-2 text-11-regular shrink-0"
            disabled={props.loading || pending()}
          >
            {formatModelName()}
          </Button>
        </SubagentModelPopover>
      </Show>
    </div>
  )
}

export function SubagentModelsPanel() {
  const subagentModels = useSubagentModels()

  // Fetch subagent models on mount
  onMount(() => {
    subagentModels.fetchSubagentModels()
  })

  // Handle model selection
  const handleModelSelect = async (name: string, model: { providerID: string; modelID: string }) => {
    return subagentModels.updateSubagentModel(name, model)
  }

  return (
    <div class="px-4 py-3 border-b border-border-weak-base">
      <div class="flex items-center gap-2 min-w-0">
        <Icon name="sliders" size="small" class="text-icon-base shrink-0" />
        <span class="text-12-medium text-text-strong flex-1 min-w-0">Subagent Models</span>
        <Show when={subagentModels.loading()}>
          <span class="text-11-regular text-text-weaker shrink-0">Loading...</span>
        </Show>
      </div>
      <div class="flex flex-col gap-2 mt-2">
        <Switch>
          <Match when={subagentModels.error()}>
            <span class="text-12-regular text-error">{subagentModels.error()}</span>
          </Match>
          <Match when={subagentModels.subagents().length === 0}>
            <span class="text-12-regular text-text-weaker">—</span>
          </Match>
          <Match when={true}>
            <For each={subagentModels.subagents()}>
              {(agent) => {
                const modelOverride = createMemo(() => subagentModels.subagentModels()[agent.name])
                const isLocked = createMemo(() => {
                  const locks = subagentModels.modelLocks()
                  return locks[agent.name] ?? false
                })

                return (
                  <SubagentRow
                    name={agent.name}
                    modelLock={isLocked()}
                    modelOverride={modelOverride()}
                    configuredModel={agent.model}
                    loading={subagentModels.loading()}
                    onUpdate={(model) => handleModelSelect(agent.name, model)}
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
