import { app, BrowserWindow, dialog, shell } from "electron"
import { execSync, spawn } from "child_process"
import * as http from "http"
import * as path from "path"

const WEB_URL = "http://localhost:4444"
const READY_TIMEOUT = 60_000
const POLL_INTERVAL = 500

function webCmd(cmd: string, ...args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const isStart = cmd === "start"
    const proc = spawn("vuhitracode-web", [cmd, ...args], {
      stdio: "inherit",
      detached: isStart,
      shell: true,
    })
    if (isStart) {
      proc.unref()
      resolve()
      return
    }
    proc.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`vuhitracode-web ${cmd} exited with code ${code}`))
    })
    proc.on("error", reject)
  })
}

function poll(url: string, timeout: number, interval: number): Promise<void> {
  const deadline = Date.now() + timeout
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`))
      http
        .get(url, (res) => {
          res.resume()
          if (res.statusCode && res.statusCode < 500) return resolve()
          setTimeout(attempt, interval)
        })
        .on("error", () => setTimeout(attempt, interval))
    }
    attempt()
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "OpenCode",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadURL(WEB_URL)

  // Open external links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin !== new URL(WEB_URL).origin) {
      shell.openExternal(url)
      return { action: "deny" }
    }
    return { action: "allow" }
  })
}

async function main() {
  await app.whenReady()

  // Verify vuhitracode-web is installed
  const check = process.platform === "win32" ? "where vuhitracode-web" : "which vuhitracode-web"
  try {
    execSync(check, { stdio: "pipe" })
  } catch {
    dialog.showErrorBox(
      "Missing dependency",
      "vuhitracode-web is not installed or not in PATH.\nRun `make install` from the opencode repository.",
    )
    app.quit()
    return
  }

  // Start the web stack (detached)
  await webCmd("start", "-d")

  // Wait until the web server is up
  await poll(WEB_URL, READY_TIMEOUT, POLL_INTERVAL)

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("will-quit", () => {
  try {
    execSync("vuhitracode-web stop", { stdio: "inherit", timeout: 5000 })
  } catch {
    // best-effort
  }
})

main().catch((err) => {
  console.error("Electron startup failed:", err)
  app.quit()
})
