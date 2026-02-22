import { TextAttributes, RGBA } from "@opentui/core"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { useLocal } from "@tui/context/local"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../ui/toast"
import { DialogReviewFocus } from "./dialog-review-focus"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { Spinner } from "./spinner"

const OPTIONS = [
  {
    id: "test",
    label: "Run tests",
    description: "create and run tests for the completed work",
  },
  {
    id: "review",
    label: "Review",
    description: "review the completed implementation",
  },
  {
    id: "custom",
    label: "Custom...",
    description: "type a follow-up instruction",
  },
  {
    id: "dismiss",
    label: "Dismiss",
    description: "close this dialog",
  },
] as const

type OptionId = (typeof OPTIONS)[number]["id"]

export function DialogWorkComplete(props: {
  sessionID: string
  /** Called with the user's text after Custom... is confirmed. Caller is responsible for clearing the dialog. */
  onCustom?: (text: string) => void
}) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const local = useLocal()
  const sdk = useSDK()
  const toast = useToast()
  const fg = selectedForeground(theme)

  const [cursor, setCursor] = createSignal(0)
  const [loading, setLoading] = createSignal(false)

  /**
   * Compact the session history before handing off to a new agent so the
   * review/test agent starts from a clean, focused summary of what was built
   * rather than the full verbose work-agent transcript.
   */
  async function summarize() {
    const model = local.model.current()
    if (!model) return
    try {
      await sdk.client.session.summarize({
        sessionID: props.sessionID,
        modelID: model.modelID,
        providerID: model.providerID,
      })
    } catch {
      toast.show({ variant: "warning", message: "Failed to compact session — continuing anyway", duration: 3000 })
    }
  }

  async function confirm(id: OptionId) {
    if (loading()) return
    if (id === "test") {
      setLoading(true)
      await summarize()
      setLoading(false)
      local.agent.set("test")
      dialog.clear()
    } else if (id === "review") {
      setLoading(true)
      await summarize()
      setLoading(false)
      local.agent.set("review")
      dialog.replace(() => <DialogReviewFocus />)
    } else if (id === "custom") {
      DialogPrompt.show(dialog, "What would you like to do next?", {
        placeholder: "Describe your follow-up task...",
      })
        .then((value) => {
          if (value?.trim()) props.onCustom?.(value.trim())
        })
        .catch(() => {})
    } else {
      dialog.clear()
    }
  }

  useKeyboard((evt) => {
    // Block all key events while compacting — prevent bubbling to other UI elements
    if (loading()) {
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      evt.stopPropagation()
      let next = cursor() - 1
      if (next < 0) next = OPTIONS.length - 1
      setCursor(next)
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      evt.stopPropagation()
      let next = cursor() + 1
      if (next >= OPTIONS.length) next = 0
      setCursor(next)
    }
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      confirm(OPTIONS[cursor()].id)
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Work complete
          </text>
          <Show when={!loading()}>
            <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
              esc
            </text>
          </Show>
        </box>
        <box paddingTop={1}>
          <Show
            when={loading()}
            fallback={<text fg={theme.textMuted}>What would you like to do next?</text>}
          >
            <Spinner>Compacting session…</Spinner>
          </Show>
        </box>
      </box>
      <Show when={!loading()}>
        <box paddingLeft={2} paddingRight={2}>
          <For each={OPTIONS}>
            {(option, i) => {
              const active = () => i() === cursor()
              return (
                <box
                  flexDirection="row"
                  paddingLeft={2}
                  paddingRight={2}
                  gap={1}
                  backgroundColor={active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                  onMouseUp={() => confirm(option.id)}
                  onMouseOver={() => setCursor(i())}
                >
                  <text
                    flexGrow={1}
                    fg={active() ? fg : theme.text}
                    attributes={active() ? TextAttributes.BOLD : undefined}
                  >
                    {option.label}
                    <span style={{ fg: active() ? fg : theme.textMuted }}> {option.description}</span>
                  </text>
                </box>
              )
            }}
          </For>
        </box>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="row" gap={3}>
          <text>
            <span style={{ fg: theme.text }}>
              <b>↑↓</b>
            </span>{" "}
            <span style={{ fg: theme.textMuted }}>navigate</span>
          </text>
          <text>
            <span style={{ fg: theme.text }}>
              <b>enter</b>
            </span>{" "}
            <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
        </box>
      </Show>
    </box>
  )
}
