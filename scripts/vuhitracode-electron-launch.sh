#!/bin/bash
# Desktop launcher wrapper — reads display env from systemd user session
# so it works when invoked from a .desktop file (which has no display env)

# If already running, do nothing
PIDFILE="${TMPDIR:-/tmp}/vuhitracode-electron.pid"
if [ -f "$PIDFILE" ]; then
  while IFS= read -r pid; do
    kill -0 "$pid" 2>/dev/null && exit 0
  done < "$PIDFILE"
fi

# Pull display vars from the systemd user environment (always correct for current session)
while IFS='=' read -r key val; do
  case "$key" in
    DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS)
      export "$key=$val"
      ;;
  esac
done < <(systemctl --user show-environment)

exec systemd-run --user --scope --slice=app.slice -q \
  --setenv=DISPLAY="$DISPLAY" \
  --setenv=WAYLAND_DISPLAY="$WAYLAND_DISPLAY" \
  --setenv=XAUTHORITY="$XAUTHORITY" \
  --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
  --setenv=DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
  vuhitracode-electron --detach
