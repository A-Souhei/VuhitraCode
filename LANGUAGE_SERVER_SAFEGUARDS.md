# Language Server Safeguards Setup

This document describes the automatic safeguards installed to prevent language server processes from crashing your system.

## Problem Solved

Language servers (JDTLS, Lua, Astro.js, TypeScript, Bash, YAML) were:
- Spawning 67+ instances instead of 1
- Consuming 5-7GB RAM each
- Causing system OOM kills and crashes

## Solution

### Three-Layer Protection

#### 1. Real-Time Monitor Service
- Runs continuously in the background
- Checks every 30 seconds
- Automatically kills processes that exceed limits:
  - **JDTLS**: 5 instances max, 2GB per instance
  - **Lua**: 2 instances max, 1GB per instance
  - **Astro.js**: 3 instances max, 800MB per instance
  - **TypeScript**: 5 instances max, 500MB per instance
  - **Bash**: 5 instances max, 200MB per instance
  - **YAML**: 3 instances max, 200MB per instance
- Auto-cleans `/tmp` directories older than 2-4 hours

#### 2. Cron Cleanup Job
- Runs every 10 minutes
- Removes old test/temp directories
- Kills orphaned processes
- Prevents temp directory accumulation

#### 3. Emergency Stop Script
- Quick manual override if needed
- Kills all language servers immediately
- Cleans up temp directories

## Installation

### Option 1: Using Make (Recommended)
```bash
cd /path/to/VuhitraCode
make setup-safeguards
```

### Option 2: Manual Script
```bash
./scripts/setup-language-server-safeguards.sh
```

## Verification

After installation, verify everything is running:

```bash
# Check monitor status
systemctl --user status opencode-monitor.service

# Should show: Active: active (running)
```

## Usage

### Check Monitor
```bash
systemctl --user status opencode-monitor.service
```

### View Monitor Logs
```bash
tail -f ~/.local/share/opencode/monitor.log
```

### Manual Cleanup
```bash
~/.local/bin/cleanup-opencode-temp.sh
```

### Emergency Stop (if needed)
```bash
~/.local/bin/emergency-stop-opencode.sh
```

### Restart Monitor
```bash
systemctl --user restart opencode-monitor.service
```

### Disable Monitor (if needed)
```bash
systemctl --user stop opencode-monitor.service
systemctl --user disable opencode-monitor.service
```

## Configuration

To adjust limits, edit:
```bash
~/.local/bin/monitor-opencode.sh
```

Lines 9-19 contain the configurable limits:
- `JDTLS_MAX=5` - Max JDTLS instances
- `JDTLS_MEMORY=2000` - Max MB per JDTLS
- `LUA_MAX=2` - Max Lua processes
- `LUA_MEMORY=1000` - Max MB per Lua
- etc.

After editing, restart the monitor:
```bash
systemctl --user restart opencode-monitor.service
```

## Troubleshooting

### Monitor not running?
```bash
systemctl --user start opencode-monitor.service
systemctl --user status opencode-monitor.service
```

### Still seeing crashes?
1. Check logs: `tail -100 ~/.local/share/opencode/monitor.log`
2. Manual emergency stop: `~/.local/bin/emergency-stop-opencode.sh`
3. Check running processes: `ps aux | grep language-server`

### Monitor consuming too much CPU?
Increase `CHECK_INTERVAL` in the monitor script (default: 30 seconds)

## Files Installed

| File | Location | Purpose |
|------|----------|---------|
| monitor-opencode.sh | `~/.local/bin/` | Real-time process monitor |
| cleanup-opencode-temp.sh | `~/.local/bin/` | Periodic cleanup script |
| emergency-stop-opencode.sh | `~/.local/bin/` | Emergency kill switch |
| opencode-monitor.service | `~/.config/systemd/user/` | Systemd service file |
| Cron job | Via `crontab -e` | Scheduled cleanup (every 10 min) |

## What Happens With Language Servers?

- ✅ Language servers **will still run normally**
- ✅ You can still use your editor
- ✅ Autocomplete, linting, etc. **still work**
- ✅ Only **excess processes** get killed
- ✅ Only **memory hogs** get killed
- ❌ Runaway servers **cannot crash your system**

## Uninstalling Safeguards

To remove all safeguards:

```bash
# Stop and disable monitor
systemctl --user stop opencode-monitor.service
systemctl --user disable opencode-monitor.service
rm ~/.config/systemd/user/opencode-monitor.service

# Remove scripts
rm ~/.local/bin/monitor-opencode.sh
rm ~/.local/bin/cleanup-opencode-temp.sh
rm ~/.local/bin/emergency-stop-opencode.sh

# Remove cron job
crontab -e
# (delete the cleanup-opencode-temp line)
```

---

**Status**: ✅ Safeguards installed and active  
**Last Updated**: 2026-03-13
