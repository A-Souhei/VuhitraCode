<p align="center">
  <h1>Vuhitra.Code</h1>
  <p>A fork of <a href="https://github.com/anomalyco/opencode">OpenCode</a> — AI-powered coding agent with full terminal UI.</p>
</p>

---

> **Note:** This is a community fork of [OpenCode](https://opencode.ai). Not affiliated with the original OpenCode team.

## Features

- **AI-Powered Coding** — Full AI agent that reads, writes, and edits code
- **Terminal-First UI** — Beautiful TUI built for developers
- **LSP Support** — Out-of-the-box language server support
- **MCP Servers** — Model Context Protocol support
- **Multi-Provider** — Works with OpenAI, Anthropic, Google, local models, and more
- **File Editing** — Intelligent diff-based file modifications
- **Command Execution** — Run shell commands with permission controls
- **Context Awareness** — Understands your codebase via LSP and file analysis
- **Agent Modes** — Build (full access) and Plan (read-only) modes

## Setup

```bash
# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Build all packages
bun run build
```

## Running

```bash
# Development mode
bun run dev

# Or run the built binary
./packages/opencode/bin/opencode
```

## Configuration

Create `~/.opencode/config.yaml`:

```yaml
providers:
  - id: opencode
    type: openai
    api_key: your_api_key
```

---

**Discord:** [Join our community](https://discord.gg/vuhitra)
