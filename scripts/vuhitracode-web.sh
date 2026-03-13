#!/bin/bash
# vuhitracode-web — start/stop the local opencode web stack
# Installed by: make install  (paths are baked in at install time)
# Usage: vuhitracode-web start [-d] | stop

PKGDIR="$(cd "$(dirname "$0")/../packages/opencode" 2>/dev/null && pwd)"
WEBDIR="$(cd "$(dirname "$0")/../packages/app" 2>/dev/null && pwd)"

BUN=$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")
if [ ! -x "$BUN" ]; then
  echo "Error: bun not found in PATH or ~/.bun/bin" >&2
  exit 1
fi

LOGFILE="${TMPDIR:-/tmp}/vuhitracode-web.log"
PIDFILE="${TMPDIR:-/tmp}/vuhitracode-web.pid"

start() {
  if [ ! -d "$PKGDIR" ]; then
    echo "Error: packages/opencode not found at $PKGDIR — re-run make install" >&2
    exit 1
  fi
  if [ ! -d "$WEBDIR" ]; then
    echo "Error: packages/app not found at $WEBDIR — re-run make install" >&2
    exit 1
  fi

  local detach=0
  [ "${1:-}" = "-d" ] && detach=1

  if [ "$detach" = "1" ]; then
    echo "Starting (detached) opencode serve on :4096 and web dev on :4444 ..."
    {
      "$BUN" run --cwd "$PKGDIR" --conditions=browser src/index.ts serve --port 4096 &
      echo $! >> "$PIDFILE"
      "$BUN" --cwd "$WEBDIR" dev -- --port 4444 &
      echo $! >> "$PIDFILE"
      wait
    } >> "$LOGFILE" 2>&1 &
    disown
    echo "Logs: $LOGFILE  |  PIDs: $PIDFILE"
    sleep 3 && xdg-open "http://localhost:4444/" &
  else
    echo "Starting opencode serve on :4096 and web dev on :4444 ..."
    trap 'kill 0' INT
    "$BUN" run --cwd "$PKGDIR" --conditions=browser src/index.ts serve --port 4096 &
    "$BUN" --cwd "$WEBDIR" dev -- --port 4444 &
    sleep 3 && xdg-open "http://localhost:4444/" &
    wait
  fi
}

stop() {
  echo "Stopping processes on ports 4096 and 4444 ..."
  fuser -k 4096/tcp 4444/tcp 2>/dev/null || true
  rm -f "$PIDFILE"
  echo "Done."
}

case "${1:-}" in
  start) start "${2:-}" ;;
  stop)  stop ;;
  *)
    echo "Usage: $(basename "$0") start [-d] | stop" >&2
    exit 1
    ;;
esac
