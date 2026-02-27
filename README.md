<p align="center">
  <h1>Vuhitra.Code</h1>
  <p>A fork of <a href="https://github.com/anomalyco/opencode">OpenCode</a> — AI-powered coding agent with full terminal UI.</p>
</p>

---

> **Note:** This is a community fork of [OpenCode](https://opencode.ai). Not affiliated with the original OpenCode team.

## Features

- **AI-Powered Coding** — Full AI agent that reads, writes, and edits code
- **Terminal-First UI** — Beautiful TUI built for developers
- **LSP Support** — Out-of-the-box language server support for intelligent code analysis
- **MCP Servers** — Model Context Protocol support with OAuth auto-handling
- **Multi-Provider** — Works with OpenAI, Anthropic, Google, local models, and 75+ providers
- **File Editing** — Intelligent diff-based file modifications with auto-formatting (prettier, gofmt, ruff, and more)
- **Command Execution** — Run shell commands with granular permission controls
- **Context Awareness** — Understands your codebase via LSP and file analysis
- **Agent Modes** — Build (full access) and Plan (read-only suggestions) modes
- **Pass Over** — Automatic agent handoff workflows (e.g., alice → audit for review → alice for fixes)
- **Custom Agents** — Define specialized AI personas via `.opencode/agent/` markdown files
- **Custom Commands** — Reusable prompt templates in `.opencode/command/` with dynamic arguments
- **Custom Tools** — Extend the LLM toolset with `.ts` files in `.opencode/tools/`
- **Plugin System** — Event hooks via `.opencode/plugin/` for automation (notifications, file guards, etc.)
- **Session Management** — Resume, fork, and compact sessions; export as Markdown
- **Theming** — 30+ built-in themes, custom JSON themes, dark/light variant support
- **Non-Interactive Mode** — `vuhitracode run` for scripting and CI pipelines
- **Headless API** — `vuhitracode serve` for server-mode access

## Requirements

- [Bun](https://bun.sh) v1.1+

## Setup

```bash
# Clone the repo
git clone https://github.com/A-Souhei/VuhitraCode.git
cd VuhitraCode

# Install Bun if not already installed
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
```

## Install

Run the following to install the `vuhitracode` command to `~/.local/bin/`:

```bash
make install
```

Make sure `~/.local/bin` is in your `PATH`:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## Run

```bash
# Launch the TUI in the current directory
vuhitracode

# Resume the last session
vuhitracode --continue

# Resume a specific session
vuhitracode -s <session-id>

# Non-interactive mode (for scripting)
vuhitracode run "refactor this function"

# Headless API server
vuhitracode serve
```

## Configuration

Config is read from (in order of precedence):

1. `opencode.json` or `opencode.jsonc` in the project root
2. `~/.config/opencode/opencode.json`

Example `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "theme": "opencode",
  "keybinds": {},
  "permissions": {
    "bash": {
      "git *": "allow",
      "rm -rf *": "deny",
      "git push": "ask",
    },
  },
  "mcp": {},
}
```

Run `/connect` inside the TUI to add API keys for providers interactively.

### Pass Over Configuration

Configure automatic agent handoff workflows via `.opencode/pass-over.json`:

```jsonc
{
  "global_settings": {
    "auto_confirm": false, // Auto-accept pass overs
    "timeout_ms": 30000, // Timeout in milliseconds
    "return_to_originator": true, // Auto-return after work completes
    "max_chain_depth": 3, // Maximum agent chain depth
    "enabled": true, // Enable/disable pass over feature
  },
  "agent_pair_settings": {
    "alice": {
      "audit": {
        "auto_confirm": true, // Override global for alice→audit
      },
    },
  },
}
```

Or configure via CLI:

```bash
# Set global defaults
vuhitracode agent pass-over set-global --auto-confirm true

# Configure specific agent pair
vuhitracode agent pass-over set-pair alice audit --auto-confirm true --timeout-ms 60000

# View current configuration
vuhitracode agent pass-over config

# List all configured pairs
vuhitracode agent pass-over list

# Reset to defaults
vuhitracode agent pass-over reset
```
