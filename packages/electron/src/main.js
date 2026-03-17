"use strict"

const { app, BrowserWindow, shell, net } = require("electron")
const path = require("path")

const URL = "http://localhost:4444" // local dev server — plain HTTP is intentional

function probe() {
  return new Promise((resolve) => {
    const req = net.request(URL)
    req.setTimeout(2000)
    req.on("response", (res) => {
      res.resume() // drain so socket is released
      resolve(true)
    })
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.abort()
      resolve(false)
    })
    req.end()
  })
}

async function waitAndLoad(win, retries = 30, interval = 1000) {
  for (let i = 0; i < retries; i++) {
    if (win.isDestroyed()) return
    if (await probe()) {
      win.loadURL(URL).catch(console.error)
      return
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  // timed out — show error page
  win.loadFile(path.join(__dirname, "error.html")).catch(console.error)
}

function create() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "VuhitraCode",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  waitAndLoad(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url)
    return { action: "deny" }
  })

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(URL)) {
      event.preventDefault()
      if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url)
    }
  })

  win.webContents.on("will-redirect", (event, url) => {
    if (!url.startsWith(URL)) {
      event.preventDefault()
      if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url)
    }
  })
}

app.setAppUserModelId("vuhitracode-electron")

app.whenReady().then(create)

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) create()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
