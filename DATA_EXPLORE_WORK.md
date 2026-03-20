# data-explore agent — Work Summary

Branch: `feat/analyse-agent`

---

## Goal

Enable the `data-explore` agent to correctly read and analyze gitignored CSV files (e.g. `data-agent-test/products.csv`, `users.csv`, `orders.csv`) without hallucinating. The agent runs on a local Ollama model (`qwen2.5:7b`) and must access private data that is excluded from git.

---

## Files Involved

### Agent definition

| File                              | What changed                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.opencode/agent/data-explore.md` | Simplified from 101 → ~74 lines. Replaced abstract 5-layer grounding framework with direct imperatives. Added Way 1 (`@file` injection) and Way 2 (Python via bash) modes. Temperature set to 0.1. |
| `.opencode/agent/analyse.md`      | New agent for general data analysis tasks.                                                                                                                                                         |

### Core source files

| File                                       | What changed                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/src/tool/read.ts`       | Added gitignore exemption for `data-explore` and `secret` agents at three locations: file read (line ~79), directory listing (line ~119), image/PDF (line ~188). `data-explore` gets **full bypass** (real content). `secret` gets faked content for defense-in-depth. Scout/Sentinel throw. |
| `packages/opencode/src/tool/bash.ts`       | Added `data-explore` and `secret` agent exemptions to all three gitignore check sites: base64 check (~line 200), FILE_READ_CMDS direct args check (~line 230), interpreter inline code check (~line 300). Allows `python -c "pd.read_csv(...)"` to run without being blocked.                |
| `packages/opencode/src/session/prompt.ts`  | Added `data-explore` exemption at line ~1264 so `@file` attachments in the prompt are passed through to ReadTool instead of being blocked. Also added `Faker` content substitution logic for non-exempt agents.                                                                              |
| `packages/opencode/src/config/config.ts`   | Agent loading: name derived from filename without `.md` extension (e.g. `data-explore.md` → agent name `"data-explore"`).                                                                                                                                                                    |
| `packages/opencode/src/config/markdown.ts` | `FILE_REGEX` and `files()` used by `resolvePromptParts()` to detect `@file` patterns in prompts.                                                                                                                                                                                             |

### Grounding system (ported from Open WebUI)

| File                                                            | What it is                                  |
| --------------------------------------------------------------- | ------------------------------------------- |
| `packages/opencode/src/grounding/core/HallucinationGrounder.ts` | Core anti-hallucination grounding logic     |
| `packages/opencode/src/grounding/core/SourceFormatter.ts`       | Formats source references                   |
| `packages/opencode/src/grounding/core/PlaceholderGuard.ts`      | Guards against placeholder values in output |
| `packages/opencode/src/grounding/core/types.ts`                 | Shared types                                |
| `packages/opencode/src/grounding/params/ollama.ts`              | Ollama-specific grounding parameters        |
| `packages/opencode/src/grounding/templates/index.ts`            | Prompt templates                            |

### Tests

| File                                                         | What it tests                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `packages/opencode/test/tool/read.test.ts`                   | Scout/Sentinel rejection, `data-explore` bypass, `OLLAMA_MODEL` conditional behavior, faking for regular agents |
| `packages/opencode/test/tool/data-explore-gitignore.test.ts` | Confirms ReadTool works for `data-explore` on gitignored files (diagnostic)                                     |
| `packages/opencode/test/tool/data-explore-prompt.test.ts`    | Confirms `resolvePromptParts()` detects `@file` pattern (diagnostic)                                            |

---

## Root Cause of Hallucination (Confirmed)

The `data-explore` agent hallucinates because:

1. **`bash.ts` blocked gitignored files for ALL agents** — no agent identity check. When the model ran `python3 -c "pd.read_csv('/path/file.csv')"`, bash.ts extracted the path, checked gitignore, and threw `Access denied` before executing. The model received the error and hallucinated a plausible result.

2. **`read.ts` had the exemption** at line 79, but a later edit changed it to `shouldFake = true` for `data-explore` instead of a full bypass — meaning the model received fake/anonymized data instead of real content.

3. **`prompt.ts` `@file` injection path** — when using `@file` syntax in a prompt, `resolvePromptParts()` creates a `FilePart`, which flows to `createUserMessage()` → ReadTool. The `data-explore` exemption at line 1264 correctly bypasses the gitignore block. However the model still needs to be capable of using tool results rather than hallucinating.

---

## What Was Fixed

| Fix                          | File              | Description                                                                         |
| ---------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| Gitignore bypass for bash    | `bash.ts`         | Added `ctx.agent !== "secret" && ctx.agent !== "data-explore"` to all 3 check sites |
| Full content bypass for read | `read.ts`         | `data-explore` gets real file content (no faking); `secret` gets faked content      |
| `@file` attachment bypass    | `prompt.ts`       | `data-explore` exempted from gitignore block in `@file` processing path             |
| Prompt simplification        | `data-explore.md` | Reduced complexity so small Ollama models can follow instructions                   |

---

## Remaining Issue

The `qwen2.5:7b` model (running on remote Ollama at `192.168.31.23:11434`) still hallucinates results and claims `[EXECUTION_VERIFIED]` without actually running code. The code paths are now unblocked — but the model itself doesn't reliably use its tools. It narrates what it _would_ do instead of calling `bash` or `python`.

This is a model capability limitation, not a code bug. Possible solutions:

- Use a larger model (e.g. `qwen2.5:14b` or `qwen2.5:72b`)
- Use a model specifically fine-tuned for tool-use/function-calling
- Inject file content directly into the prompt (embed CSV text) so the model can analyze it without needing to execute code

---

## Uncommitted Changes (as of last session)

| File                                                         | Status                                         |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `packages/opencode/src/tool/bash.ts`                         | Modified — gitignore exemptions added          |
| `packages/opencode/src/tool/read.ts`                         | Modified — `data-explore` full bypass restored |
| `packages/sdk/js/src/v2/gen/types.gen.ts`                    | Modified — SDK rebuilt                         |
| `packages/opencode/test/tool/data-explore-gitignore.test.ts` | Untracked — diagnostic test                    |
| `packages/opencode/test/tool/data-explore-prompt.test.ts`    | Untracked — diagnostic test                    |
| Various `*.md` report files in root                          | Untracked — session notes                      |
