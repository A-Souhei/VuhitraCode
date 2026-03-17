#!/bin/bash
# vuhitracode-electron — start the full OpenCode stack and open in Electron
# Installed by: make install-electron  (paths are baked in at install time)
# Usage: vuhitracode-electron [--detach] | stop

PKGDIR="$(cd "$(dirname "$0")/../packages/opencode" 2>/dev/null && pwd)"
WEBDIR="$(cd "$(dirname "$0")/../packages/app" 2>/dev/null && pwd)"
ELECTRONDIR="$(cd "$(dirname "$0")/../packages/electron" 2>/dev/null && pwd)"

# Ensure nvm-managed node is on PATH (desktop sessions skip ~/.bashrc / ~/.profile)
NVM_DEFAULT="$HOME/.nvm/alias/default"
if [ -f "$NVM_DEFAULT" ]; then
  NVM_VER=$(cat "$NVM_DEFAULT")
  NVM_NODE=$(ls -d "$HOME/.nvm/versions/node/v${NVM_VER}"* 2>/dev/null | sort -V | tail -1)
  [ -d "$NVM_NODE/bin" ] && export PATH="$NVM_NODE/bin:$PATH"
fi
# Also ensure bun is on PATH
export PATH="$HOME/.bun/bin:$PATH"

BUN=$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")
if [ ! -x "$BUN" ]; then
  echo "Error: bun not found in PATH or ~/.bun/bin" >&2
  exit 1
fi

LOGFILE="${TMPDIR:-/tmp}/vuhitracode-electron.log"
PIDFILE="${TMPDIR:-/tmp}/vuhitracode-electron.pid"

# --no-sandbox is only needed on Linux (chrome-sandbox SUID requirement)
SANDBOX_FLAG=""
[ "$(uname)" = "Linux" ] && SANDBOX_FLAG="--no-sandbox"

wait_ready() {
  # prefer curl, fall back to nc
  local check
  if command -v curl >/dev/null 2>&1; then
    check() { curl -s http://localhost:4444 >/dev/null 2>&1; }
  elif command -v nc >/dev/null 2>&1; then
    check() { nc -z localhost 4444 >/dev/null 2>&1; }
  else
    echo "Error: neither curl nor nc found — cannot poll for server readiness" >&2
    return 1
  fi
  local tries=0
  printf "Waiting for web server on :4444 "
  while ! check; do
    sleep 1
    tries=$((tries + 1))
    printf "."
    if [ "$tries" -ge 30 ]; then
      echo ""
      echo "Error: web server did not start within 30s" >&2
      return 1
    fi
  done
  echo " ready."
}

stop() {
  echo "Stopping processes on ports 4096 and 4444 ..."
  fuser -k 4096/tcp 4444/tcp 2>/dev/null || true
  if [ -f "$PIDFILE" ]; then
    while IFS= read -r pid; do
      kill "$pid" 2>/dev/null || true
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  echo "Done."
}

start() {
  for dir in "$PKGDIR" "$WEBDIR" "$ELECTRONDIR"; do
    if [ ! -d "$dir" ]; then
      echo "Error: directory not found: $dir — re-run: make install-electron" >&2
      exit 1
    fi
  done

  # clear stale PID file from previous (possibly crashed) run
  rm -f "$PIDFILE"

  local detach=0
  [ "${1:-}" = "-d" ] || [ "${1:-}" = "--detach" ] && detach=1

  local electron="$ELECTRONDIR/node_modules/.bin/electron"
  if [ ! -x "$electron" ]; then
    echo "Installing Electron dependencies ..."
    "$BUN" install --cwd "$ELECTRONDIR"
  fi

  # bun skips post-install scripts; resolve the real module dir portably and
  # run install.js (which downloads the platform binary) if dist/electron is missing
  local node_bin
  node_bin=$(command -v node 2>/dev/null || true)
  if [ -z "$node_bin" ]; then
    echo "Error: node not found in PATH — required to download the Electron binary" >&2
    exit 1
  fi
  local electron_module
  electron_module=$("$node_bin" -e "process.stdout.write(require.resolve('electron/package.json', {paths: ['$ELECTRONDIR']}).replace(/package\.json$/,''))")
  if [ ! -x "${electron_module}dist/electron" ]; then
    echo "Downloading Electron binary ..."
    "$node_bin" "${electron_module}install.js"
  fi

  if [ "$detach" = "1" ]; then
    echo "Starting backend on :4096 and web on :4444 (detached) ..."
    "$BUN" run --cwd "$PKGDIR" --conditions=browser src/index.ts serve --port 4096 \
      >> "$LOGFILE" 2>&1 &
    BUN_BACKEND_PID=$!
    echo $BUN_BACKEND_PID >> "$PIDFILE"
    "$BUN" --cwd "$WEBDIR" dev -- --port 4444 \
      >> "$LOGFILE" 2>&1 &
    BUN_WEB_PID=$!
    echo $BUN_WEB_PID >> "$PIDFILE"

    wait_ready || { kill "$BUN_BACKEND_PID" "$BUN_WEB_PID" 2>/dev/null; exit 1; }

    echo "Launching Electron ..."
    # use exec so $! is the actual Electron PID, not a subshell wrapper
    ( cd "$ELECTRONDIR" && exec "$electron" . $SANDBOX_FLAG --app-id=vuhitracode-electron ) &
    echo $! >> "$PIDFILE"
    disown
    echo "Logs: $LOGFILE  |  PIDs: $PIDFILE"
    echo "Stop with: vuhitracode-electron stop"
  else
    echo "Starting backend on :4096 and web dev on :4444 ..."
    trap 'echo ""; echo "Shutting down..."; kill "$BUN_BACKEND_PID" "$BUN_WEB_PID" 2>/dev/null' INT TERM EXIT

    "$BUN" run --cwd "$PKGDIR" --conditions=browser src/index.ts serve --port 4096 \
      >> "$LOGFILE" 2>&1 &
    BUN_BACKEND_PID=$!
    "$BUN" --cwd "$WEBDIR" dev -- --port 4444 \
      >> "$LOGFILE" 2>&1 &
    BUN_WEB_PID=$!

    wait_ready || { kill "$BUN_BACKEND_PID" "$BUN_WEB_PID" 2>/dev/null; exit 1; }

    echo "Launching Electron ..."
    ( cd "$ELECTRONDIR" && exec "$electron" . $SANDBOX_FLAG --app-id=vuhitracode-electron )

    echo "Electron closed. Shutting down servers ..."
    kill "$BUN_BACKEND_PID" "$BUN_WEB_PID" 2>/dev/null
  fi
}

case "${1:-}" in
  stop)           stop ;;
  restart)        stop; start -d ;;
  -d|--detach)    start "$1" ;;
  "")             start ;;
  *)
    echo "Usage: $(basename "$0") [--detach] | stop | restart" >&2
    exit 1
    ;;
esac
