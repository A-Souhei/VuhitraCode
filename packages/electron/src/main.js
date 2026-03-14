"use strict"

const { app, BrowserWindow, shell } = require("electron")
const path = require("path")

const URL = "http://localhost:4444" // local dev server — plain HTTP is intentional

const errorHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>OpenCode — Not Running</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; flex-direction: column;
           align-items: center; justify-content: center; height: 100vh; margin: 0;
           background: #0f0f0f; color: #e5e5e5; }
    h1 { font-size: 1.5rem; margin-bottom: .5rem; }
    p  { color: #999; margin: .25rem 0; }
    code { background: #1e1e1e; padding: .2em .5em; border-radius: 4px; font-size: .9em; }
  </style>
</head>
<body>
  <h1>OpenCode is not running</h1>
  <p>Start the server first, then relaunch this app.</p>
  <p><code>vuhitracode-web start</code></p>
</body>
</html>
`

function showError(win) {
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(errorHtml)).catch(console.error)
}

function create() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "OpenCode",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadURL(URL).catch(() => showError(win))

  win.webContents.on("did-fail-load", (_event, errorCode) => {
    if (errorCode === -102 || errorCode === -6 || errorCode === -7) showError(win)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url)
    return { action: "deny" }
  })
}

app.whenReady().then(create)

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) create()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
