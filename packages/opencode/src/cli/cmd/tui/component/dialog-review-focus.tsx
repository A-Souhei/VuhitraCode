import { TextAttributes, RGBA } from "@opentui/core"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { createMemo, createSignal, For } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { useLocal } from "@tui/context/local"

export const REVIEW_FOCUS_AREAS = [
  { id: "security", label: "Security", description: "injections, auth flaws, data exposure, input validation" },
  { id: "performance", label: "Performance", description: "query patterns, loop cost, caching, resource usage" },
  { id: "logic", label: "Logic", description: "edge cases, branching mistakes, null handling, race conditions" },
  { id: "style", label: "Style", description: "naming, consistency, dead code, duplication" },
  { id: "tests", label: "Tests", description: "coverage gaps, weak assertions, untested paths" },
  { id: "docs", label: "Docs", description: "missing context, stale comments, unclear interfaces" },
] as const

export type ReviewFocusId = (typeof REVIEW_FOCUS_AREAS)[number]["id"]

export function DialogReviewFocus() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const local = useLocal()

  const [cursor, setCursor] = createSignal(0)
  const [checked, setChecked] = createStore<Record<string, boolean>>(
    Object.fromEntries(local.review.selected().map((id) => [id, true])),
  )

  function toggle(index: number) {
    const id = REVIEW_FOCUS_AREAS[index].id
    setChecked(id, (v) => !v)
  }

  function move(direction: 1 | -1) {
    let next = cursor() + direction
    if (next < 0) next = REVIEW_FOCUS_AREAS.length - 1
    if (next >= REVIEW_FOCUS_AREAS.length) next = 0
    setCursor(next)
  }

  function confirm() {
    const selected = REVIEW_FOCUS_AREAS.filter((a) => checked[a.id]).map((a) => a.id)
    local.review.set(selected as ReviewFocusId[])
    dialog.clear()
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      evt.stopPropagation()
      move(-1)
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      evt.stopPropagation()
      move(1)
    }
    if (evt.name === "space") {
      evt.preventDefault()
      evt.stopPropagation()
      toggle(cursor())
    }
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      confirm()
    }
  })

  const selectedCount = createMemo(() => REVIEW_FOCUS_AREAS.filter((a) => checked[a.id]).length)
  const fg = selectedForeground(theme)

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Review focus areas
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.textMuted}>space to toggle · enter to confirm · leave empty for full review</text>
        </box>
      </box>
      <box paddingLeft={2} paddingRight={2}>
        <For each={REVIEW_FOCUS_AREAS}>
          {(area, i) => {
            const active = createMemo(() => i() === cursor())
            const isChecked = createMemo(() => !!checked[area.id])
            return (
              <box
                flexDirection="row"
                paddingLeft={2}
                paddingRight={2}
                gap={1}
                backgroundColor={active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                onMouseUp={() => {
                  setCursor(i())
                  toggle(i())
                }}
                onMouseOver={() => setCursor(i())}
              >
                <text
                  flexShrink={0}
                  fg={active() ? fg : isChecked() ? theme.success : theme.textMuted}
                  attributes={TextAttributes.BOLD}
                >
                  {isChecked() ? "[x]" : "[ ]"}
                </text>
                <text
                  flexGrow={1}
                  fg={active() ? fg : theme.text}
                  attributes={active() ? TextAttributes.BOLD : undefined}
                >
                  {area.label}
                  <span style={{ fg: active() ? fg : theme.textMuted }}> {area.description}</span>
                </text>
              </box>
            )
          }}
        </For>
      </box>
      <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="row" gap={3}>
        <text>
          <span style={{ fg: theme.text }}>
            <b>space</b>
          </span>{" "}
          <span style={{ fg: theme.textMuted }}>toggle</span>
        </text>
        <text>
          <span style={{ fg: theme.text }}>
            <b>enter</b>
          </span>{" "}
          <span style={{ fg: selectedCount() > 0 ? theme.text : theme.textMuted }}>
            {selectedCount() > 0 ? `confirm (${selectedCount()} selected)` : "confirm (all areas)"}
          </span>
        </text>
      </box>
    </box>
  )
}
