# @opencode-ai/electron

Electron wrapper for the OpenCode web app.

## How it works

This package wraps the existing web app served by the `vuhitracode-web` binary in an Electron window. No web app code is bundled — the Electron window simply loads `http://localhost:4444`.

The main process polls the local server with a retry loop (up to 30 s) before displaying the window, so the app always appears ready rather than showing a blank or error page on slow starts.

## Prerequisites

- [Node.js](https://nodejs.org) v20+ or [Bun](https://bun.sh)
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

### Install as a desktop app (Linux / GNOME)

Run from the repository root:

```bash
make install-electron
```

This will:

1. Copy the launcher script to `~/.local/bin/vuhitracode-electron-launch`
2. Install the `.desktop` entry to `~/.local/share/applications/`
3. Copy the app icon to `~/.local/share/icons/`
4. Copy a desktop shortcut to `~/Desktop/`
5. Run `update-desktop-database` so GNOME picks up the entry
6. Pin the app to the GNOME dash via `gsettings`

After installation, you can launch VuhitraCode from the GNOME Activities overview or from the pinned dash icon.

## Architecture

| File                                     | Role                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/main.js`                            | Electron main process — creates BrowserWindow, retry-polls the dev server, loads the URL |
| `src/preload.js`                         | Secure preload script — intentionally minimal (no Node APIs exposed)                     |
| `src/error.html`                         | Standalone error page shown when the server is not reachable after 30 s                  |
| `scripts/vuhitracode-electron.sh`        | Wrapper that starts the backend + web server then launches Electron                      |
| `scripts/vuhitracode-electron-launch.sh` | Desktop-session launcher: resolves Wayland/X11 env vars and delegates via `systemd-run`  |
| `scripts/vuhitracode-electron.desktop`   | `.desktop` entry file installed by `make install-electron`                               |

## Desktop launcher details (Linux)

Desktop sessions launched from GNOME do not inherit the user's shell environment. In particular:

- `WAYLAND_DISPLAY` / `DISPLAY` / `XAUTHORITY` are not set
- `nvm` is not initialized in desktop sessions, so the system Node (often v18) is used instead of the project's required v20+

`vuhitracode-electron-launch` resolves the display environment and delegates to `vuhitracode-electron`:

1. Reads display environment variables from `systemctl --user show-environment`
2. Delegates execution to `systemd-run --scope` with all required `--setenv=` flags, isolating the app from the GNOME session cgroup (falls back to direct exec if `systemd-run` is unavailable)

`vuhitracode-electron` (the main wrapper script) handles the nvm PATH problem:

3. Reads `~/.nvm/alias/default` and resolves the correct Node binary path, handling both versioned aliases (e.g. `v20.12.0`) and symbolic aliases (e.g. `lts/*`, `node`) via `nvm which default`

This means a crash in the app cannot propagate to the GNOME session.

## Notes

- If the app shows "VuhitraCode is not running", make sure `vuhitracode-web start` has completed before launching Electron.
- External links opened by the web app are forwarded to the system browser.
- Do **not** use `kill 0` in any launcher script — it kills the entire process group, which on GNOME Wayland includes the session itself.
