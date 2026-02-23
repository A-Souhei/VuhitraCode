import { Show } from "solid-js"
import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
  assignedTo?: string
  scoutId?: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const sentinelShort = () => props.assignedTo?.slice(0, 6)
  const scoutShort = () => props.scoutId?.slice(0, 6)

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        [{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        {props.content}
      </text>
      <Show when={sentinelShort()}>
        <box flexDirection="row" flexShrink={0}>
          <text style={{ fg: theme.error }}> {sentinelShort()}</text>
          <Show when={scoutShort()}>
            <text style={{ fg: theme.info }}>|{scoutShort()}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
