import { cmd } from "./cmd"
import { UI } from "../ui"
import path from "path"
import os from "os"
import fs from "fs"

const pidDir = path.join(os.homedir(), ".vuhitracode")
const pidFile = path.join(pidDir, "electron.pid")

// Anchor to the electron package relative to this file's location
// This file lives at: packages/opencode/src/cli/cmd/electron.ts
// Electron package:   packages/electron
const dir = path.resolve(import.meta.dir, "../../../../electron")
const bin = path.join(dir, "node_modules", ".bin", "electron")

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function readPid() {
  if (!fs.existsSync(pidFile)) return null
  const raw = await Bun.file(pidFile).text()
  const pid = parseInt(raw.trim(), 10)
  return isNaN(pid) ? null : pid
}

async function launch() {
  // Guard: ensure electron binary exists
  if (!fs.existsSync(bin)) {
    UI.error(`Electron binary not found: ${bin}`)
    process.exit(1)
  }

  const proc = Bun.spawn([bin, "."], {
    cwd: dir,
    stdio: ["ignore", "ignore", "ignore"],
  })
  proc.unref()

  if (!proc.pid) throw new Error("Failed to launch electron: no PID assigned")

  // Ensure PID dir exists, then write PID file
  fs.mkdirSync(pidDir, { recursive: true })
  await Bun.write(pidFile, String(proc.pid))

  return proc.pid
}

async function stop() {
  const pid = await readPid()
  if (!pid) return false
  if (!alive(pid)) {
    fs.rmSync(pidFile, { force: true })
    return false
  }
  process.kill(pid, "SIGTERM")
  // Poll for process death (up to 2s), then SIGKILL
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100)
    if (!alive(pid)) break
    if (i === 19) process.kill(pid, "SIGKILL")
  }
  fs.rmSync(pidFile, { force: true })
  return true
}

const StartCommand = cmd({
  command: "start",
  describe: "start the electron app",
  async handler() {
    const existing = await readPid()
    if (existing && alive(existing)) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "  Electron already running", UI.Style.TEXT_NORMAL, `pid ${existing}`)
      return
    }
    const pid = await launch()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Electron started   ", UI.Style.TEXT_NORMAL, `pid ${pid}`)
  },
})

const RestartCommand = cmd({
  command: "restart",
  describe: "restart the electron app",
  async handler() {
    const was = await stop()
    if (!was) UI.println(UI.Style.TEXT_WARNING_BOLD + "  No running electron instance found; starting fresh.")
    const pid = await launch()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Electron restarted ", UI.Style.TEXT_NORMAL, `pid ${pid}`)
  },
})

export const ElectronCommand = cmd({
  command: "electron",
  describe: "manage the electron app",
  builder: (yargs) =>
    yargs.command(StartCommand).command(RestartCommand).demandCommand(1, "Specify a subcommand: start | restart"),
  async handler() {},
})
