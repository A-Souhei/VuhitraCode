// Preload script runs in the renderer process with access to Node.js APIs
// before the web page loads. Keep this minimal — expose only what's needed.
import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("electronPlatform", {
  platform: process.platform,
})
