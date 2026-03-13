import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"

export function DialogBecomeFriend(props: { sessionID: string; directory: string; onSuccess: () => void }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const [store, setStore] = createStore({ masterID: "", error: "", submitting: false })

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    const masterID = store.masterID.trim()
    if (!masterID) {
      setStore("error", "Session ID is required")
      return
    }
    setStore("submitting", true)
    setStore("error", "")
    const slug = props.directory.split("/").filter(Boolean).at(-1) ?? props.directory
    try {
      const res = await fetch(`${globalSDK.url}/bridge/set-friend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": props.directory,
        },
        body: JSON.stringify({
          masterIDOrSlug: masterID,
          sessionID: props.sessionID,
          slug,
          title: slug,
          directory: props.directory,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setStore("error", (body as { error?: string }).error ?? `HTTP ${res.status}`)
        return
      }
      showToast({ variant: "success", title: "Joined bridge as friend" })
      props.onSuccess()
      dialog.close()
    } catch (e) {
      setStore("error", e instanceof Error ? e.message : String(e))
    } finally {
      setStore("submitting", false)
    }
  }

  return (
    <Dialog title="Join as Friend" class="w-full max-w-[480px] mx-auto">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
        <p class="text-14-regular text-text-weak">
          Enter the master's session ID to join this project to an existing bridge.
        </p>
        <TextField
          autofocus
          type="text"
          label="Master Session ID"
          placeholder="ses_..."
          value={store.masterID}
          onChange={(v) => {
            setStore("masterID", v)
            setStore("error", "")
          }}
          validationState={store.error ? "invalid" : undefined}
          error={store.error || undefined}
          disabled={store.submitting}
          class="font-mono"
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" disabled={store.submitting} onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={store.submitting}>
            {store.submitting ? "Joining…" : "Join"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
