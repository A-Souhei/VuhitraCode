#!/bin/bash
# vuhitracode-electron — start the full OpenCode stack and open in Electron
# Installed by: make install-electron  (paths are baked in at install time)
# Usage: vuhitracode-electron [--detach] | stop

PKGDIR="$(cd "$(dirname "$0")/../packages/opencode" 2>/dev/null && pwd)"
WEBDIR="$(cd "$(dirname "$0")/../packages/app" 2>/dev/null && pwd)"
ELECTRONDIR="$(cd "$(dirname "$0")/../packages/electron" 2>/dev/null && pwd)"

BUN=$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")
if [ ! -x "$BUN" ]; then
  echo "Error: bun not found in PATH or ~/.bun/bin" >&2
  exit 1
fi

LOGFILE="${TMPDIR:-/tmp}/vuhitracode-electron.log"
PIDFILE="${TMPDIR:-/tmp}/vuhitracode-electron.pid"

wait_ready() {
  local tries=0
  printf "Waiting for web server on :4444 "
  while ! curl -s http://localhost:4444 >/dev/null 2>&1; do
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
      echo "Error: directory not found: $dir — re-run --install" >&2
      exit 1
    fi
  done

  local detach=0
  [ "${1:-}" = "-d" ] || [ "${1:-}" = "--detach" ] && detach=1

  local electron="$ELECTRONDIR/node_modules/.bin/electron"
  if [ ! -x "$electron" ]; then
    echo "Installing Electron dependencies ..."
    "$BUN" install --cwd "$ELECTRONDIR"
  fi
  # bun does not run post-install scripts by default; ensure the electron binary is downloaded
  local dist
  dist="$(readlink -f "$ELECTRONDIR/node_modules/electron")/dist/electron"
  if [ ! -x "$dist" ]; then
    echo "Downloading Electron binary ..."
    node "$ELECTRONDIR/node_modules/electron/install.js"
  fi

  if [ "$detach" = "1" ]; then
    echo "Starting backend on :4096 and web on :4444 (detached) ..."
    "$BUN" run --cwd "$PKGDIR" --conditions=browser src/index.ts serve --port 4096 \
      >> "$LOGFILE" 2>&1 &
    echo $! >> "$PIDFILE"
    "$BUN" --cwd "$WEBDIR" dev -- --port 4444 \
      >> "$LOGFILE" 2>&1 &
    echo $! >> "$PIDFILE"

    wait_ready || { kill 0; exit 1; }

    echo "Launching Electron ..."
    (cd "$ELECTRONDIR" && "$electron" .) &
    echo $! >> "$PIDFILE"
    disown
    echo "Logs: $LOGFILE  |  PIDs: $PIDFILE"
    echo "Stop with: vuhitracode-electron stop"
  else
    echo "Starting backend on :4096 and web dev on :4444 ..."
    trap 'echo ""; echo "Shutting down..."; kill 0' INT TERM EXIT

    "$BUN" run --cwd "$PKGDIR" --conditions=browser src/index.ts serve --port 4096 \
      >> "$LOGFILE" 2>&1 &
    "$BUN" --cwd "$WEBDIR" dev -- --port 4444 \
      >> "$LOGFILE" 2>&1 &

    wait_ready || { kill 0; exit 1; }

    echo "Launching Electron ..."
    (cd "$ELECTRONDIR" && "$electron" .)

    echo "Electron closed. Shutting down servers ..."
    kill 0
  fi
}

case "${1:-}" in
  stop)      stop ;;
  -d|--detach) start "$1" ;;
  "")        start ;;
  *)
    echo "Usage: $(basename "$0") [--detach] | stop" >&2
    exit 1
    ;;
esac
