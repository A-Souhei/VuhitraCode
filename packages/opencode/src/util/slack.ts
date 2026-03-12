import { Env } from "@/env"

export function notify(text: string): void {
  const url = Env.get("SLACK_WEBHOOK_URL")
  if (!url || !url.startsWith("https://hooks.slack.com/")) return
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 3900) }),
  }).catch(() => {})
}
