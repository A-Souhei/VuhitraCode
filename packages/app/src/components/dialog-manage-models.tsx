import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import { type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useLocal } from "@/context/local"
import { useProviders, popularProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { DialogSelectProvider } from "./dialog-select-provider"

type OllamaModel = { id: string; name: string; size: number }

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
  const providers = useProviders()
  const sdk = useSDK()

  const ollamaConnected = createMemo(() => providers.connected().some((p) => p.id === "ollama"))

  const [ollamaModels] = createResource(ollamaConnected, async (connected) => {
    if (!connected) return [] as OllamaModel[]
    const res = await fetch(`${sdk.url}/provider/ollama/models`).catch(() => null)
    if (!res || !res.ok) return [] as OllamaModel[]
    const data = (await res.json()) as { models: OllamaModel[] }
    return data.models
  })

  const enabledOllamaIds = createMemo(
    () =>
      new Set(
        local.model
          .list()
          .filter((m) => m.provider.id === "ollama")
          .map((m) => m.id),
      ),
  )

  const [secretModel, setSecretModel] = createSignal(
    local.model.list().find((m) => m.provider.id === "ollama")?.id ?? "",
  )

  const patchConfig = async (update: { enabledModels?: string[]; secretModel?: string }) => {
    await fetch(`${sdk.url}/provider/ollama/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    }).catch(() => null)
  }

  const handleConnectProvider = () => {
    dialog.show(() => <DialogSelectProvider />)
  }
  const providerRank = (id: string) => popularProviders.indexOf(id)
  const providerList = (providerID: string) => local.model.list().filter((x) => x.provider.id === providerID)
  const providerVisible = (providerID: string) =>
    providerList(providerID).every((x) => local.model.visible({ modelID: x.id, providerID: x.provider.id }))
  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((x) => {
      local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, checked)
    })
  }

  return (
    <Dialog
      title={language.t("dialog.model.manage")}
      description={language.t("dialog.model.manage.description")}
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={handleConnectProvider}>
          {language.t("command.provider.connect")}
        </Button>
      }
    >
      <Show when={ollamaConnected()}>
        <div class="px-4 py-3 border-b border-zinc-800 flex flex-col gap-2">
          <div class="text-12-medium text-zinc-400">Ollama models</div>
          <For each={ollamaModels()}>
            {(model) => (
              <div class="flex items-center justify-between py-0.5">
                <span class="text-14-medium">{model.name}</span>
                <Switch
                  checked={enabledOllamaIds().has(model.id)}
                  onChange={async (checked) => {
                    const next = checked
                      ? [...enabledOllamaIds(), model.id]
                      : [...enabledOllamaIds()].filter((id) => id !== model.id)
                    await patchConfig({ enabledModels: next })
                  }}
                  hideLabel
                >
                  {model.name}
                </Switch>
              </div>
            )}
          </For>
          <div class="text-12-medium text-zinc-400 mt-2">Secret agent model</div>
          <select
            value={secretModel()}
            onChange={async (e) => {
              const val = e.currentTarget.value
              setSecretModel(val)
              await patchConfig({ secretModel: val })
            }}
            class="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-14-medium text-zinc-100"
          >
            <For each={ollamaModels()}>{(model) => <option value={model.id}>{model.name}</option>}</For>
          </select>
        </div>
      </Show>
      <List
        search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.model.empty")}
        key={(x) => `${x?.provider?.id}:${x?.id}`}
        items={local.model.list()}
        filterKeys={["provider.name", "name", "id"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(x) => x.provider.id}
        groupHeader={(group) => {
          const provider = group.items[0].provider
          return (
            <>
              <span>{provider.name}</span>
              <Tooltip
                placement="top"
                value={language.t("dialog.model.manage.provider.toggle", { provider: provider.name })}
              >
                <Switch
                  class="-mr-1"
                  checked={providerVisible(provider.id)}
                  onChange={(checked) => setProviderVisibility(provider.id, checked)}
                  hideLabel
                >
                  {provider.name}
                </Switch>
              </Tooltip>
            </>
          )
        }}
        sortGroupsBy={(a, b) => {
          const aRank = providerRank(a.items[0].provider.id)
          const bRank = providerRank(b.items[0].provider.id)
          const aPopular = aRank >= 0
          const bPopular = bRank >= 0
          if (aPopular && !bPopular) return -1
          if (!aPopular && bPopular) return 1
          return aRank - bRank
        }}
        onSelect={(x) => {
          if (!x) return
          const key = { modelID: x.id, providerID: x.provider.id }
          local.model.setVisibility(key, !local.model.visible(key))
        }}
      >
        {(i) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <span>{i.name}</span>
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={!!local.model.visible({ modelID: i.id, providerID: i.provider.id })}
                onChange={(checked) => {
                  local.model.setVisibility({ modelID: i.id, providerID: i.provider.id }, checked)
                }}
              />
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
