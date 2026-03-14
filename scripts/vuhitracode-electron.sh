#!/bin/bash
# vuhitracode-electron — start the full OpenCode stack and open in Electron
# Installed by: bash scripts/vuhitracode-electron.sh --install
# Usage: vuhitracode-electron [--detach] | stop | --install

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

install_self() {
  local dest="$HOME/.local/bin/vuhitracode-electron"
  mkdir -p "$HOME/.local/bin"
  sed \
    -e "s|PKGDIR=.*|PKGDIR=\"$(cd "$(dirname "$0")/../packages/opencode" && pwd)\"|" \
    -e "s|WEBDIR=.*|WEBDIR=\"$(cd "$(dirname "$0")/../packages/app" && pwd)\"|" \
    -e "s|ELECTRONDIR=.*|ELECTRONDIR=\"$(cd "$(dirname "$0")/../packages/electron" && pwd)\"|" \
    "$0" > "$dest"
  chmod +x "$dest"
  echo "Installed: vuhitracode-electron → $dest"
}

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

  if [ "$detach" = "1" ]; then
    echo "Starting (detached) backend on :4096, web on :4444, then Electron ..."
    {
      "$BUN" run --cwd "$PKGDIR" --conditions=browser src/index.ts serve --port 4096 &
      echo $! >> "$PIDFILE"
      "$BUN" --cwd "$WEBDIR" dev -- --port 4444 &
      echo $! >> "$PIDFILE"
      wait_ready
      (cd "$ELECTRONDIR" && "$BUN" x electron .) &
      echo $! >> "$PIDFILE"
      wait
    } >> "$LOGFILE" 2>&1 &
    disown
    echo "Logs: $LOGFILE  |  PIDs: $PIDFILE"
    echo "Stop with: vuhitracode-electron stop"
  else
    echo "Starting backend on :4096 and web dev on :4444 ..."
    trap 'echo ""; echo "Shutting down..."; kill 0' INT TERM EXIT

    "$BUN" run --cwd "$PKGDIR" --conditions=browser src/index.ts serve --port 4096 &
    "$BUN" --cwd "$WEBDIR" dev -- --port 4444 &

    wait_ready || { kill 0; exit 1; }

    echo "Launching Electron ..."
    (cd "$ELECTRONDIR" && "$BUN" x electron .)

    echo "Electron closed. Shutting down servers ..."
    kill 0
  fi
}

case "${1:-}" in
  --install) install_self ;;
  stop)      stop ;;
  -d|--detach) start "$1" ;;
  "")        start ;;
  *)
    echo "Usage: $(basename "$0") [--detach] | stop | --install" >&2
    exit 1
    ;;
esac
