# Dev Setup

How to install the local `opencode-dev` binary from this fork on a new machine.

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Git

## Install

```bash
git clone git@github.com:A-Souhei/opencode.git
cd opencode
bun install
make install-dev
```

This installs `opencode-dev` to `~/.local/bin/`. Make sure that's on your `PATH`:

```bash
# add to ~/.bashrc or ~/.zshrc if needed
export PATH="$HOME/.local/bin:$PATH"
```

## Usage

`opencode-dev` works the same as the `opencode` CLI. Run it from your project directory:

```bash
cd ~/your-project
opencode-dev          # open TUI
opencode-dev serve    # headless server
opencode-dev init     # scaffold .vuhitra/ config (indexing on, model lock off)
```

> **Note:** `opencode-dev` uses `bun --cwd` internally, so always invoke it from your target project directory (or a subdirectory of it) — `PWD` is used to resolve the project root.

## Updating

```bash
cd ~/path/to/opencode
git pull
bun install
make install-dev
```
