# @opencode-ai/electron

Electron wrapper for the OpenCode web app.

## How it works

This package wraps the existing web app served by the `vuhitracode-web` binary in an Electron window. No web app code is bundled — the Electron window simply loads `http://localhost:4444`.

## Prerequisites

- [Node.js](https://nodejs.org) or [Bun](https://bun.sh)
- The `vuhitracode-web` binary installed and accessible in your PATH

## Usage

### Development

1. Start the web app and backend:

   ```bash
   vuhitracode-web start
   ```

2. In another terminal, from this directory:
   ```bash
   npm install   # or: bun install
   npm run dev   # launches the Electron window pointing at http://localhost:4444
   ```

### Build a distributable

```bash
npm install
npm run build
```

Output is written to `dist/`. Supports `.deb`, `.AppImage` (Linux), `.dmg` (macOS), and `.exe` (Windows).

## Architecture

| File             | Role                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `src/main.js`    | Electron main process — creates the BrowserWindow and loads the URL  |
| `src/preload.js` | Secure preload script — intentionally minimal (no Node APIs exposed) |

## Notes

- If the app shows "OpenCode is not running", make sure `vuhitracode-web start` has completed before launching Electron.
- External links opened by the web app are forwarded to the system browser.
