import { Env } from "@/env"

export async function notify(text: string): Promise<void> {
  const url = Env.get("SLACK_WEBHOOK_URL")
  if (!url) return
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => {})
}
