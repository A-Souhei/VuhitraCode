import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { Snapshot } from "../snapshot"
import { Truncate } from "../tool/truncation"
import { Indexer } from "../indexer"
import { Memory } from "../memory"
import { Biblion } from "../biblion"
import { Profiles } from "./profiles"
import { Bridge } from "../bridge"
import { SessionStatus } from "../session/status"
import { Question } from "../question"
import { Session } from "../session"
import { notify } from "../util/slack"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  await Profiles.ensureDefault()
  ShareNext.init()
  Format.init()
  await LSP.init()
  LSP.prewarm().catch(() => {})
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  Truncate.init()
  Indexer.init()
  Memory.init()
  Biblion.init()
  Bridge.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })

  Bus.subscribe(SessionStatus.Event.Status, async ({ properties }) => {
    if (properties.status.type !== "idle") return
    const session = await Session.get(properties.sessionID).catch(() => undefined)
    if (session?.parentID) return
    await notify(`✅ Agent turn complete (session: ${properties.sessionID})`)
  })

  Bus.subscribe(Question.Event.Asked, async ({ properties }) => {
    const session = await Session.get(properties.sessionID).catch(() => undefined)
    if (session?.parentID) return
    const questions = properties.questions.map((q) => q.question).join("\n")
    await notify(`❓ Agent is asking:\n${questions}\n_(session: ${properties.sessionID})_`)
  })
}
