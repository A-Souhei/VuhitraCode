#!/bin/bash
# Setup script for OpenCode language server safeguards
# This script installs monitoring, cleanup cron jobs, and emergency stop tools
# Usage: ./scripts/setup-language-server-safeguards.sh

set -e

echo "🛠️  Setting up OpenCode Language Server Safeguards..."
echo ""

# Determine user
ACTUAL_USER="${SUDO_USER:-$USER}"
USER_HOME=$(eval echo ~$ACTUAL_USER)
BIN_DIR="$USER_HOME/.local/bin"
CONFIG_DIR="$USER_HOME/.config/systemd/user"
LOG_DIR="$USER_HOME/.local/share/opencode"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Create directories
echo "📁 Creating directories..."
mkdir -p "$BIN_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$LOG_DIR"

# Create monitor script
echo "📝 Installing monitor script..."
cat > "$BIN_DIR/monitor-opencode.sh" << 'MONITOR_EOF'
#!/bin/bash
# Real-time monitor to prevent language server crashes

LOG_FILE="${LOG_FILE:-$HOME/.local/share/opencode/monitor.log}"
JDTLS_MAX=5          # Max JDTLS instances allowed
JDTLS_MEMORY=2000    # Max memory per JDTLS process (MB)
LUA_MAX=2            # Max Lua processes allowed  
LUA_MEMORY=1000      # Max memory per Lua process (MB)
ASTRO_MAX=3          # Max Astro.js language server instances
ASTRO_MEMORY=800     # Max memory per Astro instance (MB)
BASH_MAX=5           # Max Bash language server instances
BASH_MEMORY=200      # Max memory per Bash instance (MB)
TYPESCRIPT_MAX=5     # Max TypeScript language server instances
TYPESCRIPT_MEMORY=500 # Max memory per TypeScript instance (MB)
YAML_MAX=3           # Max YAML language server instances
YAML_MEMORY=200      # Max memory per YAML instance (MB)
CHECK_INTERVAL=30    # Check every 30 seconds

log_event() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log_event "Monitor started"

while true; do
    # Count JDTLS processes
    jdtls_count=$(ps aux | grep "jdtls" | grep -v grep | wc -l)
    if [ "$jdtls_count" -gt "$JDTLS_MAX" ]; then
        log_event "WARNING: $jdtls_count JDTLS processes (max: $JDTLS_MAX) - killing excess"
        ps aux | grep "jdtls" | grep -v grep | awk 'NR>'$JDTLS_MAX' {print $2}' | xargs -r kill -9
    fi
    ps aux | grep "jdtls" | grep -v grep | awk '{if ($6 > '$JDTLS_MEMORY') print $2}' | while read pid; do
        if [ -n "$pid" ]; then
            mem=$(ps -p "$pid" -o rss= 2>/dev/null)
            if [ -n "$mem" ] && [ "$mem" -gt "$JDTLS_MEMORY" ]; then
                log_event "CRITICAL: JDTLS PID $pid using ${mem}MB (max: ${JDTLS_MEMORY}MB) - killing"
                kill -9 "$pid" 2>/dev/null
            fi
        fi
    done
    
    # Count Lua processes
    lua_count=$(ps aux | grep "lua-language-server" | grep -v grep | wc -l)
    if [ "$lua_count" -gt "$LUA_MAX" ]; then
        log_event "WARNING: $lua_count Lua processes (max: $LUA_MAX) - killing excess"
        ps aux | grep "lua-language-server" | grep -v grep | awk 'NR>'$LUA_MAX' {print $2}' | xargs -r kill -9
    fi
    ps aux | grep "lua-language-server" | grep -v grep | awk '{if ($6 > '$LUA_MEMORY') print $2}' | while read pid; do
        if [ -n "$pid" ]; then
            mem=$(ps -p "$pid" -o rss= 2>/dev/null)
            if [ -n "$mem" ] && [ "$mem" -gt "$LUA_MEMORY" ]; then
                cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null)
                log_event "CRITICAL: Lua PID $pid using ${mem}MB, CPU ${cpu}% (max: ${LUA_MEMORY}MB) - killing"
                kill -9 "$pid" 2>/dev/null
            fi
        fi
    done
    
    # Monitor Astro.js language server
    astro_count=$(ps aux | grep "@astrojs/language-server" | grep -v grep | wc -l)
    if [ "$astro_count" -gt "$ASTRO_MAX" ]; then
        log_event "WARNING: $astro_count Astro processes (max: $ASTRO_MAX) - killing excess"
        ps aux | grep "@astrojs/language-server" | grep -v grep | awk 'NR>'$ASTRO_MAX' {print $2}' | xargs -r kill -9
    fi
    ps aux | grep "@astrojs/language-server" | grep -v grep | awk '{if ($6 > '$ASTRO_MEMORY') print $2}' | while read pid; do
        if [ -n "$pid" ]; then
            mem=$(ps -p "$pid" -o rss= 2>/dev/null)
            if [ -n "$mem" ] && [ "$mem" -gt "$ASTRO_MEMORY" ]; then
                log_event "CRITICAL: Astro PID $pid using ${mem}MB (max: ${ASTRO_MEMORY}MB) - killing"
                kill -9 "$pid" 2>/dev/null
            fi
        fi
    done
    
    # Monitor Bash language server
    bash_count=$(ps aux | grep "bash-language-server" | grep -v grep | wc -l)
    if [ "$bash_count" -gt "$BASH_MAX" ]; then
        log_event "WARNING: $bash_count Bash processes (max: $BASH_MAX) - killing excess"
        ps aux | grep "bash-language-server" | grep -v grep | awk 'NR>'$BASH_MAX' {print $2}' | xargs -r kill -9
    fi
    ps aux | grep "bash-language-server" | grep -v grep | awk '{if ($6 > '$BASH_MEMORY') print $2}' | while read pid; do
        if [ -n "$pid" ]; then
            mem=$(ps -p "$pid" -o rss= 2>/dev/null)
            if [ -n "$mem" ] && [ "$mem" -gt "$BASH_MEMORY" ]; then
                log_event "WARNING: Bash PID $pid using ${mem}MB (max: ${BASH_MEMORY}MB) - killing"
                kill -9 "$pid" 2>/dev/null
            fi
        fi
    done
    
    # Monitor TypeScript language server
    ts_count=$(ps aux | grep "typescript-language-server" | grep -v grep | wc -l)
    if [ "$ts_count" -gt "$TYPESCRIPT_MAX" ]; then
        log_event "WARNING: $ts_count TypeScript processes (max: $TYPESCRIPT_MAX) - killing excess"
        ps aux | grep "typescript-language-server" | grep -v grep | awk 'NR>'$TYPESCRIPT_MAX' {print $2}' | xargs -r kill -9
    fi
    ps aux | grep "typescript-language-server" | grep -v grep | awk '{if ($6 > '$TYPESCRIPT_MEMORY') print $2}' | while read pid; do
        if [ -n "$pid" ]; then
            mem=$(ps -p "$pid" -o rss= 2>/dev/null)
            if [ -n "$mem" ] && [ "$mem" -gt "$TYPESCRIPT_MEMORY" ]; then
                log_event "WARNING: TypeScript PID $pid using ${mem}MB (max: ${TYPESCRIPT_MEMORY}MB) - killing"
                kill -9 "$pid" 2>/dev/null
            fi
        fi
    done
    
    # Monitor YAML language server
    yaml_count=$(ps aux | grep "yaml-language-server" | grep -v grep | wc -l)
    if [ "$yaml_count" -gt "$YAML_MAX" ]; then
        log_event "WARNING: $yaml_count YAML processes (max: $YAML_MAX) - killing excess"
        ps aux | grep "yaml-language-server" | grep -v grep | awk 'NR>'$YAML_MAX' {print $2}' | xargs -r kill -9
    fi
    ps aux | grep "yaml-language-server" | grep -v grep | awk '{if ($6 > '$YAML_MEMORY') print $2}' | while read pid; do
        if [ -n "$pid" ]; then
            mem=$(ps -p "$pid" -o rss= 2>/dev/null)
            if [ -n "$mem" ] && [ "$mem" -gt "$YAML_MEMORY" ]; then
                log_event "WARNING: YAML PID $pid using ${mem}MB (max: ${YAML_MEMORY}MB) - killing"
                kill -9 "$pid" 2>/dev/null
            fi
        fi
    done
    
    # Cleanup old temp directories
    find /tmp/opencode-test-* -maxdepth 0 -type d -cmin +120 -exec rm -rf {} \; 2>/dev/null
    find /tmp/opencode-jdtls-data* -maxdepth 0 -type d -cmin +240 -exec rm -rf {} \; 2>/dev/null
    find /tmp/bunx-* -maxdepth 0 -type d -cmin +240 -exec rm -rf {} \; 2>/dev/null
    
    sleep "$CHECK_INTERVAL"
done
MONITOR_EOF
chmod +x "$BIN_DIR/monitor-opencode.sh"
echo "✓ Monitor script installed"

# Create cleanup script
echo "📝 Installing cleanup script..."
cat > "$BIN_DIR/cleanup-opencode-temp.sh" << 'CLEANUP_EOF'
#!/bin/bash
# Cleanup old opencode temp directories

find /tmp/opencode-test-* -maxdepth 0 -type d -cmin +60 -exec rm -rf {} \; 2>/dev/null
find /tmp/opencode-jdtls-data* -maxdepth 0 -type d -cmin +120 -exec rm -rf {} \; 2>/dev/null
find /tmp/bunx-* -maxdepth 0 -type d -cmin +240 -exec rm -rf {} \; 2>/dev/null

ps aux | grep "jdtls" | grep -v grep | awk '$7 > "0:30" {print $2}' | xargs -r kill -9 2>/dev/null
ps aux | grep "lua-language-server" | grep -v grep | awk '{if ($3 > 80 && $7 > "0:20") print $2}' | xargs -r kill -9 2>/dev/null

ps aux | grep "@astrojs/language-server" | grep -v grep | awk 'NR>1 {print $2}' | xargs -r kill -9 2>/dev/null
ps aux | grep "typescript-language-server" | grep -v grep | awk 'NR>2 {print $2}' | xargs -r kill -9 2>/dev/null
ps aux | grep "bash-language-server" | grep -v grep | awk 'NR>3 {print $2}' | xargs -r kill -9 2>/dev/null
ps aux | grep "yaml-language-server" | grep -v grep | awk 'NR>2 {print $2}' | xargs -r kill -9 2>/dev/null

echo "[$(date)] Cleaned up opencode temp directories and excess language servers"
CLEANUP_EOF
chmod +x "$BIN_DIR/cleanup-opencode-temp.sh"
echo "✓ Cleanup script installed"

# Create emergency stop script
echo "📝 Installing emergency stop script..."
cat > "$BIN_DIR/emergency-stop-opencode.sh" << 'EMERGENCY_EOF'
#!/bin/bash
echo "🛑 Emergency stop: Killing language servers..."

pkill -9 -f "jdtls" 2>/dev/null && echo "✓ Killed JDTLS"
pkill -9 -f "lua-language-server" 2>/dev/null && echo "✓ Killed Lua"
pkill -9 -f "@astrojs/language-server" 2>/dev/null && echo "✓ Killed Astro"
pkill -9 -f "typescript-language-server" 2>/dev/null && echo "✓ Killed TypeScript"
pkill -9 -f "bash-language-server" 2>/dev/null && echo "✓ Killed Bash"
pkill -9 -f "yaml-language-server" 2>/dev/null && echo "✓ Killed YAML"

rm -rf /tmp/opencode-jdtls-data* 2>/dev/null && echo "✓ Cleaned JDTLS temp"
rm -rf /tmp/opencode-test-* 2>/dev/null && echo "✓ Cleaned test temp"
rm -rf /tmp/bunx-* 2>/dev/null && echo "✓ Cleaned bunx cache"

echo "✓ Emergency cleanup complete"
EMERGENCY_EOF
chmod +x "$BIN_DIR/emergency-stop-opencode.sh"
echo "✓ Emergency stop script installed"

# Create systemd service
echo "📝 Installing systemd service..."
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_DIR/opencode-monitor.service" << 'SERVICE_EOF'
[Unit]
Description=OpenCode Language Server Monitor
After=network.target

[Service]
Type=simple
ExecStart=%h/.local/bin/monitor-opencode.sh
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="PATH=%h/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin"

[Install]
WantedBy=default.target
SERVICE_EOF
echo "✓ Systemd service file created"

# Setup systemd
echo "🔧 Enabling systemd service..."
systemctl --user daemon-reload
systemctl --user enable opencode-monitor.service
systemctl --user start opencode-monitor.service
sleep 2
systemctl --user status opencode-monitor.service | grep -E "Active|Running" | head -1

# Setup cron
echo "📅 Installing cron job..."
CRON_CMD="*/10 * * * * $BIN_DIR/cleanup-opencode-temp.sh >> $LOG_DIR/cleanup.log 2>&1"
(crontab -l 2>/dev/null || echo "") | grep -v "cleanup-opencode-temp" | (cat; echo "$CRON_CMD") | crontab -
echo "✓ Cron job installed (runs every 10 minutes)"

# Create documentation
echo "📚 Creating documentation..."
cat > "$LOG_DIR/SAFEGUARDS.md" << 'DOC_EOF'
# OpenCode Language Server Safeguards

Auto-installed safeguards to prevent language server crashes.

## Components

1. **Real-Time Monitor** (`monitor-opencode.sh`)
   - Runs continuously every 30 seconds
   - Limits: JDTLS (5), Lua (2), Astro (3), TypeScript (5), Bash (5), YAML (3)
   - Memory limits enforced per process type
   - Auto-cleans /tmp directories

2. **Cron Cleanup** (every 10 minutes)
   - Removes old test/temp directories
   - Kills orphaned processes

3. **Emergency Stop** (`emergency-stop-opencode.sh`)
   - Quick kill of all language servers
   - Cleanup of temp directories

## Commands

```bash
# Check monitor status
systemctl --user status opencode-monitor.service

# View logs
tail -f ~/.local/share/opencode/monitor.log

# Emergency stop
~/.local/bin/emergency-stop-opencode.sh

# Manual cleanup
~/.local/bin/cleanup-opencode-temp.sh

# Restart monitor
systemctl --user restart opencode-monitor.service
```

## Configuration

Edit limits in: `~/.local/bin/monitor-opencode.sh` (lines 9-19)
DOC_EOF
echo "✓ Documentation created at $LOG_DIR/SAFEGUARDS.md"

echo ""
echo "✅ Language Server Safeguards Setup Complete!"
echo ""
echo "📊 Summary:"
echo "   ✓ Monitor script: $BIN_DIR/monitor-opencode.sh"
echo "   ✓ Cleanup script: $BIN_DIR/cleanup-opencode-temp.sh"
echo "   ✓ Emergency stop: $BIN_DIR/emergency-stop-opencode.sh"
echo "   ✓ Systemd service: ENABLED and RUNNING"
echo "   ✓ Cron job: INSTALLED (every 10 minutes)"
echo ""
echo "🔍 Check status:"
echo "   systemctl --user status opencode-monitor.service"
echo ""
echo "📖 Documentation: $LOG_DIR/SAFEGUARDS.md"
